"""Cairn CLI: ``cairn server``, ``cairn ui``, ``cairn init``, ``cairn list``, …

The two server commands:

* ``cairn server [--repo PATH]`` — runs the ingest tracking API **and** the UI
  viewer on two ports in the same process. Single Ctrl+C kills both.
* ``cairn ui [--repo PATH]`` — standalone UI over a local repo when no
  tracking server is running. Acquires the repo write-lock in ``mode="ui"``.
  A running ``cairn server`` on the same repo will make this error out; in
  that case just open the server's UI URL in a browser.

Client commands (``list``, ``ping``, ``open``, ``rm``, ``export``, ``sync``)
talk to a running server over HTTP.
"""

from __future__ import annotations

import json
import signal
import socket
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Any

import click

from . import config as _config
from .sdk.transport import Transport, default_spill_dir
from .server.app import create_app
from .server.storage.blobs import BlobStore
from .server.storage.datadir import DataDir, RepoLockedError, default_data_dir
from .server.storage.db import Database


def _lan_ip() -> str:
    """Best-effort local LAN IP (no packets actually sent)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return "127.0.0.1"


def _default_repo() -> Path:
    """CWD/.cairn if present, else home fallback."""
    cwd_repo = Path.cwd() / ".cairn"
    if cwd_repo.exists():
        return cwd_repo
    # If nothing is in CWD yet, default to CWD/.cairn too (will be created).
    return cwd_repo


@click.group()
@click.version_option(package_name="cairn-track")
def main() -> None:
    """Cairn — open-source ML experiment tracker."""


# ---------- init ------------------------------------------------------------


@main.command("init")
@click.argument(
    "path",
    default=".",
    type=click.Path(file_okay=False, dir_okay=True, path_type=Path),
)
def init_cmd(path: Path) -> None:
    """Create a local Cairn repo at PATH/.cairn (default: CWD).

    After ``cairn init`` you can log directly to the repo with
    ``cairn.Run(repo="./.cairn", ...)`` or start the viewer with
    ``cairn server`` / ``cairn ui``.
    """
    repo = (path / ".cairn").resolve()
    already = repo.exists() and (repo / "cairn.db").exists()
    dd = DataDir(repo)
    # ``Database.open`` runs migrations idempotently, so init is safe to
    # re-run on an existing repo.
    db = Database.open(dd.db_path)
    db.close()
    if already:
        click.echo(f"Cairn repo already initialized at {repo}")
    else:
        click.echo(f"Initialized empty Cairn repo at {repo}")


# ---------- server (ingest + UI, two ports in one process) -----------------


def _ensure_repo(repo: Path) -> Path:
    """Resolve + create the repo tree on demand.

    The tracking server expects to be pointed at a ``.cairn/`` directory;
    we create it lazily if it doesn't exist so the quickstart is a single
    command.
    """
    repo = repo.expanduser().resolve()
    if not repo.exists():
        click.echo(f"Creating new Cairn repo at {repo}")
    DataDir(repo)  # idempotent
    return repo


@main.command("server")
@click.option("--host", default="0.0.0.0", show_default=True)
@click.option("--port", default=4300, show_default=True, type=int,
              help="Port for the ingest (tracking) API.")
@click.option("--ui-port", default=None, type=int,
              help="Port for the UI viewer. Default: --port + 1.")
@click.option(
    "--repo",
    default=None,
    type=click.Path(dir_okay=True, file_okay=False, path_type=Path),
    help="Path to the .cairn/ directory. Default: ./.cairn (created if missing).",
)
@click.option(
    "--open-browser",
    is_flag=True,
    help="Open the UI in a browser tab after startup (off by default).",
)
@click.option("--no-ui", is_flag=True, help="Skip spawning the UI server.")
@click.option(
    "--advertise",
    is_flag=True,
    help="Broadcast the ingest server on the LAN via zeroconf/mDNS.",
)
def server_cmd(
    host: str,
    port: int,
    ui_port: int | None,
    repo: Path | None,
    open_browser: bool,
    no_ui: bool,
    advertise: bool,
) -> None:
    """Start the Cairn tracking server (and its paired UI viewer)."""
    import uvicorn

    repo = _ensure_repo(repo or _default_repo())
    ui_port = ui_port or port + 1

    dd = DataDir(repo)
    # Record the UI port (if present, else the ingest port) in the lock
    # file so a concurrent SDK ``Run(repo=...)`` on the same repo can
    # transparently switch to HTTP mode. We store 127.0.0.1 as the host
    # even when --host is 0.0.0.0 because the SDK that detects the lock
    # will always be on the same machine.
    lock_port = port if no_ui else ui_port
    try:
        dd.acquire_lock("server", host="127.0.0.1", port=lock_port)
    except RepoLockedError as exc:
        click.echo(f"ERROR: {exc}", err=True)
        sys.exit(1)

    # One Database, shared by both apps: DuckDB permits only one connection
    # per file in this process, so both FastAPI apps must share the same one.
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)

    # Ingest-only app (no SPA mount).
    ingest_app = create_app(
        db=db, blobs=blobs, data_dir_obj=dd, mount_ui=False
    )
    # UI app (ingest + read + SPA). Only built if UI is enabled.
    ui_app = (
        None
        if no_ui
        else create_app(db=db, blobs=blobs, data_dir_obj=dd, mount_ui=True)
    )

    advertiser = None
    if advertise:
        try:
            from .server.advertise import Advertiser

            advertiser = Advertiser()
            advertiser.start(
                host=_lan_ip() if host == "0.0.0.0" else host, port=port
            )
        except ImportError:
            click.echo(
                "WARN: `cairn-track[discovery]` not installed; --advertise ignored.",
                err=True,
            )

    lan = _lan_ip()
    banner_lines = [
        "",
        "  Cairn tracking server:",
        f"    Ingest API local:   http://localhost:{port}",
        f"    Ingest API network: http://{lan}:{port}",
    ]
    if ui_app is not None:
        banner_lines += [
            f"    UI local:           http://localhost:{ui_port}",
            f"    UI network:         http://{lan}:{ui_port}",
        ]
    banner_lines += [
        f"  Repo: {dd.root}",
        "  Press Ctrl+C to stop.",
        "",
    ]
    click.echo("\n".join(banner_lines))

    if open_browser and ui_app is not None and host in ("0.0.0.0", "127.0.0.1", "localhost"):
        try:
            webbrowser.open(f"http://localhost:{ui_port}/")
        except Exception:  # noqa: BLE001
            pass

    servers: list[uvicorn.Server] = []
    threads: list[threading.Thread] = []

    ingest_config = uvicorn.Config(
        app=ingest_app, host=host, port=port, log_level="info", lifespan="on"
    )
    ingest_server = uvicorn.Server(ingest_config)
    servers.append(ingest_server)

    if ui_app is not None:
        ui_config = uvicorn.Config(
            app=ui_app, host=host, port=ui_port, log_level="warning", lifespan="on"
        )
        ui_server = uvicorn.Server(ui_config)
        servers.append(ui_server)

    def _sigint(_sig, _frame):
        for s in servers:
            s.should_exit = True

    signal.signal(signal.SIGINT, _sigint)

    # Run all-but-first uvicorns in background threads; the first one in the
    # main thread so Ctrl+C propagates naturally. (uvicorn.Server.run() installs
    # its own handlers, but our earlier signal.signal() wins since it's set on
    # the main thread last.)
    for s in servers[1:]:
        t = threading.Thread(target=s.run, name=f"uvicorn-{id(s)}", daemon=True)
        t.start()
        threads.append(t)

    try:
        servers[0].run()
    finally:
        for s in servers:
            s.should_exit = True
        for t in threads:
            t.join(timeout=10)
        if advertiser is not None:
            advertiser.stop()
        db.close()
        dd.release_lock()


# ---------- ui (standalone UI over a local repo) ----------------------------


@main.command("ui")
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--port", default=4301, show_default=True, type=int)
@click.option(
    "--repo",
    default=None,
    type=click.Path(dir_okay=True, file_okay=False, path_type=Path),
    help="Path to the .cairn/ directory. Default: ./.cairn.",
)
@click.option(
    "--open-browser",
    is_flag=True,
    help="Open the UI in a browser tab after startup (off by default).",
)
def ui_cmd(
    host: str, port: int, repo: Path | None, open_browser: bool
) -> None:
    """Serve the Cairn viewer over a local repo (no tracking server).

    Use this after ``cairn init`` + a local ``Run(repo=...)`` session to
    browse the results. If a tracking server is already running against the
    same repo, point your browser at its UI port instead (this command will
    error to prevent double-writer corruption).
    """
    import uvicorn

    repo = _ensure_repo(repo or _default_repo())
    dd = DataDir(repo)
    try:
        # Record the UI port in the lock so an SDK Run(repo=...) on the same
        # repo can auto-switch to HTTP mode instead of erroring on the lock.
        dd.acquire_lock("ui", host="127.0.0.1", port=port)
    except RepoLockedError as exc:
        holder = exc.holder
        if holder.get("mode") == "server":
            click.echo(
                "ERROR: A `cairn server` is already running on this repo. "
                "Open its UI URL in your browser instead of starting another one.",
                err=True,
            )
        else:
            click.echo(f"ERROR: {exc}", err=True)
        sys.exit(1)

    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    app = create_app(db=db, blobs=blobs, data_dir_obj=dd, mount_ui=True)

    click.echo(
        f"\n  Cairn UI:\n"
        f"    Local:   http://localhost:{port}\n"
        f"  Repo: {dd.root}\n"
        f"  Press Ctrl+C to stop.\n"
    )
    if open_browser and host in ("0.0.0.0", "127.0.0.1", "localhost"):
        try:
            webbrowser.open(f"http://localhost:{port}/")
        except Exception:  # noqa: BLE001
            pass

    uv_config = uvicorn.Config(
        app=app, host=host, port=port, log_level="info", lifespan="on"
    )
    uv_server = uvicorn.Server(uv_config)

    def _sigint(_sig, _frame):
        uv_server.should_exit = True

    signal.signal(signal.SIGINT, _sigint)
    try:
        uv_server.run()
    finally:
        db.close()
        dd.release_lock()


# ---------- client commands -------------------------------------------------


def _client() -> Transport:
    return Transport(_config.resolve_server())


@main.command("ping")
def ping_cmd() -> None:
    """Check that the configured server is reachable."""
    t = _client()
    try:
        resp = t.get("/api/health")
        click.echo(json.dumps(resp.json(), indent=2))
    except Exception as exc:  # noqa: BLE001
        click.echo(f"ERROR: {exc}", err=True)
        sys.exit(1)
    finally:
        t.close()


@main.command("list")
@click.option("--project", default=None)
@click.option("--task", default=None)
@click.option("--status", default=None)
@click.option("--limit", default=50, type=int)
def list_cmd(
    project: str | None, task: str | None, status: str | None, limit: int
) -> None:
    """List recent runs on the configured server."""
    t = _client()
    try:
        params: dict[str, Any] = {"limit": limit}
        if project:
            params["project"] = project
        if task:
            params["task"] = task
        if status:
            params["status"] = status
        resp = t.get("/api/runs", params=params)
        runs = resp.json().get("runs", [])
        if not runs:
            click.echo("(no runs)")
            return
        click.echo(
            f"{'RUN_ID':<14} {'STATUS':<10} {'PROJECT':<20} {'TASK':<24} NAME"
        )
        for r in runs:
            click.echo(
                f"{r['id']:<14} {r['status']:<10} {r['project_id']:<20} "
                f"{r['task_id']:<24} {r.get('display_name') or ''}"
            )
    finally:
        t.close()


@main.command("open")
@click.argument("run_id")
@click.option("--no-browser", is_flag=True)
def open_cmd(run_id: str, no_browser: bool) -> None:
    """Print the URL for a run (and open in a browser by default)."""
    t = _client()
    try:
        resp = t.get(f"/api/runs/{run_id}")
        run = resp.json()["run"]
        url = (
            f"{_config.resolve_server().rstrip('/')}/p/{run['project_id']}/r/{run['id']}"
        )
        click.echo(url)
        if not no_browser:
            try:
                webbrowser.open(url)
            except Exception:  # noqa: BLE001
                pass
    finally:
        t.close()


@main.command("rm")
@click.argument("run_id")
def rm_cmd(run_id: str) -> None:
    """Delete a run."""
    t = _client()
    try:
        t.delete(f"/api/runs/{run_id}")
        click.echo(f"deleted {run_id}")
    finally:
        t.close()


@main.command("export")
@click.argument("run_id")
@click.option(
    "--format",
    "fmt",
    type=click.Choice(["json", "parquet"]),
    default="json",
)
@click.option(
    "--out",
    type=click.Path(dir_okay=False, path_type=Path),
    required=True,
)
def export_cmd(run_id: str, fmt: str, out: Path) -> None:
    """Download a run's data to a local file."""
    t = _client()
    try:
        run = t.get(f"/api/runs/{run_id}").json()
        seqs_meta = t.get(f"/api/runs/{run_id}/sequences").json()["sequences"]
        seqs: dict[str, list[dict[str, Any]]] = {}
        for s in seqs_meta:
            pts = t.get(
                f"/api/runs/{run_id}/sequences/{s['name']}",
                params={"max_points": 1_000_000},
            ).json()["points"]
            seqs.setdefault(s["name"], []).extend(pts)
        payload = {"run": run, "sequences": seqs}
        if fmt == "json":
            out.write_text(json.dumps(payload, default=str, indent=2))
        else:
            import duckdb

            rows = []
            for name, pts in seqs.items():
                for p in pts:
                    rows.append(
                        {
                            "run_id": run_id,
                            "name": name,
                            "step": p.get("step"),
                            "value": p.get("scalar_value"),
                        }
                    )
            con = duckdb.connect(":memory:")
            con.execute(
                "CREATE TABLE r (run_id VARCHAR, name VARCHAR, step BIGINT, value DOUBLE)"
            )
            con.executemany(
                "INSERT INTO r VALUES (?, ?, ?, ?)",
                [(r["run_id"], r["name"], r["step"], r["value"]) for r in rows],
            )
            con.execute(f"COPY r TO '{out}' (FORMAT PARQUET)")
            con.close()
        click.echo(f"exported to {out}")
    finally:
        t.close()


@main.command("sync")
def sync_cmd() -> None:
    """Reconcile any spilled batches with the server."""
    t = _client()
    try:
        spill = default_spill_dir()
        if not spill.exists():
            click.echo("no spill to sync")
            return
        total = t.drain_spill()
        click.echo(f"replayed {total} batch(es)")
    finally:
        t.close()


@main.command("configure")
@click.option("--server", default=None, help="Server URL.")
def configure_cmd(server: str | None) -> None:
    """Write the config file with defaults."""
    existing = _config.load_config_file()
    if server is None:
        server = click.prompt(
            "Server URL",
            default=existing.get("server") or _config.DEFAULT_SERVER,
        )
    existing["server"] = server
    _config.write_config_file(existing)
    click.echo(f"wrote {_config.config_file_path()}")
