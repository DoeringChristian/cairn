"""A run directory: ``$CAIRN_DIR/runs/<run_id>/`` (0.6 spec §2).

::

    run.json               static: run_id, project, endpoint, created_at, sdk version
    log/000000.seg ...     the primary's records (log ``main``)
    blobs/<sha256>         content-addressed media and artifact files
    procs/<label>/log/     an attached process's records (log ``<label>``)
    acked                  the highest seq the server confirmed of ``main``
    procs/<label>/acked    ... of ``<label>``
    FINISHED               the primary finished (JSON: status, exit code, time)
    procs/<label>/FINISHED the attached process detached

Every log has exactly one writer (``log/.lock``); ``acked`` is written only
by the uploader, atomically.
"""

from __future__ import annotations

import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .log import LOCK_NAME, fsync_dir, fsync_file, is_locked, scan

MAIN = "main"


def cairn_dir() -> Path:
    """Where run directories go: ``$CAIRN_DIR``, else ``./.cairn``."""
    env = os.environ.get("CAIRN_DIR")
    return Path(env).expanduser() if env else Path.cwd() / ".cairn"


def runs_root(base: Path | None = None) -> Path:
    return (base if base is not None else cairn_dir()) / "runs"


def write_atomic(path: Path, data: bytes, *, mode: int = 0o644) -> None:
    """Replace ``path`` with ``data`` all at once (tmp + fsync + rename)."""
    tmp = path.with_name(f".{path.name}.tmp-{secrets.token_hex(4)}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            fsync_file(fh.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    fsync_dir(path.parent)


@dataclass(frozen=True)
class LogRef:
    """One log of a run directory."""

    run_dir: "RunDir"
    name: str  # "main" or a process label

    @property
    def owner(self) -> Path:
        """The directory holding the log's ``log/``, ``acked`` and ``FINISHED``."""
        p = self.run_dir.path
        return p if self.name == MAIN else p / "procs" / self.name

    @property
    def log_dir(self) -> Path:
        return self.owner / "log"

    @property
    def acked_path(self) -> Path:
        return self.owner / "acked"

    @property
    def finished_path(self) -> Path:
        return self.owner / "FINISHED"

    def acked(self) -> int:
        try:
            return int(self.acked_path.read_text().strip() or 0)
        except (FileNotFoundError, ValueError):
            return 0

    def set_acked(self, seq: int) -> None:
        write_atomic(self.acked_path, f"{seq}\n".encode())

    def finished(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.finished_path.read_text())
        except (FileNotFoundError, ValueError):
            return None

    def live(self) -> bool:
        """A process writes this log right now."""
        return is_locked(self.log_dir / LOCK_NAME)

    def last_seq(self) -> int:
        return scan(self.log_dir, keep=False).last_seq


class RunDir:
    """The directory of one run (see the module docstring)."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    @classmethod
    def for_run(cls, run_id: str, base: Path | None = None) -> "RunDir":
        return cls(runs_root(base) / run_id)

    @property
    def run_id(self) -> str:
        return self.meta().get("run_id") or self.path.name

    @property
    def meta_path(self) -> Path:
        return self.path / "run.json"

    @property
    def blobs_dir(self) -> Path:
        return self.path / "blobs"

    def exists(self) -> bool:
        return self.meta_path.exists()

    def meta(self) -> dict[str, Any]:
        try:
            data = json.loads(self.meta_path.read_text())
        except (FileNotFoundError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def write_meta(self, meta: dict[str, Any]) -> None:
        self.path.mkdir(parents=True, exist_ok=True)
        # Owner-only: it may name the endpoint's token.
        write_atomic(self.meta_path, json.dumps(meta, indent=1).encode(), mode=0o600)

    def update_meta(self, **fields: Any) -> None:
        meta = self.meta()
        meta.update(fields)
        self.write_meta(meta)

    def log(self, label: str | None = None) -> LogRef:
        return LogRef(self, MAIN if label is None else label)

    def logs(self) -> list[LogRef]:
        """Every log in the directory (the primary's first)."""
        out = []
        if (self.path / "log").is_dir():
            out.append(LogRef(self, MAIN))
        procs = self.path / "procs"
        if procs.is_dir():
            out.extend(LogRef(self, p.name) for p in sorted(procs.iterdir())
                       if (p / "log").is_dir())
        return out

    def mark_finished(self, label: str | None, status: str, exit_code: int | None) -> None:
        ref = self.log(label)
        ref.owner.mkdir(parents=True, exist_ok=True)
        body = {"status": status, "exit_code": exit_code, "time": time.time()}
        write_atomic(ref.finished_path, json.dumps(body).encode())

    def pending(self) -> dict[str, tuple[int, int]]:
        """``{log: (acked, last seq)}`` for the logs not fully acked."""
        out = {}
        for ref in self.logs():
            last, acked = ref.last_seq(), ref.acked()
            if last > acked:
                out[ref.name] = (acked, last)
        return out

    def live(self) -> bool:
        return any(ref.live() for ref in self.logs())

    def complete(self) -> bool:
        """Every log FINISHED, no writer left, and everything acked: safe to
        delete (``cairn sync --clean``)."""
        logs = self.logs()
        if not logs or not self.exists():
            return False
        for ref in logs:
            if ref.finished() is None or ref.live() or ref.last_seq() > ref.acked():
                return False
        return True


def iter_run_dirs(base: Path) -> list[RunDir]:
    """The run directories under ``base``: a ``.cairn`` dir (its ``runs/``),
    a ``runs/`` dir, or a run directory itself."""
    base = Path(base)
    if (base / "run.json").exists():
        return [RunDir(base)]
    root = base / "runs" if (base / "runs").is_dir() else base
    if not root.is_dir():
        return []
    return [RunDir(p) for p in sorted(root.iterdir()) if (p / "run.json").exists()]
