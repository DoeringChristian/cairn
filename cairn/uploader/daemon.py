"""The uploader daemon: one per (user, machine) (0.6 spec §3).

State lives in ``$CAIRN_AGENT_DIR`` (default ``$XDG_STATE_HOME/cairn/agent``,
i.e. ``~/.local/state/cairn/agent``)::

    agent.lock        held (flock) by the live daemon: at most one runs
    agent.pid         its pid
    agent.log         its log
    runs/<key>        one registered run directory each (its absolute path)
    runs/<key>.status the last upload attempt of that directory (JSON)

A ``cairn.Run`` registers its directory and calls ``ensure_running``, which
spawns ``python -m cairn sync --daemon`` detached unless the lock is held;
training never waits for it. The daemon uploads every registered directory,
backs off per server (1 s doubling to 60 s, with jitter; a 429/503's
Retry-After wins), drops a directory from the registry once it is fully
confirmed with no writer left, and exits after ``CAIRN_AGENT_IDLE_EXIT``
seconds (default 600) with nothing registered.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from ..sdk.runlog.log import try_lock
from ..sdk.runlog.rundir import RunDir, write_atomic
from .client import IngestClient, UploadError
from .sync import DirSync, endpoint_for

log = logging.getLogger(__name__)

BACKOFF_MIN = 1.0
BACKOFF_MAX = 60.0


def agent_dir() -> Path:
    env = os.environ.get("CAIRN_AGENT_DIR")
    if env:
        return Path(env).expanduser()
    state = os.environ.get("XDG_STATE_HOME")
    base = Path(state).expanduser() if state else Path.home() / ".local" / "state"
    return base / "cairn" / "agent"


def idle_exit() -> float:
    try:
        return float(os.environ.get("CAIRN_AGENT_IDLE_EXIT", "600"))
    except ValueError:
        return 600.0


# ---- registry -------------------------------------------------------------------


def _key(path: Path) -> str:
    return hashlib.sha1(str(path).encode()).hexdigest()[:20]


def register(run_dir: Path, base: Path | None = None) -> Path:
    """Register a run directory for upload; returns its registry entry."""
    base = base or agent_dir()
    path = Path(run_dir).resolve()
    reg = base / "runs"
    reg.mkdir(parents=True, exist_ok=True)
    entry = reg / _key(path)
    if not entry.exists():
        write_atomic(entry, str(path).encode())
    return entry


def unregister(entry: Path) -> None:
    entry.unlink(missing_ok=True)
    entry.with_name(entry.name + ".status").unlink(missing_ok=True)


def registered(base: Path | None = None) -> list[tuple[Path, Path]]:
    """``[(entry, run dir)]``."""
    reg = (base or agent_dir()) / "runs"
    try:
        entries = sorted(p for p in reg.iterdir() if "." not in p.name)
    except FileNotFoundError:
        return []
    out = []
    for e in entries:
        try:
            out.append((e, Path(e.read_text().strip())))
        except (OSError, ValueError):
            continue
    return out


def status_path(run_dir: Path, base: Path | None = None) -> Path:
    path = Path(run_dir).resolve()
    return (base or agent_dir()) / "runs" / f"{_key(path)}.status"


def read_status(run_dir: Path, base: Path | None = None) -> dict[str, Any] | None:
    try:
        return json.loads(status_path(run_dir, base).read_text())
    except (FileNotFoundError, ValueError):
        return None


# ---- the process ------------------------------------------------------------------


def is_running(base: Path | None = None) -> bool:
    """A daemon holds the lock."""
    base = base or agent_dir()
    lock = base / "agent.lock"
    if not lock.exists():
        return False
    fd = try_lock(lock)
    if fd is None:
        return True
    os.close(fd)
    return False


_spawn_lock = threading.Lock()


def ensure_running(base: Path | None = None) -> bool:
    """Start the daemon, detached, unless one runs. Returns True when one
    was spawned. Never waits for it."""
    base = base or agent_dir()
    with _spawn_lock:
        if is_running(base):
            return False
        base.mkdir(parents=True, exist_ok=True)
        env = {**os.environ, "CAIRN_AGENT_DIR": str(base)}
        kwargs: dict[str, Any] = {}
        if os.name == "posix":
            kwargs["start_new_session"] = True
        else:  # pragma: no cover - Windows
            kwargs["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
                subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen(  # noqa: S603
            [sys.executable, "-m", "cairn", "sync", "--daemon"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            close_fds=True, env=env, cwd=str(base), **kwargs,
        )
        return True


class _Endpoint:
    """A server's client plus its backoff state."""

    def __init__(self, url: str, token: str | None) -> None:
        self.client = IngestClient(url, token)
        self.backoff = 0.0
        self.not_before = 0.0

    def failed(self, exc: UploadError) -> None:
        if exc.rejected:
            self.backoff = BACKOFF_MAX
        else:
            self.backoff = min(BACKOFF_MAX, max(BACKOFF_MIN, self.backoff * 2))
        wait = self.backoff * random.uniform(0.75, 1.25)
        if exc.retry_after is not None:
            wait = max(exc.retry_after, 0.0)
        self.not_before = time.monotonic() + wait

    def ok(self) -> None:
        self.backoff = 0.0
        self.not_before = 0.0


