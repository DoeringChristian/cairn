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
