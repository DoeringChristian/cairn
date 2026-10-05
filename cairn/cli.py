"""Cairn CLI: `cairn server`, `cairn ui`, `cairn init`, `cairn list`, …

The two server commands:

* `cairn server [--repo PATH]` — runs the ingest tracking API. `--ui`
  additionally launches the paired UI viewer; one Ctrl+C stops both.
* `cairn ui [--repo PATH|cairn://HOST:PORT]` — standalone UI over a
  local repo, or a loopback UI/proxy connected to a remote tracking server.
  Local mode acquires the repo write-lock in `mode="ui"`.

Every command that reads or writes data takes `--repo`/`--server` and works
on a local repo or a server alike; see `cairn/cli_target.py` for how the
target is found and reached.
"""

from __future__ import annotations

import json
import os
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
from . import viewer as _viewer
from .cli_target import (
    Api, explicit, is_repo, open_api, reader_location, require_repo, resolve, target_options,
)
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


def _network_host(host: str) -> str | None:
    """The address other machines reach a server bound to `host` at: the
    LAN IP for a wildcard bind, `host` itself for a specific address, and
    None for loopback (nothing outside this machine can connect)."""
    if host in ("0.0.0.0", "::", ""):
        return _lan_ip()
    if host == "localhost" or host.startswith("127.") or host == "::1":
        return None
    return host


def _default_repo() -> Path:
    """Default repo: ./.cairn in CWD."""
    return Path.cwd() / ".cairn"


def _server_of(request: Any) -> str:
    url = request.url
    return f"{url.scheme}://{url.netloc.decode()}"


def _unauthorized_text(base: str, detail: str, sent_token: bool) -> str:
    """A 401 from `base` as advice: log in, or log in again."""
    if sent_token:
        source = "CAIRN_TOKEN" if os.environ.get("CAIRN_TOKEN") else "the saved token"
        return f"{base}: {detail}; it rejected {source}. Log in again with `cairn login {base}`."
    return f"{base}: {detail}. Log in with `cairn login {base}` (or set CAIRN_TOKEN)."


class _ReaderErrors:
    """Turns the Reader's HTTP errors (a 4xx becomes ValueError/LookupError
    carrying the server's detail) into one-line CLI errors."""

    def __init__(self, server: str) -> None:
        self.server = server.rstrip("/")

    def __enter__(self) -> None:
        return None

    def __exit__(self, typ: Any, exc: BaseException | None, tb: Any) -> None:
        if not isinstance(exc, (ValueError, LookupError)) or isinstance(exc, click.ClickException):
            return
        detail = str(exc.args[0]) if exc.args else str(exc)
        if detail == "authentication required":
            text = _unauthorized_text(
                self.server, detail, _config.resolve_token(self.server) is not None,
            )
        else:
            text = f"{self.server}: {detail}"
        raise click.ClickException(text) from None


def _http_error_text(exc: Exception) -> str | None:
    """A one-line message for an HTTP failure, or None for other errors.

    A 4xx/5xx answer shows the server's `detail`; 401 also says how to
    log in. A connection failure names the server it could not reach.
    """
    import httpx

    if isinstance(exc, httpx.HTTPStatusError):
        resp = exc.response
        base = _server_of(exc.request)
        try:
            detail = resp.json().get("detail")
        except Exception:  # noqa: BLE001
            detail = None
        detail = detail if isinstance(detail, str) and detail else resp.reason_phrase
        if resp.status_code == 401:
            return _unauthorized_text(base, detail, "authorization" in exc.request.headers)
        return f"{base}: {detail} (HTTP {resp.status_code})"
    if isinstance(exc, httpx.TransportError):
        try:
            where = _server_of(exc.request)
        except RuntimeError:  # no request attached
            where = "the server"
        hint = ""
        if where.rstrip("/") == _config.DEFAULT_SERVER:
            # Nothing configured: the fallback URL, not one the user chose.
            hint = (
                ". No server is configured, so this is the default; start one with "
                "`cairn server`, or point at yours with CAIRN_SERVER or `cairn configure`"
            )
        return f"cannot reach {where}: {exc}{hint}"
    return None


class _CairnGroup(click.Group):
    """Turns an HTTP or connection failure in any command into a one-line
    `Error: ...` and exit code 1 instead of a traceback."""

    def invoke(self, ctx: click.Context) -> Any:
        try:
            return super().invoke(ctx)
        except Exception as exc:
            text = _http_error_text(exc)
            if text is None:
                raise
            raise click.ClickException(text) from None


