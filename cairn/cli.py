"""Cairn CLI: ``cairn server``, ``cairn list``, etc.

Client commands (``list``, ``ping``, ``open``, ``rm``, ``export``, ``sync``)
talk to a running server over HTTP. ``cairn server`` is the server itself.
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
from .server.storage.datadir import DataDir, default_data_dir


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

    After `cairn init`, you can either log directly to the repo with
    ``cairn.Run(repo="./.cairn", ...)`` or serve it via
    ``cairn server --data-dir ./.cairn``.
    """
    from .server.storage.db import Database

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


# ---------- server ----------------------------------------------------------


@main.command("server")
@click.option("--host", default="0.0.0.0", show_default=True)
@click.option("--port", default=4300, show_default=True, type=int)
@click.option(
    "--data-dir",
    default=None,
    type=click.Path(dir_okay=True, file_okay=False, path_type=Path),
    help="Override ~/.cairn as the storage location.",
)
@click.option("--no-browser", is_flag=True, help="Don't try to open a browser.")
@click.option(
    "--advertise",
    is_flag=True,
    help="Broadcast this server on the LAN via zeroconf/mDNS.",
)
def server_cmd(
    host: str, port: int, data_dir: Path | None, no_browser: bool, advertise: bool
) -> None:
    """Start the Cairn server."""
    import uvicorn

    resolved = data_dir or default_data_dir()
    dd = DataDir(resolved)
    try:
        dd.acquire_pid_lock()
    except RuntimeError as exc:
        click.echo(f"ERROR: {exc}", err=True)
        sys.exit(1)

    app = create_app(data_dir=resolved)

    advertiser = None
    if advertise:
        try:
            from .server.advertise import Advertiser

            advertiser = Advertiser()
            advertiser.start(host=_lan_ip() if host == "0.0.0.0" else host, port=port)
        except ImportError:
            click.echo(
                "WARN: `cairn-track[discovery]` not installed; --advertise ignored.",
                err=True,
            )

    lan = _lan_ip()
    banner = (
        f"\n  Cairn server running at:\n"
        f"    Local:   http://localhost:{port}\n"
        f"    Network: http://{lan}:{port}\n"
        f"  Data directory: {dd.root}\n"
        f"  Press Ctrl+C to stop.\n"
    )
    click.echo(banner)
    if not no_browser and host in ("0.0.0.0", "127.0.0.1", "localhost"):
        try:
            webbrowser.open(f"http://localhost:{port}/")
        except Exception:  # noqa: BLE001
            pass

    uv_config = uvicorn.Config(
        app=app,
        host=host,
        port=port,
        log_level="info",
        lifespan="on",
    )
    uv_server = uvicorn.Server(uv_config)

    def _sigint(_sig, _frame):
        uv_server.should_exit = True

    signal.signal(signal.SIGINT, _sigint)
    try:
        uv_server.run()
    finally:
        if advertiser is not None:
            advertiser.stop()
        dd.release_pid_lock()


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
        # Simple tabular output.
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
            # Parquet: flatten all scalar points and write via DuckDB.
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
            con.execute("CREATE TABLE r (run_id VARCHAR, name VARCHAR, step BIGINT, value DOUBLE)")
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
        # Walk all run dirs and replay each.
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
        server = click.prompt("Server URL", default=existing.get("server") or _config.DEFAULT_SERVER)
    existing["server"] = server
    _config.write_config_file(existing)
    click.echo(f"wrote {_config.config_file_path()}")