class Daemon:
    """The upload loop (``run``). ``once`` is one round, for tests."""

    def __init__(self, base: Path | None = None, *, poll: float = 0.5) -> None:
        self.base = base or agent_dir()
        self.poll = poll
        self._dirs: dict[Path, DirSync] = {}
        self._endpoints: dict[tuple[str, str | None], _Endpoint] = {}
        # Directories whose endpoint cannot be resolved: retry time + backoff.
        self._unresolved: dict[Path, tuple[float, float]] = {}
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def _status(self, run_dir: Path, error: str | None, *, sent: int = 0) -> None:
        try:
            write_atomic(status_path(run_dir, self.base), json.dumps({
                "time": time.time(), "error": error, "sent": sent,
            }).encode())
        except OSError:
            pass

    def _endpoint(self, rd: RunDir) -> _Endpoint | None:
        now = time.monotonic()
        retry = self._unresolved.get(rd.path)
        if retry is not None and now < retry[0]:
            return None
        try:
            key = endpoint_for(rd)
        except Exception as exc:  # noqa: BLE001
            back = min(BACKOFF_MAX, max(BACKOFF_MIN, (retry[1] if retry else 0) * 2))
            self._unresolved[rd.path] = (now + back * random.uniform(0.75, 1.25), back)
            self._status(rd.path, f"no server: {exc}")
            log.info("%s: no endpoint yet: %s", rd.path, exc)
            return None
        self._unresolved.pop(rd.path, None)
        if key not in self._endpoints:
            self._endpoints[key] = _Endpoint(*key)
        return self._endpoints[key]

    def once(self) -> tuple[int, int]:
        """One round over the registry -> (records confirmed, dirs registered)."""
        sent = 0
        entries = registered(self.base)
        seen = set()
        for entry, path in entries:
            seen.add(path)
            rd = RunDir(path)
            if not rd.exists():
                unregister(entry)
                self._dirs.pop(path, None)
                continue
            ds = self._dirs.setdefault(path, DirSync(rd))
            ep = self._endpoint(rd)
            if ep is None:
                continue
            if time.monotonic() < ep.not_before:
                continue
            try:
                n = ds.step(ep.client)
            except UploadError as exc:
                ep.failed(exc)
                self._status(path, str(exc))
                log.warning("%s: upload failed (retrying in %.1f s): %s",
                            path, ep.not_before - time.monotonic(), exc)
                continue
            except Exception as exc:  # noqa: BLE001 - one bad dir must not stop the rest
                self._status(path, f"{type(exc).__name__}: {exc}")
                log.exception("%s: upload failed", path)
                continue
            ep.ok()
            sent += n
            self._status(path, None, sent=n)
            if n == 0 and ds.settled():
                log.info("%s: fully uploaded", path)
                unregister(entry)
                self._dirs.pop(path, None)
        for gone in set(self._dirs) - seen:
            self._dirs.pop(gone, None)
        return sent, len(registered(self.base))

    def run(self) -> int:
        """Hold the lock and loop until idle (or stopped). Returns an exit code:
        0, or 1 when another daemon holds the lock."""
        self.base.mkdir(parents=True, exist_ok=True)
        fd = try_lock(self.base / "agent.lock")
        if fd is None:
            return 1
        try:
            write_atomic(self.base / "agent.pid", f"{os.getpid()}\n".encode())
            idle_since = time.monotonic()
            limit = idle_exit()
            while not self._stop.is_set():
                sent, n_dirs = self.once()
                if n_dirs:
                    idle_since = time.monotonic()
                elif time.monotonic() - idle_since > limit:
                    log.info("idle for %.0f s; exiting", limit)
                    break
                if not sent:
                    self._stop.wait(self.poll)
        finally:
            for ep in self._endpoints.values():
                ep.client.close()
            (self.base / "agent.pid").unlink(missing_ok=True)
            os.close(fd)
        return 0


def main() -> int:
    """The daemon process (``cairn sync --daemon``)."""
    base = agent_dir()
    base.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(base / "agent.log")
    handler.setFormatter(logging.Formatter("%(asctime)s %(process)d %(levelname)s %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    daemon = Daemon(base)

    def _term(signum: int, frame: Any) -> None:
        daemon.stop()

    signal.signal(signal.SIGTERM, _term)
    signal.signal(signal.SIGINT, _term)
    log.info("uploader started (pid %d)", os.getpid())
    code = daemon.run()
    if code:
        log.info("another uploader holds %s; exiting", base / "agent.lock")
    return code