@click.group(cls=_CairnGroup)
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

    After `cairn init` you can log runs with `cairn.Run(project=...)`
    or start the viewer with `cairn ui`.
    """
    repo = (path / ".cairn").resolve()
    already = repo.exists() and (repo / "cairn.db").exists()
    dd = DataDir(repo)
    # `Database.open` runs migrations idempotently, so init is safe to
    # re-run on an existing repo.
    db = Database.open(dd.db_path)
    db.close()
    if already:
        click.echo(f"Cairn repo already initialized at {repo}")
    else:
        click.echo(f"Initialized empty Cairn repo at {repo}")


# ---------- server (ingest by default; optional paired UI) -----------------


def _find_free_port(host: str, start: int, max_attempts: int = 20) -> int:
    """Return `start` if available, otherwise scan upward for a free port.

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

    The tracking server expects to be pointed at a `.cairn/` directory;
    we create it lazily if it doesn't exist so the quickstart is a single
    command.
    """
    repo = repo.expanduser().resolve()
    if not repo.exists():
        click.echo(f"Creating new Cairn repo at {repo}")
    DataDir(repo)  # idempotent
    return repo


def _open_browser_soon(url: str) -> None:
    """Open after uvicorn has had a moment to bind its listening socket."""
    def _open() -> None:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass

    timer = threading.Timer(0.35, _open)
    timer.daemon = True
    timer.start()


def _print_access_banner(
    db: Database,
    *,
    token_plain: str,
    ui_url: str | None,
    api_url: str,
) -> str | None:
    """Print the reusable same-user access token on every authenticated start.

    The token is stored in `auth/local.token` with mode 0600 and has the
    `write` role. Reusing it avoids accumulating a new token row on every
    restart while still giving the operator one copy/paste credential for the
    SDK, ingest API, and UI. A fresh single-use browser OTP is derived from the
    same token for convenience.
    """
    principal = _auth.verify_bearer_token(db, token_plain)
    if principal is None:  # Defensive: ensure_local_token must return a valid token.
        raise RuntimeError("Cairn local access token is not valid")
    lines = [
        "",
        "  ================================================================",
        "  Auth is ON. Reusable local access token:",
        f"    {token_plain}",
        "",
        f"  SDK/CLI:  cairn login {api_url}  (paste the token), or CAIRN_TOKEN=<token>",
    ]
    browser_login_url = None
    if ui_url is not None:
        otp = _auth.create_otp(db, principal.token_id)
        browser_login_url = f"{ui_url}/login?otp={otp}"
        lines += [
            "  Browser (one-time login link, single-use, expires in 15 min):",
            f"    {browser_login_url}",
            "  ...or open the UI and paste the token into the login form.",
        ]
    lines += [
        "  This token is reused from <repo>/auth/local.token (file mode 0600).",
        "  Manage additional tokens with `cairn token create|list|revoke`.",
        "  ================================================================",
        "",
    ]
    click.echo("\n".join(lines))
    return browser_login_url


def _uvicorn_logging(verbose: bool) -> dict[str, object]:
    """Warnings only by default, so the startup banner (URLs, token) stays on screen."""
    return {"log_level": "info" if verbose else "warning", "access_log": verbose}


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
@click.option(
    "--ui/--no-ui",
    default=False,
    show_default=True,
    help="Also launch the paired UI server (ingest-only by default).",
)
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
@click.option(
    "--verbose",
    is_flag=True,
    help="Show the HTTP server's info and access logs (default: warnings only).",
)
@click.option(
    "--alert-webhook",
    envvar="CAIRN_ALERT_WEBHOOK",
    default=None,
    help="Post alerts (run.alert(), failed/killed runs) to this URL: an ntfy topic, "
         "a Slack or Discord webhook, or any JSON webhook. Env: CAIRN_ALERT_WEBHOOK.",
)
def server_cmd(
    host: str,
    port: int,
    ui_port: int | None,
    repo: Path | None,
    open_browser: bool,
    ui: bool,
    advertise: bool,
    no_auth: bool,
    verbose: bool,
    alert_webhook: str | None,
) -> None:
    """Start the Cairn tracking server (ingest-only unless `--ui`)."""
    import uvicorn

    if ui and not _viewer.is_available():
        raise click.ClickException(
            _viewer.NOT_INSTALLED_HINT
            + "\n\nOr drop `--ui` to run the ingest-only tracking server."
        )

    if advertise and no_auth:
        click.echo(
            "WARN: --advertise + --no-auth broadcasts an UNAUTHENTICATED "
            "server on the LAN — anyone on the network can read/write your "
            "data. Use this only on trusted networks.",
            err=True,
        )

    repo = _ensure_repo(repo or _default_repo())
    port = _find_free_port(host, port)
    ui_port = _find_free_port(host, ui_port or port + 1) if ui else (ui_port or port + 1)

    dd = DataDir(repo)
    # Record the UI port (if present, else the ingest port) in the lock
    # file so a concurrent SDK `Run(repo=...)` on the same repo can
    # transparently switch to HTTP mode. We store 127.0.0.1 as the host
    # even when --host is 0.0.0.0 because the SDK that detects the lock
    # will always be on the same machine.
    lock_port = ui_port if ui else port
    try:
        dd.acquire_lock("server", host="127.0.0.1", port=lock_port)
    except RepoLockedError as exc:
        click.echo(f"ERROR: {exc}", err=True)
        sys.exit(1)

    # One Database, shared by both apps (single shared SQLite connection
    # per file in this process, so both FastAPI apps must share the same one.
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)

    auth_enabled = not no_auth
    local_token = None
    if auth_enabled:
        # Same-user local trust: see ui_cmd. The same
        # reusable token is printed below for UI/API copy-paste login.
        local_token = _auth.ensure_local_token(db, dd.root)

    # Ingest-only app (no SPA mount).
    ingest_app = create_app(
        db=db, blobs=blobs, data_dir_obj=dd, mount_ui=False, auth_enabled=auth_enabled,
        alert_webhook=alert_webhook,
    )
    # UI app (ingest + read + SPA). Only built if UI is enabled. It shares
    # the ingest app's DB, so the ingest app alone runs the background loops.
    ui_app = (
        None
        if not ui
        else create_app(
            db=db, blobs=blobs, data_dir_obj=dd, mount_ui=True,
            auth_enabled=auth_enabled, background_tasks=False,
        )
    )
    if ui_app is not None:
        ingest_app.state.ui_port = ui_port

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

    network = _network_host(host)
    banner_lines = [
        "",
        "  Cairn tracking server:",
        f"    Ingest API local:   http://localhost:{port}",
    ]
    if network is not None:
        banner_lines.append(f"    Ingest API network: http://{network}:{port}")
    if ui_app is not None:
        banner_lines.append(f"    UI local:           http://localhost:{ui_port}")
        if network is not None:
            banner_lines.append(f"    UI network:         http://{network}:{ui_port}")
    banner_lines += [
        f"  Repo: {dd.root}",
        f"  Auth: {'ON' if auth_enabled else 'OFF (--no-auth)'}",
        "  Press Ctrl+C to stop.",
        "",
    ]
    click.echo("\n".join(banner_lines))

    browser_url = f"http://localhost:{ui_port}/" if ui_app is not None else None
    if auth_enabled:
        ui_url = f"http://localhost:{ui_port}" if ui_app is not None else None
        assert local_token is not None
        browser_url = _print_access_banner(
            db, token_plain=local_token, ui_url=ui_url, api_url=f"http://localhost:{port}",
        ) or browser_url

    if open_browser and browser_url is not None and host in ("0.0.0.0", "127.0.0.1", "localhost"):
        _open_browser_soon(browser_url)

    servers: list[uvicorn.Server] = []
    threads: list[threading.Thread] = []

    ingest_config = uvicorn.Config(
        app=ingest_app, host=host, port=port, lifespan="on", **_uvicorn_logging(verbose)
    )
    ingest_server = uvicorn.Server(ingest_config)
    servers.append(ingest_server)

    if ui_app is not None:
        ui_config = uvicorn.Config(
            app=ui_app, host=host, port=ui_port, lifespan="on", **_uvicorn_logging(verbose)
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
    type=str,
    help=(
        "Local .cairn/ path, or remote cairn://HOST:PORT / http(s):// URL. "
        "A remote target serves the UI locally and proxies its API. Default: ./.cairn."
    ),
)
@click.option(
    "--open-browser/--no-open-browser",
    default=True,
    show_default=True,
    help="Open the UI in a browser tab after startup.",
)
@click.option(
    "--no-auth",
    is_flag=True,
    help="Disable authentication (local/debugging only — auth is ON by default).",
)
@click.option(
    "--verbose",
    is_flag=True,
    help="Show the HTTP server's info and access logs (default: warnings only).",
)
@click.option(
    "--alert-webhook",
    envvar="CAIRN_ALERT_WEBHOOK",
    default=None,
    help="Post alerts (run.alert(), failed/killed runs) to this URL: an ntfy topic, "
         "a Slack or Discord webhook, or any JSON webhook. Local repos only. Env: CAIRN_ALERT_WEBHOOK.",
)
def ui_cmd(
    host: str,
    port: int,
    repo: str | None,
    open_browser: bool,
    no_auth: bool,
    verbose: bool,
    alert_webhook: str | None,
) -> None:
    """Serve the Cairn viewer over a local repo or remote Cairn server.

    A remote `--repo cairn://HOST:PORT` keeps the page on loopback (a browser
    secure context) while proxying relative API requests to the server. Its
    token (`CAIRN_TOKEN`, else the one `cairn login HOST:PORT` saved)
    authenticates server-side; without one, log in through the browser. `--no-auth` applies only to local-repo mode.
    """
    # First, before resolving the target, acquiring a repo lock or registering a
    # live server — so a missing viewer cannot leave any of that behind.
    if not _viewer.is_available():
        raise click.ClickException(_viewer.NOT_INSTALLED_HINT)

    import uvicorn

    target = _config.resolve_target(repo=repo or str(_default_repo()))
    port = _find_free_port(host, port)
    if not target.is_local:
        from .server.proxy import create_proxy_app

        if host not in ("127.0.0.1", "localhost"):
            raise click.ClickException(
                "remote UI proxy must bind to loopback (use --host 127.0.0.1); "
                "exposing it would expose its server-side credential"
            )
        if no_auth:
            raise click.ClickException("--no-auth is not valid for a remote UI proxy")
        # The token for this remote (CAIRN_TOKEN, else its `cairn login`
        # entry) authenticates server-side; without one, authentication
        # remains an explicit browser interaction.
        token = _config.resolve_token(target.location)
        token_source = "CAIRN_TOKEN" if os.environ.get("CAIRN_TOKEN") else "cairn login"
        try:
            app = create_proxy_app(
                target.location,
                token=token,
            )
        except ValueError as exc:
            raise click.ClickException(str(exc)) from exc
        ui_url = f"http://localhost:{port}"
        click.echo(
            f"\n  Cairn UI proxy:\n"
            f"    Local:   {ui_url}\n"
            f"    Remote:  {target.location}\n"
            f"  Auth: {f'{token_source} token (server-side)' if token else 'browser login'}\n"
            f"  Press Ctrl+C to stop.\n"
        )
        if open_browser and host in ("0.0.0.0", "127.0.0.1", "localhost"):
            _open_browser_soon(f"http://localhost:{port}/")
        uv_config = uvicorn.Config(
            app=app, host=host, port=port, lifespan="on", **_uvicorn_logging(verbose)
        )
        uv_server = uvicorn.Server(uv_config)

        def _proxy_sigint(_sig, _frame):
            uv_server.should_exit = True

        signal.signal(signal.SIGINT, _proxy_sigint)
        uv_server.run()
        return

    repo_path = _ensure_repo(Path(target.location))
    dd = DataDir(repo_path)
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
    app = create_app(
        db=db,
        blobs=blobs,
        data_dir_obj=dd,
        mount_ui=True,
        auth_enabled=auth_enabled,
        alert_webhook=alert_webhook,
    )
    local_token = None
    if auth_enabled:
        # Same-user local trust: a token file in the data
        # dir lets same-account SDK runs upgrade to this server without
        # manual provisioning. Filesystem perms are the boundary.
        local_token = _auth.ensure_local_token(db, dd.root)

    ui_url = f"http://localhost:{port}"
    click.echo(
        f"\n  Cairn UI:\n"
        f"    Local:   {ui_url}\n"
        f"  Repo: {dd.root}\n"
        f"  Auth: {'ON' if auth_enabled else 'OFF (--no-auth)'}\n"
        f"  Press Ctrl+C to stop.\n"
    )
    browser_url = f"http://localhost:{port}/"
    if auth_enabled:
        assert local_token is not None
        browser_url = _print_access_banner(
            db, token_plain=local_token, ui_url=ui_url, api_url=ui_url,
        ) or browser_url
    if open_browser and host in ("0.0.0.0", "127.0.0.1", "localhost"):
        _open_browser_soon(browser_url)

    uv_config = uvicorn.Config(
        app=app, host=host, port=port, lifespan="on", **_uvicorn_logging(verbose)
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


def _repo_health(root: Path) -> dict[str, Any]:
    """A local repo's state: where it is, its layout and schema versions, what
    it holds, and whether a server is serving it."""
    from . import __version__
    from .cli_target import serving_url

    dd = DataDir(root)
    db = Database.open(dd.db_path)
    try:
        def count(sql: str) -> int:
            return int((db.read_one(sql) or (0,))[0])

        (schema,) = db.read_one("SELECT version FROM schema_version") or (None,)
        health: dict[str, Any] = {
            "status": "ok",
            "repo": str(dd.root),
            "version": __version__,
            "layout_version": (dd.root / "version").read_text().strip(),
            "schema_version": schema,
            "projects": count("SELECT COUNT(*) FROM projects"),
            "runs": count("SELECT COUNT(*) FROM runs"),
            "running_runs": count("SELECT COUNT(*) FROM runs WHERE status = 'running'"),
            "archived_runs": count("SELECT COUNT(*) FROM runs WHERE archived_at IS NOT NULL"),
            "series": count("SELECT COUNT(*) FROM (SELECT 1 FROM sequences GROUP BY run_id, name)"),
            "points": count("SELECT COUNT(*) FROM sequences"),
            "artifacts": count("SELECT COUNT(*) FROM artifacts"),
            "artifact_versions": count("SELECT COUNT(*) FROM artifact_versions"),
            "reports": count("SELECT COUNT(*) FROM reports"),
        }
    finally:
        db.close()
    size = dd.db_path.stat().st_size
    for f in dd.artifacts_dir.rglob("*"):
        if f.is_file():
            size += f.stat().st_size
    wal_dir = dd.root / "wals"
    health["size_bytes"] = size
    health["pending_wal_logs"] = len(list(wal_dir.glob("*.wal.jsonl"))) if wal_dir.is_dir() else 0
    served = serving_url(dd.root)
    health["served_by"] = served[0] if served else None
    return health


@main.command("ping")
@target_options
def ping_cmd(repo: str | None, server: str | None) -> None:
    """Check the target: a server's health, or a local repo's state.

    A local repo reports its path, layout and schema versions, how many
    projects, runs, series, points, artifacts and reports it holds, its size,
    WAL logs not ingested yet, and the server serving it (if any).
    """
    target = resolve(repo, server)
    if target.is_local:
        click.echo(json.dumps(_repo_health(require_repo(target.location)), indent=2))
        return
    with Api(target) as api:
        click.echo(json.dumps(api.get("/api/health").json(), indent=2))


_FILTER_HELP = (
    "Keep runs matching a Reader filter, e.g. status=completed, "
    "optim__lr__gt=0.001, tags__contains=best, metrics__val/acc__gt=0.9. "
    "VALUE is parsed as JSON when it can be. Repeatable."
)


def _parse_filters(filters: tuple[str, ...]) -> dict[str, Any]:
    """`KEY=VALUE` options as `RunQuery.filter` keywords (VALUE as JSON when it parses)."""
    kwargs: dict[str, Any] = {}
    for f in filters:
        key, sep, raw = f.partition("=")
        if not sep or not key:
            raise click.UsageError(f"--filter expects KEY=VALUE, got {f!r}")
        try:
            kwargs[key] = json.loads(raw)
        except json.JSONDecodeError:
            kwargs[key] = raw
    return kwargs


#: `cairn list` run-field columns: key -> (header, getter). The default
#: set mirrors the UI runs table's built-ins (name, status, created_at,
#: duration, tags), plus the id and project a shell user needs.
_LIST_FIELDS: dict[str, Any] = {
    "id": lambda r: r.id,
    "name": lambda r: r.name,
    "project": lambda r: r.project,
    "status": lambda r: r.status,
    "created_at": lambda r: r.created_at,
    "ended_at": lambda r: r.ended_at,
    "duration": lambda r: r.duration,
    "tags": lambda r: r.tags,
    "group": lambda r: r.group,
    "job_type": lambda r: r.job_type,
    "hostname": lambda r: r.hostname,
    "user": lambda r: r._raw.get("user"),
    "notes": lambda r: r.notes,
    "archived": lambda r: r.archived,
}
_LIST_PREFIXES = ("config.", "summary.", "metrics.")


def _list_value(run: Any, key: str) -> Any:
    from .server import config_doc

    if key in _LIST_FIELDS:
        return _LIST_FIELDS[key](run)
    if key.startswith("config."):
        return config_doc.get(run.config, key[len("config."):])
    if key.startswith("summary."):
        return config_doc.get(run.summary, key[len("summary."):])
    return run.final.get(key[len("metrics."):])


def _cell(value: Any) -> str:
    """A value as table/CSV text: local times to the minute, durations as
    H:MM:SS, floats to 6 significant digits, lists comma-joined, documents as JSON."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else ""
    if isinstance(value, datetime):
        return value.astimezone().strftime("%Y-%m-%d %H:%M")
    if isinstance(value, timedelta):
        secs = int(value.total_seconds())
        return f"{secs // 3600}:{secs % 3600 // 60:02d}:{secs % 60:02d}"
    if isinstance(value, float):
        return f"{value:.6g}"
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return ",".join(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, timedelta):
        return value.total_seconds()
    return value


