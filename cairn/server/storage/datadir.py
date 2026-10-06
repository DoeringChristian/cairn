"""Data directory layout and the live-server advertisement (``servers.json``).

Which process writes the database is decided by the ingest lease
(``storage/lease.py``), not here.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

VERSION_MARKER = "3"
"""Schema/layout version string written to the ``version`` file.
Bumped from 2 (removed tasks table). Breaking change."""


def default_data_dir() -> Path:
    """Default on-disk location, honoring ``CAIRN_DATA_DIR``."""
    env = os.environ.get("CAIRN_DATA_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".cairn"


class DataDir:
    """Owns the ``.cairn/`` tree: SQLite file, artifacts, sources, logs."""

    def __init__(self, root: Path):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        version_path = self.root / "version"
        if not version_path.exists():
            version_path.write_text(VERSION_MARKER)

    @property
    def db_path(self) -> Path:
        return self.root / "cairn.db"

    @property
    def artifacts_dir(self) -> Path:
        return self.root / "artifacts"

    @property
    def sources_dir(self) -> Path:
        return self.root / "sources"

    @property
    def logs_dir(self) -> Path:
        return self.root / "logs"

    def run_log_dir(self, run_id: str) -> Path:
        path = self.logs_dir / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def run_source_dir(self, run_id: str) -> Path:
        path = self.sources_dir / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    # ---- live-server advertisement ---------------------------------------
    #
    # ``servers.json`` is a small LIST of live entries (``cairn ui`` /
    # ``cairn server --ui`` processes), so notebook-side rendering
    # (``cairn_ui.cards.elements.CardElement._resolve_server``) can auto-detect
    # *some* reachable server on this repo regardless of which port it
    # landed on (``cairn ui``'s port auto-increments when its default is
    # taken). Entries are pruned by liveness (pid) on every read/write;
    # the reader additionally health-probes before trusting one.

    @property
    def servers_path(self) -> Path:
        return self.root / "servers.json"

    def add_live_server(self, mode: str, *, host: str, port: int) -> None:
        """Best-effort: record this process as a live server for this repo.

        Never raises — a write failure here (read-only FS, race with a
        concurrent writer, ...) must never prevent the server itself from
        starting.
        """
        entry = {
            "pid": os.getpid(),
            "mode": mode,
            "host": host,
            "port": port,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            entries = [e for e in read_live_servers(self.root) if e.get("pid") != entry["pid"]]
            entries.append(entry)
            _write_servers(self.servers_path, entries)
        except OSError:
            pass

    def remove_live_server(self) -> None:
        """Best-effort: drop this process's entry from ``servers.json``."""
        try:
            entries = [e for e in read_live_servers(self.root) if e.get("pid") != os.getpid()]
            _write_servers(self.servers_path, entries)
        except OSError:
            pass


def _write_servers(path: Path, entries: list[dict[str, Any]]) -> None:
    """Atomic-ish write (temp file + rename) so a concurrent reader never
    sees a half-written file."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(entries))
    os.replace(tmp, path)


def read_live_servers(root: Path) -> list[dict[str, Any]]:
    """Return live server entries advertised for the repo at ``root``.

    Reads ``<root>/servers.json`` (written by ``DataDir.add_live_server``,
    called from ``cairn ui``) and prunes entries whose pid is no longer
    alive. Best-effort: returns ``[]`` on any I/O/parse error rather than
    raising — this is read from notebook rendering code
    (``CardElement._resolve_server``), which must never crash a cell.
    Does NOT health-probe the entries' HTTP ports; that is the caller's job
    (a dead pid is a fast local check, a dead port needs a network round
    trip best left to the actual consumer).
    """
    path = Path(root) / "servers.json"
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(raw, list):
        return []
    live = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        pid = entry.get("pid")
        if isinstance(pid, int) and psutil.pid_exists(pid):
            live.append(entry)
    return live
