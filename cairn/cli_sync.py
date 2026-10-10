"""``cairn sync``: upload run directories (and, with ``--daemon``, be the
background uploader every ``cairn.Run`` starts on demand)."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import click


@click.command("sync")
@click.argument("paths", nargs=-1, type=click.Path(path_type=Path))
@click.option("--clean", is_flag=True,
              help="Afterwards delete the run directories the server has confirmed completely "
                   "(finished, every record acked). Never deletes anything unconfirmed.")
@click.option("--server", default=None, metavar="URL",
              help="Upload to this server instead of the one each run directory names.")
@click.option("--daemon", is_flag=True, hidden=True,
              help="Run the background uploader (started by cairn.Run itself).")
def sync_cmd(paths: tuple[Path, ...], clean: bool, server: str | None, daemon: bool) -> None:
    """Upload run directories to their server, in the foreground.

    \b
    PATHS are run directories, or directories holding them (a `.cairn`
    directory or its `runs/`). Default: $CAIRN_DIR (`./.cairn`).
    Uploading is exactly once: a record the server has is never applied
    twice, so syncing a directory the background uploader also works on is
    safe.
    """
    from .sdk.runlog.rundir import cairn_dir, iter_run_dirs
    from .uploader.client import IngestClient
    from .uploader.sync import sync_paths

    if daemon:
        from .uploader.daemon import main as daemon_main

        sys.exit(daemon_main())

    dirs = []
    for p in paths or (cairn_dir(),):
        found = iter_run_dirs(p)
        if not found and paths:
            raise click.ClickException(f"{p}: no run directories here")
        dirs.extend(found)
    if not dirs:
        click.echo("nothing to sync")
        return

    client_for = None
    shared: IngestClient | None = None
    if server is not None:
        from .config import _as_server_url, resolve_token

        url = _as_server_url(server).rstrip("/")
        shared = IngestClient(url, resolve_token(url))

        def client_for(_rd):  # noqa: ANN001, ANN202
            return shared

    failed = 0

    def report(rd, outcome: str) -> None:  # noqa: ANN001
        nonlocal failed
        if outcome == "ok":
            pending = rd.pending()
            note = "" if not pending else f" (still being written: {len(pending)} log(s))"
            click.echo(f"{rd.run_id}: uploaded{note}")
        else:
            failed += 1
            click.echo(f"{rd.run_id}: FAILED: {outcome} (kept for retry)", err=True)

    try:
        sync_paths(dirs, client_for=client_for, progress=report)
    finally:
        if shared is not None:
            shared.close()

    if clean:
        removed = 0
        for rd in dirs:
            if rd.complete():
                shutil.rmtree(rd.path)
                removed += 1
            else:
                reason = "still being written" if rd.live() else (
                    "not finished" if any(r.finished() is None for r in rd.logs())
                    else "not fully confirmed by the server")
                click.echo(f"{rd.run_id}: kept ({reason})")
        click.echo(f"removed {removed} run director{'y' if removed == 1 else 'ies'}")
    if failed:
        raise click.ClickException(
            f"{failed} run director{'y' if failed == 1 else 'ies'} not fully uploaded; "
            "run `cairn sync` again once the server is reachable"
        )