def _csv_cell(value: Any) -> str:
    value = _json_value(value)
    return repr(value) if isinstance(value, float) else _cell(value)


@main.command("list")
@click.option("--project", default=None, help="Only runs of this project.")
@click.option("--status", default=None, help="Only runs with this status (running, completed, failed, killed, stopped).")
@click.option("--filter", "filters", multiple=True, metavar="KEY=VALUE", help=_FILTER_HELP)
@click.option(
    "--where", "wheres", multiple=True, metavar="EXPR",
    help="Keep runs for which this cairn.expr expression is true, e.g. "
         "'last(val.acc) > 0.9'. Repeatable.",
)
@click.option(
    "--archived", type=click.Choice(["hide", "only", "all"]), default="hide", show_default=True,
    help="Archived runs: leave them out, list only them, or list both (adds an ARCHIVED column).",
)
@click.option(
    "--sort", "sort_key", default="created_at", show_default=True,
    help="created_at, ended_at, duration, name, status, id, config.<path>, "
         "summary.<path> or metrics.<name> (the final value, as in the UI). "
         "Runs missing the key come last.",
)
@click.option("--asc/--desc", default=False, help="Sort order. Default: descending (newest first).")
@click.option("--limit", default=50, show_default=True, type=click.IntRange(min=1), help="Show at most this many runs.")
@click.option(
    "-c", "--column", "columns", multiple=True, metavar="KEY",
    help="Add a column: config.<path>, summary.<path>, metrics.<name> (final "
         "value) or a run field (group, job_type, hostname, user, notes, "
         "ended_at, archived). Repeatable.",
)
@click.option(
    "--format", "fmt", type=click.Choice(["table", "json", "csv"]), default="table", show_default=True,
    help="json: one object per run with the shown columns' raw values.",
)
@target_options
def list_cmd(
    project: str | None, status: str | None, filters: tuple[str, ...], wheres: tuple[str, ...],
    archived: str, sort_key: str, asc: bool, limit: int, columns: tuple[str, ...], fmt: str,
    repo: str | None, server: str | None,
) -> None:
    """List runs, newest first, from a local repo, a server or a run archive.

    The runs and their order come from the same query evaluator as the UI's
    runs table and `cairn.Reader().runs()`.

    \b
        cairn list --project mnist -c config.optim.lr -c metrics.val/acc
        cairn list --sort metrics.val/acc --filter tags__contains=best
        cairn list --archived all --format json
    """
    from .expr import ExprError
    from .sdk.reader import Reader

    for key in columns:
        if key not in _LIST_FIELDS and not (
            key.startswith(_LIST_PREFIXES) and key not in _LIST_PREFIXES
        ):
            raise click.UsageError(
                f"unknown column {key!r}; use config.<path>, summary.<path>, "
                f"metrics.<name> or one of {', '.join(_LIST_FIELDS)}"
            )
    keys = ["id", "name"] + ([] if project else ["project"]) + [
        "status", "created_at", "duration", "tags",
    ] + (["archived"] if archived == "all" else [])
    keys += [k for k in columns if k not in keys]

    location, label = reader_location(repo, server)
    with Reader(location) as reader, _ReaderErrors(label):
        query = reader.runs(project, archived={"hide": False, "only": True, "all": None}[archived])
        try:
            if status:
                query = query.filter(status=status)
            query = query.filter(**_parse_filters(filters))
            for expr in wheres:
                query = query.where(expr)
            query = query.sort(sort_key, desc=not asc).limit(limit)
        except (ValueError, ExprError) as exc:
            raise click.UsageError(str(exc)) from None
        runs = query.list()
        rows = [[_list_value(r, k) for k in keys] for r in runs]

    if fmt == "json":
        click.echo(json.dumps(
            [{k: _json_value(v) for k, v in zip(keys, row)} for row in rows], indent=2, default=str,
        ))
        return
    if fmt == "csv":
        import csv
        import io

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(keys)
        # Machine-readable cells: ISO 8601 times, seconds, full-precision floats.
        writer.writerows([[_csv_cell(v) for v in row] for row in rows])
        click.echo(buf.getvalue(), nl=False)
        return
    if not rows:
        click.echo("(no runs)")
        return
    headers = [k.upper() if k in _LIST_FIELDS else k for k in keys]
    if "created_at" in keys:
        headers[keys.index("created_at")] = "CREATED"
    if "ended_at" in keys:
        headers[keys.index("ended_at")] = "ENDED"
    text = [[_cell(v) for v in row] for row in rows]
    widths = [max(len(h), *(len(t[i]) for t in text)) for i, h in enumerate(headers)]
    for line in [headers, *text]:
        click.echo("  ".join(c.ljust(w) for c, w in zip(line, widths)).rstrip())


