"""Data directory layout and PID file management for the server."""

from __future__ import annotations

import errno
import os
from pathlib import Path

import psutil

VERSION_MARKER = "1"
"""Schema/layout version string written to the ``version`` file."""


def default_data_dir() -> Path:
    """Default on-disk location, honoring ``CAIRN_DATA_DIR``."""
    env = os.environ.get("CAIRN_DATA_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".cairn"


class DataDir:
    """Owns the ``.cairn/`` tree: DuckDB file, artifacts, sources, logs, PID file."""

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
    def pid_path(self) -> Path:
        return self.root / "server.pid"

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

    def acquire_pid_lock(self) -> None:
        """Create the PID file atomically. If stale, replace it. Else raise.

        Raises:
            RuntimeError: if another process with the recorded PID is alive.
        """
        pid = os.getpid()
        try:
            fd = os.open(self.pid_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except OSError as exc:
            if exc.errno != errno.EEXIST:
                raise
            # File exists; check whether the owner is still alive.
            try:
                existing = int(self.pid_path.read_text().strip())
            except (OSError, ValueError):
                existing = -1
            if existing > 0 and psutil.pid_exists(existing) and existing != pid:
                raise RuntimeError(
                    f"Cairn server already running at {self.root} (pid {existing})."
                ) from None
            # Stale; remove and retry once.
            self.pid_path.unlink(missing_ok=True)
            fd = os.open(self.pid_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        with os.fdopen(fd, "w") as fh:
            fh.write(str(pid))

    def release_pid_lock(self) -> None:
        """Remove the PID file if it belongs to this process."""
        try:
            existing = int(self.pid_path.read_text().strip())
        except (OSError, ValueError):
            return
        if existing == os.getpid():
            self.pid_path.unlink(missing_ok=True)
