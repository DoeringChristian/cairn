"""Data directory layout and exclusive lock management.

The lock file (``.cairn/repo.lock``) is acquired by any process that intends
to WRITE to the repo — whether that's ``cairn server`` holding it for its
whole lifetime or an SDK ``Run`` holding it only while a run is active. The
same mechanism covers both so the "one writer per DuckDB file" invariant is
never violated regardless of which mode is active.
"""

from __future__ import annotations

import errno
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


class RepoLockedError(RuntimeError):
    """Another process already holds the write-lock on this repo."""

    def __init__(self, root: Path, holder: dict[str, Any]):
        self.root = root
        self.holder = holder
        mode = holder.get("mode", "unknown")
        pid = holder.get("pid", "?")
        super().__init__(
            f"Cairn repo at {root} is already in use "
            f"(pid={pid}, mode={mode}). "
            f"If you meant to log to a running server, pass server=<url> "
            f"instead of repo= (or unset CAIRN_REPO)."
        )


class DataDir:
    """Owns the ``.cairn/`` tree: DuckDB file, artifacts, sources, logs, lock file."""

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
    def lock_path(self) -> Path:
        return self.root / "repo.lock"

    # Backwards-compat alias; older callers used ``pid_path``.
    @property
    def pid_path(self) -> Path:
        return self.lock_path

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

    # ---- lock ------------------------------------------------------------

    def read_lock(self) -> dict[str, Any] | None:
        """Return the current lock contents, or None if unlocked/unreadable."""
        try:
            return json.loads(self.lock_path.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def acquire_lock(
        self,
        mode: str,
        *,
        host: str | None = None,
        port: int | None = None,
    ) -> None:
        """Claim the exclusive write-lock. ``mode`` is one of
        ``"server"`` | ``"ui"`` | ``"sdk"``.

        If the holder is a network-reachable service (``"server"`` or
        ``"ui"``), callers should pass ``host`` and ``port`` so that a
        later SDK ``Run(repo=...)`` on the same repo can detect the holder
        and transparently switch to HTTP mode instead of erroring.

        Raises:
            RepoLockedError: if another living process already holds the lock.
        """
        pid = os.getpid()
        payload_dict: dict[str, Any] = {
            "pid": pid,
            "mode": mode,
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        if host is not None:
            payload_dict["host"] = host
        if port is not None:
            payload_dict["port"] = port
        payload = json.dumps(payload_dict)

        def _create_exclusive() -> None:
            fd = os.open(
                self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644
            )
            with os.fdopen(fd, "w") as fh:
                fh.write(payload)

        try:
            _create_exclusive()
            return
        except OSError as exc:
            if exc.errno != errno.EEXIST:
                raise

        # File exists; inspect it.
        holder = self.read_lock() or {}
        holder_pid = holder.get("pid")
        if isinstance(holder_pid, int) and psutil.pid_exists(holder_pid):
            # Even if the holder is our own PID, another DataDir instance in
            # this process grabbed it first — that's still a conflict.
            raise RepoLockedError(self.root, holder)

        # Stale (holder dead, or unparseable). Replace.
        self.lock_path.unlink(missing_ok=True)
        _create_exclusive()

    def release_lock(self) -> None:
        """Remove the lock file if it belongs to this process."""
        holder = self.read_lock()
        if holder and holder.get("pid") == os.getpid():
            self.lock_path.unlink(missing_ok=True)

    # Backwards-compat aliases retained for the CLI's ``server`` command.
    def acquire_pid_lock(self) -> None:
        self.acquire_lock("server")

    def release_pid_lock(self) -> None:
        self.release_lock()

    # ---- live-server advertisement ---------------------------------------
    #
    # Unlike ``repo.lock`` (one exclusive writer), any number of ``cairn
    # ui``/``cairn server`` processes may legitimately serve the same repo
    # concurrently (SQLite WAL mode allows it — see the "Running
    # concurrently" note above). ``servers.json`` is therefore a small LIST
    # of live entries, not a single holder, so notebook-side rendering
    # (``cairn.sdk.elements.CardElement._resolve_server``) can auto-detect
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