def _viewer_base(t: Any, server: str) -> str | None:
    """The base URL where `server`'s viewer renders, or None if it serves none.

    A `cairn server --ui` ingest port answers `/` with the paired UI port; a
    server without the viewer answers with a no-viewer marker. Any failure to
    tell keeps `server`: a probe that cannot decide must not suppress the
    browser.
    """
    from urllib.parse import urlsplit, urlunsplit

    try:
        body = t.get("/").json()
    except Exception:  # noqa: BLE001
        return server
    if not isinstance(body, dict) or body.get("status") not in {"no_ui", "ingest"}:
        return server
    ui_port = body.get("ui_port")
    if not isinstance(ui_port, int):
        return None
    parts = urlsplit(server)
    host = parts.hostname or "localhost"
    netloc = f"[{host}]:{ui_port}" if ":" in host else f"{host}:{ui_port}"
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


#: The port `cairn ui` binds first (it moves up when that one is taken).
_UI_DEFAULT_PORT = 4301


def _local_viewer(root: Path) -> str | None:
    """The base URL of a running viewer over the local repo at `root`: a
    `cairn ui` listed in its `servers.json`, or the `cairn server --ui`
    holding its lock. None when none is running (or none answers)."""
    import httpx

    from .server.storage.datadir import read_live_servers

    candidates = [
        f"http://{e['host']}:{e['port']}" for e in read_live_servers(root)
        if e.get("host") and isinstance(e.get("port"), int)
    ]
    holder = DataDir(root).read_lock() or {}
    if holder.get("mode") in ("server", "ui") and holder.get("host") and isinstance(holder.get("port"), int):
        from .sdk.local import _holder_is_live

        if _holder_is_live(holder):
            candidates.append(f"http://{holder['host']}:{holder['port']}")
    for url in dict.fromkeys(candidates):
        try:
            with httpx.Client(base_url=url, timeout=2.0) as c:
                if c.get("/api/health").status_code != 200:
                    continue
                base = _viewer_base(c, url)
        except httpx.HTTPError:
            continue
        if base is not None:
            return base.replace("127.0.0.1", "localhost", 1)
    return None


