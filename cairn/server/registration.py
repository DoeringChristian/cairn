"""Which server serves a repo: ``<repo>/server.lock`` and ``<repo>/server.json``.

The server is the ONLY writer of a repo's database and blob store, so one
server process at a time serves a repo. It holds an exclusive ``flock`` on
``<repo>/server.lock`` for its lifetime (the server's database must be on a
local filesystem, where ``flock`` is reliable; see ``startup.py``); a second
server on the same repo finds the lock held and exits, naming the first.

Once listening, the server advertises itself in ``<repo>/server.json``
(written atomically, mode 0600, as it holds a token)::

    {"pid", "host", "url", "ui_url", "token", "daemon", "started_at", "version"}

``url`` reaches its API from this machine (loopback), ``ui_url`` its viewer
(None without one), ``token`` is the repo's same-user ``auth/local.token``
(None when auth is off). Readers, CLI commands and runs on this machine find
the server there (``cairn/endpoint.py``); the file goes when the server
stops (and a stale one, its pid gone, is ignored).
"""

from __future__ import annotations

import json
import os
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil

LOCK_NAME = "server.lock"
INFO_NAME = "server.json"


class RepoServed(RuntimeError):
    """Another live server process serves the repo."""

    def __init__(self, root: Path, info: dict[str, Any] | None) -> None:
        self.root = root
        self.info = info or {}
        where = self.info.get("ui_url") or self.info.get("url") or "an unknown URL"
        super().__init__(
            f"the repo {root} is already served by pid {self.info.get('pid', '?')} at {where}; "
            "use that server (or stop it) instead of starting another one"
        )


class ServerLock:
    """The exclusive lock of the one server serving a repo (see the module
    docstring); ``release()`` it, or let the process exit."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._fh: Any = None

    def acquire(self) -> ServerLock:
        """Raises:
            RepoServed: Another process holds it.
        """
        self.root.mkdir(parents=True, exist_ok=True)
        fh = open(self.root / LOCK_NAME, "a+b")  # noqa: SIM115
        try:
            if os.name == "nt":
                import msvcrt

                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            raise RepoServed(self.root, read_info(self.root, live_only=False)) from None
        self._fh = fh
        return self

    def release(self) -> None:
        if self._fh is not None:
            self._fh.close()  # closing drops the flock
            self._fh = None

    def __enter__(self) -> ServerLock:
        return self.acquire()

    def __exit__(self, *exc: object) -> None:
        self.release()


def is_locked(root: Path) -> bool:
    """Whether a server process holds the repo's lock right now."""
    try:
        lock = ServerLock(root).acquire()
    except RepoServed:
        return True
    lock.release()
    return False


def write_info(
    root: Path,
    *,
    url: str,
    token: str | None,
    ui_url: str | None = None,
    daemon: bool = False,
) -> dict[str, Any]:
    """Advertise this process as the repo's server (``server.json``)."""
    from .. import __version__

    info = {
        "pid": os.getpid(),
        "host": socket.gethostname(),
        "url": url,
        "ui_url": ui_url,
        "token": token,
        "daemon": daemon,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "version": __version__,
    }
    path = Path(root) / INFO_NAME
    tmp = path.with_name(f".{INFO_NAME}.{os.getpid()}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(info, fh)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    return info


def read_info(root: Path, *, live_only: bool = True) -> dict[str, Any] | None:
    """The repo's ``server.json``, or None (none, unreadable, or — with
    ``live_only`` — written by a process of this host that is gone)."""
    try:
        info = json.loads((Path(root) / INFO_NAME).read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(info, dict) or not isinstance(info.get("url"), str):
        return None
    if live_only and info.get("host") == socket.gethostname():
        pid = info.get("pid")
        if not isinstance(pid, int) or not psutil.pid_exists(pid):
            return None
    return info


def remove_info(root: Path) -> None:
    """Drop ``server.json`` if this process wrote it."""
    info = read_info(root, live_only=False)
    if info is not None and info.get("pid") == os.getpid():
        try:
            (Path(root) / INFO_NAME).unlink()
        except FileNotFoundError:
            pass
