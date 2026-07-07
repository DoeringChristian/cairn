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
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import webbrowser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import click

from . import config as _config
from .sdk.transport import Transport, default_spill_dir
from .server import auth as _auth
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
    """Default repo: ./.cairn in CWD."""
    return Path.cwd() / ".cairn"


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

    After ``cairn init`` you can log runs with ``cairn.Run(project=...)``
    or start the viewer with ``cairn ui``.
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


def _find_free_port(host: str, start: int, max_attempts: int = 20) -> int:
    """Return ``start`` if available, otherwise scan upward for a free port.

    Uses SO_REUSEADDR so a recently-killed server's TIME_WAIT socket
    doesn't push us off the default port.
    """
    for offset in range(max_attempts):
        port = start + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise click.ClickException(
        f"Could not find a free port in range {start}–{start + max_attempts - 1}"
    )


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


def _print_bootstrap_banner(db: Database, *, ui_url: str | None) -> None:
    """On first auth-enabled start with zero tokens, mint + print an admin
    token (shown once — the sanctioned exception to "no tokens in logs").
    ``ui_url`` (if given) also gets a one-time login link built from a
    single-use OTP."""
    boot = _auth.bootstrap_if_needed(db)
    if boot is None:
        return
    _token_id, token_plain, otp = boot
    lines = [
        "",
        "  ================================================================",
        "  Auth is ON. Created a bootstrap admin token (shown once — save it):",
        f"    {token_plain}",
        "",
        "  SDK/CLI:  CAIRN_TOKEN=<token above>  (or `cairn configure` + config.toml)",
    ]
    if ui_url is not None:
        lines += [
            "  Browser (one-time login link, single-use, expires in 15 min):",
            f"    {ui_url}/login?otp={otp}",
            "  ...or open the UI and paste the token into the login form.",
        ]
    lines += [
        "  Manage tokens later with `cairn token create|list|revoke`.",
        "  ================================================================",
        "",
    ]
    click.echo("\n".join(lines))


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
@click.option(
    "--no-auth",
    is_flag=True,
    help="Disable authentication (local/debugging only — auth is ON by default).",
)
def server_cmd(
    host: str,
    port: int,
    ui_port: int | None,
    repo: Path | None,
    open_browser: bool,
    no_ui: bool,
    advertise: bool,
    no_auth: bool,
) -> None:
    """Start the Cairn tracking server (and its paired UI viewer)."""
    import uvicorn

    if advertise and no_auth:
        click.echo(
            "WARN: --advertise + --no-auth broadcasts an UNAUTHENTICATED "
            "server on the LAN — anyone on the network can read/write your "
            "data. Use this only on trusted networks.",
            err=True,
        )

    repo = _ensure_repo(repo or _default_repo())
    port = _find_free_port(host, port)
    ui_port = _find_free_port(host, ui_port or port + 1)

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

    auth_enabled = not no_auth

    # Ingest-only app (no SPA mount).
    ingest_app = create_app(
        db=db, blobs=blobs, data_dir_obj=dd, mount_ui=False, auth_enabled=auth_enabled,
    )
    # UI app (ingest + read + SPA). Only built if UI is enabled.
    ui_app = (
        None
        if no_ui
        else create_app(db=db, blobs=blobs, data_dir_obj=dd, mount_ui=True, auth_enabled=auth_enabled)
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
        f"  Auth: {'ON' if auth_enabled else 'OFF (--no-auth)'}",
        "  Press Ctrl+C to stop.",
        "",
    ]
    click.echo("\n".join(banner_lines))

    if auth_enabled:
        ui_url = f"http://localhost:{ui_port}" if ui_app is not None else None
        _print_bootstrap_banner(db, ui_url=ui_url)

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
@click.option(
    "--no-auth",
    is_flag=True,
    help="Disable authentication (local/debugging only — auth is ON by default).",
)
def ui_cmd(
    host: str, port: int, repo: Path | None, open_browser: bool, no_auth: bool,
) -> None:
    """Serve the Cairn viewer over a local repo (no tracking server).

    Use this after ``cairn init`` + a local ``Run(repo=...)`` session to
    browse the results. If a tracking server is already running against the
    same repo, point your browser at its UI port instead (this command will
    error to prevent double-writer corruption).
    """
    import uvicorn

    repo = _ensure_repo(repo or _default_repo())
    port = _find_free_port(host, port)
    dd = DataDir(repo)
    has_lock = False
    try:
        dd.acquire_lock("ui", host="127.0.0.1", port=port)
        has_lock = True
    except RepoLockedError as exc:
        holder = exc.holder
        if holder.get("mode") == "server":
            click.echo(
                "ERROR: A `cairn server` is already running on this repo. "
                "Open its UI URL in your browser instead of starting another one.",
                err=True,
            )
            sys.exit(1)
        # SQLite WAL allows concurrent access — no need to block.
        click.echo(
            f"  Note: repo is also in use by {holder.get('mode', '?')} "
            f"(pid={holder.get('pid', '?')}). Running concurrently.\n",
            err=True,
        )

    # Best-effort: advertise our actual URL in the repo dir (`servers.json`)
    # so notebook-side `CardElement._resolve_server()` can auto-discover us
    # regardless of which port we landed on (this port may have
    # auto-incremented past the CLI default). Independent of the write-lock
    # above — concurrent `ui` processes on the same repo are all valid
    # discovery targets.
    dd.add_live_server("ui", host="127.0.0.1", port=port)

    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    auth_enabled = not no_auth
    app = create_app(db=db, blobs=blobs, data_dir_obj=dd, mount_ui=True, auth_enabled=auth_enabled)

    ui_url = f"http://localhost:{port}"
    click.echo(
        f"\n  Cairn UI:\n"
        f"    Local:   {ui_url}\n"
        f"  Repo: {dd.root}\n"
        f"  Auth: {'ON' if auth_enabled else 'OFF (--no-auth)'}\n"
        f"  Press Ctrl+C to stop.\n"
    )
    if auth_enabled:
        _print_bootstrap_banner(db, ui_url=ui_url)
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
        dd.remove_live_server()
        if has_lock:
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
@click.option("--status", default=None)
@click.option("--limit", default=50, type=int)
def list_cmd(
    project: str | None, status: str | None, limit: int
) -> None:
    """List recent runs on the configured server."""
    t = _client()
    try:
        params: dict[str, Any] = {"limit": limit}
        if project:
            params["project"] = project
        if status:
            params["status"] = status
        resp = t.get("/api/runs", params=params)
        runs = resp.json().get("runs", [])
        if not runs:
            click.echo("(no runs)")
            return
        click.echo(
            f"{'RUN_ID':<14} {'STATUS':<10} {'PROJECT':<20} NAME"
        )
        for r in runs:
            click.echo(
                f"{r['id']:<14} {r['status']:<10} {r['project_id']:<20} "
                f"{r.get('display_name') or ''}"
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
            import csv

            rows = []
            for name, pts in seqs.items():
                for p in pts:
                    rows.append({
                        "run_id": run_id,
                        "name": name,
                        "step": p.get("step"),
                        "value": p.get("scalar_value"),
                    })
            with open(out, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=["run_id", "name", "step", "value"])
                writer.writeheader()
                writer.writerows(rows)
        click.echo(f"exported to {out}")
    finally:
        t.close()


@main.command("diff")
@click.argument("run_id")
@click.option(
    "--repo",
    default=None,
    help="Path to a .cairn/ directory or cairn://host:port URL. "
         "Default: ./.cairn if it exists, else env/config.",
)
@click.option(
    "--summary",
    is_flag=True,
    help="Only print the changed-file list, not the unified diffs.",
)
def diff_cmd(run_id: str, repo: str | None, summary: bool) -> None:
    """Diff the current working directory against a run's source snapshot."""
    import difflib
    import hashlib

    from .sdk.reader import Reader

    resolved: str | None
    if repo is not None:
        resolved = repo
    else:
        local = Path.cwd() / ".cairn"
        resolved = str(local) if local.is_dir() else None

    try:
        reader = Reader(repo=resolved)
    except Exception as exc:  # noqa: BLE001
        click.echo(f"failed to open repo: {exc}", err=True)
        sys.exit(1)

    try:
        try:
            run = reader.run(run_id)
        except Exception as exc:  # noqa: BLE001
            click.echo(f"run not found: {exc}", err=True)
            sys.exit(1)

        tree = run.source_tree()
        if tree is None:
            click.echo(f"no source snapshot for run {run_id}", err=True)
            sys.exit(1)

        cwd = Path.cwd()
        # status: "M" modified, "D" deleted, "B" binary differ
        changes: list[tuple[str, str, list[str]]] = []
        for entry in sorted(tree, key=lambda e: e.path):
            rel = entry.path
            local_path = cwd / rel
            if not local_path.exists():
                changes.append(("D", rel, []))
                continue

            try:
                cwd_bytes = local_path.read_bytes()
            except OSError as exc:
                click.echo(f"cannot read {rel}: {exc}", err=True)
                continue

            if entry.sha256 is not None:
                cwd_hash = hashlib.sha256(cwd_bytes).hexdigest()
                if cwd_hash == entry.sha256:
                    continue

            snapshot_text = run.source_file(rel)
            if snapshot_text is None:
                # Binary file (snapshot can't return text) — hash already
                # differs (or wasn't recorded), so flag without a body.
                changes.append(("B", rel, []))
                continue

            try:
                cwd_text = cwd_bytes.decode("utf-8")
            except UnicodeDecodeError:
                changes.append(("B", rel, []))
                continue

            diff_lines = list(difflib.unified_diff(
                snapshot_text.splitlines(keepends=True),
                cwd_text.splitlines(keepends=True),
                fromfile=f"snapshot/{rel}",
                tofile=f"cwd/{rel}",
            ))
            if not diff_lines:
                # Hashes differed but text matches (e.g. trailing newline
                # only) — still surface it.
                changes.append(("M", rel, []))
            else:
                changes.append(("M", rel, diff_lines))

        if not changes:
            click.echo("(no changes)")
            return

        for status, rel, _ in changes:
            click.echo(f"{status}  {rel}")

        if summary:
            return

        for status, rel, lines in changes:
            if not lines:
                continue
            click.echo("")
            click.echo(f"diff --cairn snapshot/{rel} cwd/{rel}")
            for line in lines:
                click.echo(line.rstrip("\n"))
    finally:
        reader.close()


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


# ---------- token management (operator, direct-DB, local host only) --------


def _parse_expiry(value: str) -> str:
    """Accept a relative duration (``30d``, ``12h``, ``90m``, ``60s``) or a
    full ISO8601 timestamp; return an ISO8601 UTC string."""
    m = re.fullmatch(r"(\d+)([smhd])", value.strip())
    if m:
        n, unit = int(m[1]), m[2]
        seconds = n * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
        return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise click.ClickException(
            f"invalid --expires value {value!r} (use e.g. '30d', '12h', or ISO8601)"
        ) from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def _token_db(repo: Path | None) -> tuple[DataDir, Database]:
    """Open the token DB directly (operator on the server host — no remote
    admin API in v1)."""
    resolved = _ensure_repo(repo or _default_repo())
    dd = DataDir(resolved)
    return dd, Database.open(dd.db_path)


@main.group("token")
def token_group() -> None:
    """Manage auth tokens — operates directly on the local data dir's DB.

    Run this on the machine hosting the repo (there is no remote token-admin
    API in v1); pair with ``--repo`` when it isn't ``./.cairn``.
    """


@token_group.command("create")
@click.option("--name", required=True, help="Unique, human-readable token name.")
@click.option(
    "--role", type=click.Choice(_auth.ROLES), default="write", show_default=True,
)
@click.option(
    "--expires", default=None,
    help="Expiry: relative ('30d', '12h', '90m') or ISO8601. Default: never.",
)
@click.option(
    "--repo", default=None,
    type=click.Path(dir_okay=True, file_okay=False, path_type=Path),
    help="Path to the .cairn/ directory. Default: ./.cairn.",
)
def token_create_cmd(name: str, role: str, expires: str | None, repo: Path | None) -> None:
    """Create a token. The plaintext is shown exactly once — save it now."""
    dd, db = _token_db(repo)
    try:
        if _auth.get_token(db, name) is not None:
            raise click.ClickException(f"a token named {name!r} already exists")
        expires_at = _parse_expiry(expires) if expires else None
        _token_id, plaintext = _auth.create_token(db, name=name, role=role, expires_at=expires_at)
        click.echo(f"Created token {name!r} (role={role}) in {dd.root}")
        click.echo(f"Token (copy now, shown once): {plaintext}")
    finally:
        db.close()


@token_group.command("list")
@click.option(
    "--repo", default=None,
    type=click.Path(dir_okay=True, file_okay=False, path_type=Path),
    help="Path to the .cairn/ directory. Default: ./.cairn.",
)
def token_list_cmd(repo: Path | None) -> None:
    """List tokens (never prints hashes or plaintext)."""
    _dd, db = _token_db(repo)
    try:
        rows = _auth.list_tokens(db)
        if not rows:
            click.echo("(no tokens)")
            return
        click.echo(f"{'NAME':<24} {'ROLE':<8} {'STATUS':<10} {'CREATED':<26} LAST_USED")
        for r in rows:
            status = "disabled" if r["disabled"] else ("expired" if r["expires_at"] and r["expires_at"] <= datetime.now(timezone.utc).isoformat() else "active")
            click.echo(
                f"{r['name']:<24} {r['role']:<8} {status:<10} {r['created_at']:<26} "
                f"{r['last_used_at'] or '-'}"
            )
    finally:
        db.close()


@token_group.command("revoke")
@click.argument("ident")
@click.option(
    "--repo", default=None,
    type=click.Path(dir_okay=True, file_okay=False, path_type=Path),
    help="Path to the .cairn/ directory. Default: ./.cairn.",
)
def token_revoke_cmd(ident: str, repo: Path | None) -> None:
    """Revoke a token by name or id (also drops any live sessions from it)."""
    _dd, db = _token_db(repo)
    try:
        if not _auth.revoke_token(db, ident):
            raise click.ClickException(f"no token found matching {ident!r}")
        click.echo(f"revoked {ident}")
    finally:
        db.close()


# ---------- login (SSH-key challenge/response) ------------------------------


def _find_default_ssh_key() -> Path | None:
    ssh_dir = Path.home() / ".ssh"
    for candidate in ("id_ed25519.pub", "id_ecdsa.pub", "id_rsa.pub"):
        p = ssh_dir / candidate
        if p.exists():
            return p
    return None


@main.command("login")
@click.option("--ssh", "use_ssh", is_flag=True, help="Authenticate via SSH key signature.")
@click.option("--server", default=None, help="Server URL. Default: configured server.")
@click.option(
    "--key", "key_path", default=None,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    help="Path to an SSH public key file. Default: auto-detect in ~/.ssh/.",
)
@click.option("--name", default=None, help="Name for the minted token (default: auto-generated).")
def login_cmd(use_ssh: bool, server: str | None, key_path: Path | None, name: str | None) -> None:
    """Log in and save a token to config.toml. Currently supports ``--ssh``."""
    if not use_ssh:
        raise click.ClickException("no login method selected; pass --ssh")

    ssh_keygen = shutil.which("ssh-keygen")
    if not ssh_keygen:
        raise click.ClickException(
            "ssh-keygen not found on PATH; install OpenSSH client tools to use `cairn login --ssh`."
        )

    pub_path = key_path or _find_default_ssh_key()
    if pub_path is None:
        raise click.ClickException(
            "no SSH public key found in ~/.ssh/; pass --key /path/to/id_ed25519.pub"
        )
    pubkey_line = pub_path.read_text().strip()

    server_url = _config.resolve_server(server)
    # /api/auth/ssh/* is exempt from auth (you're not logged in yet), so any
    # already-configured token is simply ignored by the server here.
    t = Transport(server_url)
    try:
        try:
            challenge = t.get("/api/auth/ssh/challenge").json()
        except Exception as exc:  # noqa: BLE001
            raise click.ClickException(f"could not reach {server_url}: {exc}") from None
        nonce, namespace = challenge["nonce"], challenge["namespace"]

        with tempfile.TemporaryDirectory() as tmp:
            message_path = Path(tmp) / "message"
            message_path.write_text(nonce)
            sig_path = Path(tmp) / "message.sig"
            proc = subprocess.run(
                [ssh_keygen, "-Y", "sign", "-f", str(pub_path), "-n", namespace, str(message_path)],
                capture_output=True, text=True, timeout=30,
            )
            if proc.returncode != 0 or not sig_path.exists():
                raise click.ClickException(f"ssh-keygen sign failed: {proc.stderr.strip()}")
            signature = sig_path.read_text()

        try:
            resp = t.post_json(
                "/api/auth/ssh/verify",
                {
                    "nonce": nonce, "namespace": namespace, "pubkey": pubkey_line,
                    "signature": signature, "name": name,
                },
            )
        except Exception as exc:  # noqa: BLE001
            raise click.ClickException(f"login failed: {exc}") from None
        result = resp.json()
    finally:
        t.close()

    existing = _config.load_config_file()
    existing["server"] = server_url
    existing["token"] = result["token"]
    _config.write_config_file(existing)
    click.echo(
        f"Logged in as {result['name']!r} (role={result['role']}). "
        f"Token saved to {_config.config_file_path()}."
    )