@main.command("open")
@click.argument("run_id")
@click.option("--no-browser", is_flag=True, help="Only print the URL.")
@target_options
def open_cmd(run_id: str, no_browser: bool, repo: str | None, server: str | None) -> None:
    """Print the URL of a run's page in the viewer and open it in a browser.

    Against the ingest port of `cairn server --ui`, the URL points at the
    paired UI port. For a local repo, the URL is that of the `cairn ui` (or
    `cairn server --ui`) serving it; when none is running, the command prints
    the URL the run will have once `cairn ui --repo PATH` runs, and says so.
    """
    with open_api(repo, server) as api:
        run = api.get(f"/api/runs/{run_id}").json()["run"]
        path = f"/p/{run['project_id']}/r/{run['id']}"
        if api.local_root is not None:
            base = _local_viewer(api.local_root)
            if base is None:
                click.echo(f"http://localhost:{_UI_DEFAULT_PORT}{path}")
                click.echo(
                    f"note: no viewer is serving {api.local_root}. Start one with "
                    f"`cairn ui --repo {api.local_root}`; the run is at the URL above "
                    f"once it runs (on the next free port if {_UI_DEFAULT_PORT} is taken).",
                    err=True,
                )
                return
        else:
            base = _viewer_base(api, api.base)
        url = f"{(base or api.base).rstrip('/')}{path}"
        click.echo(url)
        if base is None:
            # Whether that server serves the viewer is its property, not a
            # local install question, so the URL is still printed and the
            # exit code stays 0; opening a browser onto a JSON blob is not.
            click.echo(
                "note: that server is not serving the viewer, so the URL "
                "above will not render. Run it with `cairn server --ui`, or "
                "install the viewer there: pip install 'cairn-track[ui]'",
                err=True,
            )
            return
        if not no_browser:
            try:
                webbrowser.open(url)
            except Exception:  # noqa: BLE001
                pass


@main.command("rm")
@click.argument("run_ids", nargs=-1, required=True, metavar="RUN_ID...")
@target_options
def rm_cmd(run_ids: tuple[str, ...], repo: str | None, server: str | None) -> None:
    """Delete runs and all their data (no undo; `cairn archive` hides a run instead)."""
    with open_api(repo, server) as api:
        for run_id in run_ids:
            api.delete(f"/api/runs/{run_id}")
            click.echo(f"deleted {run_id}")


def _archive_cmd(action: str, doc: str) -> None:
    @main.command(action, help=doc)
    @click.argument("run_ids", nargs=-1, required=True, metavar="RUN_ID...")
    @target_options
    def cmd(run_ids: tuple[str, ...], repo: str | None, server: str | None) -> None:
        with open_api(repo, server) as api:
            for run_id in run_ids:
                api.post(f"/api/runs/{run_id}/{action}")
                click.echo(f"{action}d {run_id}")


_archive_cmd(
    "archive",
    "Archive runs: they keep all their data but leave the default run lists "
    "(`cairn list --archived only|all` and the UI's archived filter show them).",
)
_archive_cmd("unarchive", "Unarchive runs: they return to the default run lists.")


@main.command("export")
@click.argument("run_id", required=False)
@click.option(
    "--project",
    default=None,
    help="Export every run of this project (instead of RUN_ID) as one table "
         "of scalar points with a run_name column; needs the [export] extra.",
)
@click.option(
    "--filter",
    "filters",
    multiple=True,
    metavar="KEY=VALUE",
    help="With --project: " + _FILTER_HELP[0].lower() + _FILTER_HELP[1:],
)
@click.option(
    "--format",
    "fmt",
    type=click.Choice(["json", "csv", "parquet"]),
    default="json",
    show_default=True,
    help="json: the run and every point of every sequence (with --project: "
         "the table as a list of records). csv/parquet: one row per scalar "
         "point (run_id, name, step, wall_time, value; --project adds "
         "run_name); parquet needs the [export] extra.",
)
@click.option(
    "-o", "--out",
    type=click.Path(dir_okay=False, path_type=Path),
    required=True,
    help="File to write.",
)
@target_options
def export_cmd(
    run_id: str | None, project: str | None, filters: tuple[str, ...], fmt: str, out: Path,
    repo: str | None, server: str | None,
) -> None:
    """Write a run's (or a project's runs') metrics to a JSON, CSV or Parquet file.

    For whole runs with everything they logged, as a ZIP another repo can
    import, use `cairn export-runs`.
    """
    if (run_id is None) == (project is None):
        raise click.UsageError("pass either RUN_ID or --project")
    if filters and project is None:
        raise click.UsageError("--filter needs --project")
    if project is not None:
        _export_project(project, filters, fmt, out, repo, server)
        click.echo(f"exported to {out}")
        return
    with open_api(repo, server) as api:
        run = api.get(f"/api/runs/{run_id}").json()
        names = [s["name"] for s in api.get(f"/api/runs/{run_id}/sequences").json()["sequences"]]
        seqs = _run_points(api, run_id, names)
    if fmt == "json":
        out.write_text(json.dumps({"run": run, "sequences": seqs}, default=str, indent=2))
    else:
        rows = [
            {
                "run_id": run_id,
                "name": name,
                "step": p.get("step"),
                "wall_time": p.get("wall_time"),
                "value": p.get("scalar_value"),
            }
            for name, pts in seqs.items()
            for p in pts
            if p.get("scalar_value") is not None
        ]
        if not rows:
            click.echo(f"warning: run {run_id} has no scalar points; the export is empty", err=True)
        _write_table(rows, fmt, out)
    click.echo(f"exported to {out}")


@main.command("export-runs")
@click.argument("run_ids", nargs=-1, required=True, metavar="RUN_ID...")
@click.option(
    "-o", "--out", type=click.Path(dir_okay=False, path_type=Path), required=True,
    help="The .zip file to write.",
)
@target_options
def export_runs_cmd(run_ids: tuple[str, ...], out: Path, repo: str | None, server: str | None) -> None:
    """Write whole runs to a run archive (ZIP): everything they logged, with
    their artifacts, logs, source snapshots, sweeps and artifact registry
    entries. It is the archive the UI's Export button downloads; bring it into
    another repo with `cairn import-runs`, or read it with `cairn.Reader`."""
    with open_api(repo, server) as api:
        data = api.post("/api/export", json={"run_ids": list(run_ids)}).content
    out.write_bytes(data)
    click.echo(f"exported {len(run_ids)} run(s) to {out}")


@main.command("import-runs")
@click.argument("archive", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option(
    "--project", default=None,
    help="Put the runs (with their sweeps and artifact registry entries) into "
         "this project instead of their own.",
)
@click.option(
    "--format", "fmt", type=click.Choice(["table", "json"]), default="table", show_default=True,
)
@target_options
def import_runs_cmd(
    archive: Path, project: str | None, fmt: str, repo: str | None, server: str | None,
) -> None:
    """Import a run archive (from `cairn export-runs` or the UI's Export).

    Every run gets a new id, as an import in the UI does: importing an archive
    twice makes two copies. References between the archive's runs follow the
    new ids; registry entries merge by artifact name.
    """
    params = {"project": project} if project else None
    with open_api(repo, server) as api, archive.open("rb") as fh:
        imported = api.post(
            "/api/import", params=params, files={"file": (archive.name, fh, "application/zip")},
        ).json()["imported"]
    if fmt == "json":
        click.echo(json.dumps(imported, indent=2))
        return
    _print_table(
        ["NEW_ID", "ORIGINAL_ID", "NAME"],
        [[r["new_id"], r["original_id"], r["name"] or ""] for r in imported],
        empty="(no runs in the archive)",
    )


def _print_table(headers: list[str], rows: list[list[str]], *, empty: str) -> None:
    """Left-aligned columns two spaces apart, or `empty` when there are no rows."""
    if not rows:
        click.echo(empty)
        return
    widths = [max(len(h), *(len(r[i]) for r in rows)) for i, h in enumerate(headers)]
    for line in [headers, *rows]:
        click.echo("  ".join(c.ljust(w) for c, w in zip(line, widths)).rstrip())


#: Names per `/api/runs/{id}/series` request (the server's batch limit).
_SERIES_BATCH = 200


def _run_points(t: Api, run_id: str, names: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Every point of the named sequences, fetched in `/series` batches
    and expanded from columns back to one dict per point."""
    out: dict[str, list[dict[str, Any]]] = {}
    for i in range(0, len(names), _SERIES_BATCH):
        batch = names[i:i + _SERIES_BATCH]
        resp = t.get(f"/api/runs/{run_id}/series", params=[("name", n) for n in batch])
        for series in resp.json()["series"]:
            columns, constant = series["columns"], series["constant"]
            out[series["name"]] = [
                {**constant, **{k: col[j] for k, col in columns.items()}}
                for j in range(series["count"])
            ]
    return out


_EXPORT_COLUMNS = ["run_id", "name", "step", "wall_time", "value"]


def _export_project(
    project: str, filters: tuple[str, ...], fmt: str, out: Path, repo: str | None, server: str | None,
) -> None:
    """Every (filtered) run of `project` through `RunQuery.history`."""
    from .sdk.reader import Reader

    kwargs = _parse_filters(filters)
    location, label = reader_location(repo, server)
    with Reader(location) as reader, _ReaderErrors(label):
        query = reader.runs(project).filter(**kwargs)
        try:
            df = query.history()
        except ImportError as exc:
            raise click.ClickException(str(exc)) from exc
        if df.empty:
            why = "the matching runs have no scalar points" if len(query) else f"no run of project {project!r} matches"
            click.echo(f"warning: {why}; the export is empty", err=True)
    # Times as ISO strings: the single-run export's shape.
    columns = list(df.columns)
    rows = [
        {
            **r,
            "wall_time": r["wall_time"].isoformat(),
        }
        for r in df.astype(object).to_dict(orient="records")
    ]
    if fmt == "json":
        out.write_text(json.dumps(rows, default=str, indent=2))
    else:
        _write_table(rows, fmt, out, columns)


def _write_table(
    rows: list[dict[str, Any]], fmt: str, out: Path, columns: list[str] = _EXPORT_COLUMNS,
) -> None:
    """Write long-format point rows as CSV (stdlib) or parquet (pandas+pyarrow)."""
    if fmt == "csv":
        import csv

        with open(out, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        return
    try:
        import pandas as pd
    except ImportError as exc:
        raise click.ClickException(
            "parquet export needs pandas and pyarrow: pip install 'cairn-track[export]'"
        ) from exc
    try:
        pd.DataFrame(rows, columns=columns).to_parquet(out, index=False)
    except ImportError as exc:
        raise click.ClickException(
            "parquet export needs pyarrow: pip install 'cairn-track[export]'"
        ) from exc


@main.command("diff")
@click.argument("run_id")
@click.option(
    "--summary",
    is_flag=True,
    help="Only print the changed-file list, not the unified diffs.",
)
@target_options
def diff_cmd(run_id: str, summary: bool, repo: str | None, server: str | None) -> None:
    """Diff the current working directory against a run's source snapshot."""
    import difflib
    import hashlib

    from .sdk.reader import Reader

    location, label = reader_location(repo, server)
    reader = Reader(repo=location)
    try:
        with _ReaderErrors(label):
            try:
                run = reader.run(run_id)
            except KeyError:
                raise click.ClickException(f"run {run_id} not found") from None

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


@main.command("import-tb")
@click.argument("logdir", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--project", default=None, help="Project to import into. Default: LOGDIR's name.")
@target_options
def import_tb_cmd(logdir: Path, project: str | None, repo: str | None, server: str | None) -> None:
    """Import TensorBoard event files: one run per event directory.

    Scalars, images and histograms keep their step and wall time. Needs the
    [tb] extra.
    """
    from .sdk.import_tb import import_tensorboard

    try:
        run_ids = import_tensorboard(logdir, project=project, repo=explicit(repo, server))
    except ImportError as exc:
        raise click.ClickException(str(exc)) from exc
    for run_id in run_ids:
        click.echo(run_id)
    click.echo(f"imported {len(run_ids)} run(s)", err=True)


@main.command("sync")
@target_options
def sync_cmd(repo: str | None, server: str | None) -> None:
    """Replay run logs that have not reached their repo or server.

    \b
    * Server-mode runs keep a write-ahead log on this machine (CAIRN_WAL_DIR).
      Each log not fully delivered is replayed, in order, to the server
      recorded in it (a log without one goes to the target server).
    * A local target: the WAL logs of `cairn.Run(local_wal=True)` runs in
      the repo's wals/ directory are ingested into it, unless a server is
      serving the repo (it ingests them itself).
    * A server target: requests the SDK spilled to disk are sent to it.
    """
    from .cli_target import serving_url
    from .sdk.wal import WriteAheadLog, default_wal_dir

    target = resolve(repo, server)
    replayed = 0
    failed = 0

    # A local target without a repo only matters when it was named: with
    # nothing configured, sync still replays the server-mode logs.
    if target.is_local and (explicit(repo, server) or is_repo(target.location)):
        root = require_repo(target.location)
        served = serving_url(root)
        if served is not None:
            click.echo(f"{root}: served by {served[0]}, which ingests its WAL logs itself")
        else:
            from .server.storage.blobs import BlobStore
            from .server.wal_ingest import ingest_all

            dd = DataDir(root)
            db = Database.open(dd.db_path)
            try:
                n = ingest_all(dd, db, BlobStore(dd.artifacts_dir))
            finally:
                db.close()
            if n:
                click.echo(f"{root}: ingested {n} op(s) from its WAL logs")
            replayed += n

    wal_dir = default_wal_dir()
    for wal_path in sorted(wal_dir.glob("*.wal.jsonl")) if wal_dir.exists() else []:
        run_id = wal_path.name.removesuffix(".wal.jsonl")
        wal = WriteAheadLog(run_id, wal_dir)
        if not wal.has_pending:
            wal.close()
            continue
        dest = wal.target or (None if target.is_local else target.location)
        if dest is None:
            wal.close()
            failed += 1
            click.echo(
                f"{run_id}: FAILED: the log names no server; replay it with "
                "`cairn sync --server URL`",
                err=True,
            )
            continue
        t = Transport(dest, wal=wal, max_retries=2, backoff_base=0.2, backoff_cap=0.5)
        try:
            n = t.drain_wal()
            replayed += n
            if wal.has_pending:
                # drain_wal stops at the first op that fails to send (and
                # logs why), leaving the rest pending.
                failed += 1
                click.echo(
                    f"{run_id}: FAILED after {n} op(s) -> {dest}; the rest are kept for retry",
                    err=True,
                )
            else:
                click.echo(f"{run_id}: replayed {n} op(s) -> {dest}")
                wal.cleanup()
        except Exception as exc:  # noqa: BLE001 - keep draining other runs
            failed += 1
            click.echo(f"{run_id}: FAILED ({exc}) — kept for retry", err=True)
        finally:
            t.close()

    # Spill dir: requests the transport gave up on and wrote to disk. They
    # carry no server, so they go to the target server.
    spill = default_spill_dir()
    if spill.exists() and any(spill.iterdir()):
        if target.is_local:
            click.echo(
                f"requests spilled to {spill} wait for a server; send them with "
                "`cairn sync --server URL`",
                err=True,
            )
        else:
            t = Transport(target.location, max_retries=2, backoff_base=0.2, backoff_cap=0.5)
            try:
                replayed += t.drain_spill()
            finally:
                t.close()

    # Ops a server rejected (4xx) are set aside, never replayed: say where.
    for dead in sorted(wal_dir.glob("*.dead.jsonl")) if wal_dir.exists() else []:
        with dead.open() as f:
            n = sum(1 for _ in f)
        click.echo(f"{dead.name.removesuffix('.dead.jsonl')}: {n} op(s) rejected by the "
                   f"server, kept in {dead}", err=True)

    if replayed == 0 and failed == 0:
        click.echo("nothing to sync")
    elif failed:
        raise click.ClickException(
            f"sync incomplete: {replayed} op(s) replayed, {failed} run(s) failed; "
            "run `cairn sync` again once the server is reachable"
        )
    else:
        click.echo(f"sync complete: {replayed} op(s) replayed")


@main.command("configure")
@click.option("--server", default=None, help="Server URL.")
@click.option("--repo", default=None, help="A local .cairn/ directory (or a server URL).")
def configure_cmd(server: str | None, repo: str | None) -> None:
    """Save the default target to the config file: a server (`--server`, prompted
    for when neither option is given) or a repo (`--repo`). Setting one removes
    the other, which would otherwise take precedence or be ignored."""
    if server is not None and repo is not None:
        raise click.UsageError("pass --server or --repo, not both")
    existing = _config.load_config_file()
    if server is None and repo is None:
        server = click.prompt(
            "Server URL",
            default=existing.get("server") or _config.DEFAULT_SERVER,
        )
    if repo is not None:
        existing.pop("server", None)
        existing["repo"] = repo if "://" in repo else str(Path(repo).expanduser().resolve())
    else:
        existing.pop("repo", None)
        existing["server"] = server
    _config.write_config_file(existing)
    click.echo(f"wrote {_config.config_file_path()}")


# ---------- token management (operator, direct-DB, local host only) --------


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _parse_expiry(value: str) -> str:
    """Accept a relative duration (`30d`, `12h`, `90m`, `60s`) or a
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
    admin API in v1). The repo must exist: a token for a repo nobody serves
    is a typo, not a request to create one."""
    resolved = (repo or _default_repo()).expanduser().resolve()
    if not (resolved / "cairn.db").exists():
        raise click.ClickException(
            f"no Cairn repo at {resolved}; pass --repo PATH/.cairn (or run `cairn init`)"
        )
    dd = DataDir(resolved)
    return dd, Database.open(dd.db_path)


@main.group("token")
def token_group() -> None:
    """Manage auth tokens — operates directly on the local data dir's DB.

    Run this on the machine hosting the repo (there is no remote token-admin
    API); pair with `--repo` when it isn't `./.cairn`.
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
        # No LAST_USED column: resolving a request never writes, so
        # `tokens.last_used_at` is no longer maintained.
        # NAME is 40 wide: a per-browser token minted by /api/auth/otp is named
        # "<parent>-browser-<16 hex>", i.e. its parent's name plus 25
        # characters, so a long parent name still overflows the column.
        # PARENT is the short id of the token a browser login derived from;
        # revoking that parent revokes this row with it.
        click.echo(f"{'NAME':<40} {'ROLE':<8} {'STATUS':<8} {'PARENT':<9} {'CREATED':<17} EXPIRES")
        now = datetime.now(timezone.utc).isoformat()
        for r in rows:
            status = "revoked" if r["disabled"] else ("expired" if r["expires_at"] and r["expires_at"] <= now else "active")
            parent = (r["parent_id"] or "")[:8]
            click.echo(
                f"{r['name']:<40} {r['role']:<8} {status:<8} {parent:<9} "
                f"{_cell(_parse_iso(r['created_at'])):<17} {_cell(_parse_iso(r['expires_at'])) or 'never'}"
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
    """Revoke a token by name or id, and every token derived from it (the per-browser tokens its login URL minted)."""
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


def _ssh_login(server_url: str, key_path: Path | None, name: str | None) -> dict[str, Any]:
    """Run the SSH challenge/response against `server_url`; return the
    server's `{"token", "name", "role"}` answer."""
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
        return resp.json()
    finally:
        t.close()


def _session(server_url: str, token: str, timeout: float = 10.0) -> dict[str, Any]:
    """`/api/auth/session` of `server_url` as seen with `token`."""
    import httpx

    resp = httpx.get(
        f"{server_url.rstrip('/')}/api/auth/session",
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


def _server_url_arg(url: str | None) -> str:
    """A command's URL argument as a normalized server URL (default: the
    configured server)."""
    try:
        return _config.normalize_server_url(_config.resolve_server(url))
    except ValueError as exc:
        raise click.ClickException(str(exc)) from None


@main.command("login")
@click.argument("url", required=False)
@click.option("--ssh", "use_ssh", is_flag=True, help="Authenticate via SSH key signature.")
@click.option(
    "--token", "token", default=None,
    help="Token to save (e.g. from the server's start-up banner). Prompted for when "
    "neither --token nor --ssh is given.",
)
@click.option(
    "--key", "key_path", default=None,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    help="With --ssh: path to an SSH public key file. Default: auto-detect in ~/.ssh/.",
)
@click.option("--name", default=None, help="With --ssh: name for the minted token (default: auto-generated).")
@click.option("--list", "list_logins", is_flag=True, help="List the servers you are logged into and exit.")
def login_cmd(
    url: str | None,
    use_ssh: bool,
    token: str | None,
    key_path: Path | None,
    name: str | None,
    list_logins: bool,
) -> None:
    """Log in to the server at URL and save its token to config.toml.

    URL is `cairn://host:port` or `http(s)://host:port[/prefix]`
    (default: the configured server). Each server keeps its own token, so you
    can stay logged into several at once; SDK and CLI calls pick the token of
    the server they talk to. `--ssh` mints a token by signing a challenge
    with your SSH key; otherwise paste a token (`--token` or the prompt).
    `--list` shows every saved login and who it is on its server.
    """
    if list_logins:
        _list_logins()
        return
    if use_ssh and token is not None:
        raise click.ClickException("pass either --ssh or --token, not both")
    server_url = _server_url_arg(url)
    if use_ssh:
        result = _ssh_login(server_url, key_path, name)
        token = result["token"]
    else:
        if token is None:
            token = click.prompt(f"Token for {server_url}", hide_input=True).strip()
        try:
            session = _session(server_url, token)
        except Exception as exc:  # noqa: BLE001
            raise click.ClickException(f"could not reach {server_url}: {exc}") from None
        if session.get("auth_enabled") is False:
            click.echo(f"{server_url} runs without auth (--no-auth): no token needed, nothing saved.")
            return
        if not session.get("authenticated"):
            raise click.ClickException(f"{server_url} rejected that token")
        result = {"name": session.get("name"), "role": session.get("role")}

    _config.save_token(server_url, token)
    # The first login also picks the default server; later ones never move it.
    existing = _config.load_config_file()
    if "server" not in existing and "repo" not in existing:
        existing["server"] = server_url
        _config.write_config_file(existing)
    click.echo(
        f"Logged in to {server_url} as {result['name']!r} (role={result['role']}). "
        f"Token saved to {_config.config_file_path()}."
    )
    if os.environ.get("CAIRN_TOKEN"):
        click.echo(
            "note: CAIRN_TOKEN is set and overrides saved tokens for every server.",
            err=True,
        )


def _list_logins() -> None:
    tokens = _config.saved_tokens()
    if not tokens:
        click.echo("(not logged into any server)")
    else:
        click.echo(f"{'SERVER':<40} {'NAME':<32} ROLE")
        for server_url, tok in sorted(tokens.items()):
            try:
                session = _session(server_url, tok, timeout=3.0)
            except Exception:  # noqa: BLE001
                who, role = "(unreachable)", ""
            else:
                if session.get("auth_enabled") is False:
                    who, role = "(auth off)", ""
                elif session.get("authenticated"):
                    who, role = str(session.get("name")), str(session.get("role"))
                else:
                    who, role = "(token rejected)", ""
            click.echo(f"{server_url:<40} {who:<32} {role}")
    if os.environ.get("CAIRN_TOKEN"):
        click.echo("note: CAIRN_TOKEN is set and overrides these for every server.", err=True)


@main.command("logout")
@click.argument("url", required=False)
def logout_cmd(url: str | None) -> None:
    """Forget the saved token of the server at URL (default: the configured
    server). Logins to other servers are kept; the token itself stays valid
    on the server (`cairn token revoke` ends it)."""
    server_url = _server_url_arg(url)
    if server_url not in _config.saved_tokens():
        raise click.ClickException(f"not logged into {server_url}")
    _config.save_token(server_url, None)
    click.echo(f"Logged out of {server_url}.")


# ---------------------------------------------------------------------------
# Sweeps
# ---------------------------------------------------------------------------

def _sweep_transport(repo: str | None) -> Any:
    from .sdk.connect import open_transport

    transport, _ = open_transport(repo)
    return transport


def _sweep_call(repo: str | None, method: str, *args: Any, **kwargs: Any) -> Any:
    t = _sweep_transport(repo)
    try:
        return getattr(t, method)(*args, **kwargs)
    except (LookupError, ValueError, RuntimeError) as exc:
        raise click.ClickException(str(exc).strip("'\"")) from None
    finally:
        t.close()


@main.group("sweep")
def sweep_group() -> None:
    """Hyperparameter sweeps: create one from a YAML file, then run
    `cairn agent <sweep_id>` (on as many machines as you like)."""


@sweep_group.command("create")
@click.argument("config_file", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--project", default=None, help="Overrides the file's `project`.")
@target_options
def sweep_create(config_file: Path, project: str | None, repo: str | None, server: str | None) -> None:
    """Create a sweep from CONFIG_FILE, a wandb-style sweep.yaml:

    \b
        project: mnist
        method: bayes            # grid | random | bayes
        metric: {name: val_loss, goal: minimize}
        command: python train.py
        parameters:
          lr: {min: 0.0001, max: 0.1, distribution: log_uniform}
          layers: {values: [2, 4, 8]}
    """
    import yaml

    repo = explicit(repo, server)
    cfg = yaml.safe_load(config_file.read_text()) or {}
    if not isinstance(cfg, dict):
        raise click.ClickException(f"{config_file}: expected a mapping")
    project = project or cfg.get("project")
    if not project:
        raise click.ClickException("no project: set `project:` in the file or pass --project")
    metric = cfg.get("metric")
    goal = cfg.get("goal")
    if isinstance(metric, dict):
        goal = metric.get("goal", goal)
        metric = metric.get("name")
    info = _sweep_call(repo, "create_sweep", {
        "project": project, "parameters": cfg.get("parameters"), "method": cfg.get("method", "random"),
        "metric": metric, "goal": goal, "command": cfg.get("command"), "name": cfg.get("name"),
    })
    click.echo(f"created sweep {info['id']} ({info['method']}, project {info['project_id']})")
    click.echo(f"run it with:  cairn agent {info['id']}" + (f" --repo {repo}" if repo else ""))


@sweep_group.command("ls")
@click.option("--project", default=None)
@target_options
def sweep_ls(project: str | None, repo: str | None, server: str | None) -> None:
    """List sweeps, newest first."""
    sweeps = _sweep_call(explicit(repo, server), "list_sweeps", project)
    if not sweeps:
        click.echo("(no sweeps)")
        return
    click.echo(f"{'SWEEP_ID':<18} {'STATUS':<10} {'METHOD':<7} {'TRIALS':>6} {'BEST':>12}  NAME")
    for s in sweeps:
        best = s["best"]["value"] if s.get("best") else None
        click.echo(
            f"{s['id']:<18} {s['status']:<10} {s['method']:<7} {s['trial_count']:>6} "
            f"{'' if best is None else f'{best:.6g}':>12}  {s.get('name') or ''}"
        )


def _sweep_action_cmd(action: str) -> None:
    @sweep_group.command(action, help=f"{action.capitalize()} a sweep.")
    @click.argument("sweep_id")
    @target_options
    def cmd(sweep_id: str, repo: str | None, server: str | None) -> None:
        info = _sweep_call(explicit(repo, server), "sweep_action", sweep_id, action)
        click.echo(f"sweep {sweep_id}: {info['status']}")


for _action in ("pause", "resume", "cancel"):
    _sweep_action_cmd(_action)


def _cli_value(value: Any) -> str:
    """A param as a command-line value: scalars as Python prints them, the rest as JSON."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return str(value)
    return json.dumps(value)


@main.command("agent")
@click.argument("sweep_id")
@click.option("--count", default=None, type=int, help="Stop after this many trials.")
@click.option("--poll", default=5.0, type=float, show_default=True,
              help="Seconds between checks while the sweep is paused.")
@target_options
def agent_cmd(
    sweep_id: str, count: int | None, poll: float, repo: str | None, server: str | None,
) -> None:
    """Run a sweep's trials: claim one, run the sweep's command with the
    params as `--key=value` args (and CAIRN_SWEEP_ID / CAIRN_TRIAL_ID set, so
    `cairn.Run()` joins the trial), report the outcome, repeat."""
    import shlex
    import time

    repo = explicit(repo, server)
    t = _sweep_transport(repo)
    try:
        try:
            info = t.get_sweep(sweep_id)
        except (LookupError, ValueError, RuntimeError) as exc:
            raise click.ClickException(str(exc).strip("'\"")) from None
        if not info.get("command"):
            raise click.ClickException(
                f"sweep {sweep_id} has no command; run it from Python with "
                "cairn.Sweep(id).run(fn) instead"
            )
        base = shlex.split(info["command"])
        env = dict(os.environ)
        if repo:
            # The command's cairn.Run() must write where this agent reads.
            env["CAIRN_REPO"] = repo if "://" in repo else str(Path(repo).resolve())
        done = 0
        while count is None or done < count:
            claim = t.next_trial(sweep_id)
            trial = claim["trial"]
            if trial is None:
                if claim["status"] == "paused":
                    time.sleep(poll)
                    continue
                click.echo(f"sweep {sweep_id} is {claim['status']}; stopping")
                break
            argv = base + [f"--{k}={_cli_value(v)}" for k, v in trial["params"].items()]
            click.echo(f"[trial {trial['id']}] {shlex.join(argv)}")
            trial_env = {**env, "CAIRN_SWEEP_ID": sweep_id, "CAIRN_TRIAL_ID": trial["id"]}
            try:
                code = subprocess.run(argv, env=trial_env).returncode
            except KeyboardInterrupt:
                t.report_trial(sweep_id, trial["id"], status="killed")
                click.echo(f"[trial {trial['id']}] interrupted", err=True)
                sys.exit(130)
            except OSError as exc:
                t.report_trial(sweep_id, trial["id"], status="failed")
                raise click.ClickException(f"cannot run {argv[0]!r}: {exc}") from None
            status = "completed" if code == 0 else "failed"
            reported = t.report_trial(sweep_id, trial["id"], status=status)
            value = reported.get("value")
            click.echo(
                f"[trial {trial['id']}] {status}"
                + (f" (exit {code})" if code else "")
                + ("" if value is None else f", {info.get('metric')}={value:.6g}")
            )
            done += 1
    finally:
        t.close()


# `cairn viewer ...` lives in its own module (cairn/cli_viewer.py).
from .cli_viewer import viewer_group as _viewer_group  # noqa: E402

main.add_command(_viewer_group)

# `cairn artifact ...` and `cairn report ...` live in their own modules.
from .cli_artifact import artifact_group as _artifact_group  # noqa: E402
from .cli_report import report_group as _report_group  # noqa: E402

main.add_command(_artifact_group)
main.add_command(_report_group)
