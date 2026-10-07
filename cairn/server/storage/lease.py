"""The repo's ingest lease: which ONE process writes the SQLite database.

Runs never write the database: every local ``cairn.Run`` appends to its own
log (``.cairn/wals/<run_id>.wal.jsonl``). Exactly one process at a time holds
the lease file ``.cairn/ingest.lease`` and is the only one that writes
SQLite: it ingests the logs, and it performs every other write (UI and API
edits, CLI edits, sweep claims, garbage collection).

Who holds it:

* ``cairn ui`` / ``cairn server``: for their whole lifetime, with their URL in
  the lease. Everyone else then sends writes to that server over HTTP.
* Anything else (``cairn.Reader``, a CLI command on a local repo, a sweep
  agent without a server, a run resolving ``use_artifact``): briefly, while
  catching up on pending logs and doing its writes, then released.

Protocol (no ``flock``: it is unreliable on NFS, where cluster repos live).
The lease file holds JSON ``{host, pid, token, expires_at, mode, url}``;
``expires_at`` is wall-clock seconds (``time.time()``).

* **Acquire**: write the JSON to a private temp file, then ``os.link`` it to
  ``ingest.lease``. A hard link is created atomically and fails if the name
  exists, also over NFS (the classic NFS lock-file idiom; with an ambiguous
  NFS reply the temp file's link count settles it), and the lease is never
  seen half-written. This is the exclusive create.
* **Renew**: the holder rewrites the lease every ``RENEW_EVERY`` seconds with
  ``expires_at = now + TTL`` (temp file + ``os.replace``), but only while the
  file still carries its token AND its own previous ``expires_at`` has not
  passed. A holder that missed that deadline (suspended, stalled on I/O)
  has lost the lease and stops writing.
* **Take over**: a lease is dead when ``now > expires_at + GRACE`` (``GRACE``
  covers clock skew between hosts), or at once when it names this host and
  its pid is gone (a ``kill -9``). Takers serialise on a second file,
  ``ingest.lease.takeover``, created the same exclusive way: holding it, a
  taker re-reads the lease, and replaces it only if it still carries the
  dead token. A takeover file older than ``TAKEOVER_STALE`` is removed.
  Because the holder renews only BEFORE ``expires_at`` and a taker replaces
  only AFTER ``expires_at + GRACE``, a renewal and a takeover cannot
  interleave unless one process stalls for ``GRACE`` seconds between two
  adjacent system calls.
* **Release**: the holder unlinks the lease if it still carries its token
  and has not expired (an expired lease is left for a takeover).

The lease is held per process: a second acquire in the holding process
(another Reader, a CLI command in the server's own process) shares it and
counts references; the file goes when the last one releases.

The lease decides who writes; it is not what makes ingestion correct. The
ingester reads each log's offset and applies the ops after it inside ONE
SQLite write transaction, which also stores the new offset
(``wal_ingest``), so even two ingesters at once could never apply a record
twice.
"""

from __future__ import annotations

import atexit
import json
import logging
import os
import random
import secrets
import socket
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from typing_extensions import Self

import psutil

log = logging.getLogger(__name__)

LEASE_NAME = "ingest.lease"
TAKEOVER_NAME = "ingest.lease.takeover"

#: Seconds a lease stays valid after its last renewal.
TTL = 30.0
#: Seconds between renewals.
RENEW_EVERY = 5.0
#: Extra seconds past ``expires_at`` before another host may take over.
GRACE = 10.0
#: A takeover file older than this belongs to a taker that died.
TAKEOVER_STALE = 10.0
#: How long ``acquire`` waits for a brief holder by default.
DEFAULT_WAIT = 300.0


class LeaseBusy(TimeoutError):
    """Another process held the lease for longer than we were willing to wait."""

    def __init__(self, root: Path, holder: dict[str, Any] | None) -> None:
        self.root = root
        self.holder = holder or {}
        super().__init__(
            f"the ingest lease of {root} is held by {self.holder.get('mode', '?')} "
            f"(pid {self.holder.get('pid', '?')} on {self.holder.get('host', '?')})"
        )


class ServedByServer(Exception):
    """A live ``cairn server``/``cairn ui`` holds the lease: send writes there."""

    def __init__(self, holder: dict[str, Any]) -> None:
        self.holder = holder
        super().__init__(f"repo is served by {holder.get('url')}")


def hostname() -> str:
    return socket.gethostname()


def lease_path(root: str | Path) -> Path:
    return Path(root) / LEASE_NAME


def read_lease(root: str | Path) -> dict[str, Any] | None:
    """The lease's contents, or None when there is none (or it is unreadable)."""
    try:
        data = json.loads(lease_path(root).read_text())
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def is_live(info: dict[str, Any] | None, now: float | None = None) -> bool:
    """Whether ``info`` names a holder that may still be writing."""
    if not info:
        return False
    now = time.time() if now is None else now
    try:
        expires = float(info.get("expires_at", 0))
    except (TypeError, ValueError):
        return False
    if now > expires + GRACE:
        return False
    if info.get("host") == hostname():
        pid = info.get("pid")
        return isinstance(pid, int) and psutil.pid_exists(pid)
    return True


def serving_holder(root: str | Path) -> dict[str, Any] | None:
    """The live server (``url`` set) holding the lease in ANOTHER process,
    or None. Within the holding process writes are made in-process."""
    info = read_lease(root)
    if not info or not info.get("url") or not is_live(info):
        return None
    if info.get("host") == hostname() and info.get("pid") == os.getpid():
        return None
    return info


def server_url(info: dict[str, Any]) -> str:
    """The URL to reach a serving holder from this host."""
    url = str(info["url"])
    if info.get("host") == hostname():
        return url
    # The server advertises its loopback URL; from another host use its name.
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    return f"{parts.scheme}://{info.get('host')}:{parts.port}"


def _write_tmp(root: Path, info: dict[str, Any]) -> Path:
    tmp = root / f".{LEASE_NAME}.{info['token']}.{secrets.token_hex(4)}.tmp"
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    with os.fdopen(fd, "w") as fh:
        fh.write(json.dumps(info))
        fh.flush()
        os.fsync(fh.fileno())
    return tmp


def _link_exclusive(tmp: Path, target: Path) -> bool:
    """Atomically create ``target`` as a link to ``tmp``; False if it exists."""
    try:
        os.link(tmp, target)
        return True
    except FileExistsError:
        return False
    except OSError:
        # NFS may report an error for a link that did happen (a retried RPC).
        try:
            return os.stat(tmp).st_nlink == 2
        except OSError:
            return False


class _ProcessLease:
    """The lease held by this process for one repo (shared, ref-counted)."""

    def __init__(self, root: Path, info: dict[str, Any]) -> None:
        self.root = root
        self.info = info
        self.refs = 0
        self.lost = False
        self._stop = threading.Event()
        self._io = threading.Lock()
        self._thread = threading.Thread(
            target=self._renew_loop, daemon=True, name="cairn-lease-renew",
        )
        self._thread.start()

    @property
    def token(self) -> str:
        return self.info["token"]

    def valid(self) -> bool:
        return not self.lost and time.time() < float(self.info["expires_at"])

    def renew(self) -> bool:
        """Extend the lease; False (and ``lost``) once it is no longer ours."""
        with self._io:
            if self.lost:
                return False
            now = time.time()
            current = read_lease(self.root)
            if (
                not current or current.get("token") != self.token
                or now >= float(self.info["expires_at"])
            ):
                self.lost = True
                log.error("lost the ingest lease of %s (now held by %s)", self.root, current)
                return False
            info = {**self.info, "expires_at": now + TTL}
            tmp = _write_tmp(self.root, info)
            try:
                os.replace(tmp, lease_path(self.root))
            except OSError:
                tmp.unlink(missing_ok=True)
                raise
            self.info = info
            return True

    def set_url(self, url: str, mode: str) -> None:
        with self._io:
            self.info = {**self.info, "url": url, "mode": mode}
        self.renew()

    def _renew_loop(self) -> None:
        while not self._stop.wait(RENEW_EVERY):
            try:
                if not self.renew():
                    return
            except OSError:
                log.warning("renewing the ingest lease of %s failed", self.root, exc_info=True)

    def drop(self) -> None:
        """Stop renewing and remove the lease file if it is still ours."""
        self._stop.set()
        with self._io:
            current = read_lease(self.root)
            if (
                not self.lost and current and current.get("token") == self.token
                and time.time() < float(self.info["expires_at"])
            ):
                lease_path(self.root).unlink(missing_ok=True)
            self.lost = True


_registry: dict[Path, _ProcessLease] = {}
_registry_lock = threading.Lock()
_registry_pid = os.getpid()


def _held(root: Path) -> _ProcessLease | None:
    global _registry_pid
    if _registry_pid != os.getpid():  # a forked child does not hold its parent's leases
        _registry.clear()
        _registry_pid = os.getpid()
    held = _registry.get(root)
    if held is not None and held.lost:
        _registry.pop(root, None)
        return None
    return held


class Lease:
    """One reference to this process's lease on a repo (``release()`` it)."""

    def __init__(self, held: _ProcessLease) -> None:
        self._held = held
        self._released = False

    @property
    def root(self) -> Path:
        return self._held.root

    @property
    def info(self) -> dict[str, Any]:
        return dict(self._held.info)

    def valid(self) -> bool:
        """Whether this process still holds the lease (renewed in time)."""
        return not self._released and self._held.valid()

    def set_url(self, url: str, mode: str) -> None:
        """Advertise this process as a server reachable at ``url``."""
        self._held.set_url(url, mode)

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        with _registry_lock:
            held = self._held
            held.refs -= 1
            if held.refs > 0:
                return
            if _registry.get(held.root) is held:
                _registry.pop(held.root, None)
        held.drop()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        self.release()


def _try_takeover(root: Path, dead: dict[str, Any], info: dict[str, Any]) -> bool:
    """Replace the dead lease ``dead`` with ``info``, serialised by the
    takeover file. False when another taker is at it or the lease changed."""
    takeover = root / TAKEOVER_NAME
    tmp = _write_tmp(root, {**info, "takeover": True})
    try:
        if not _link_exclusive(tmp, takeover):
            try:
                age = time.time() - takeover.stat().st_mtime
            except OSError:
                return False
            if age > TAKEOVER_STALE:
                takeover.unlink(missing_ok=True)
            return False
    finally:
        tmp.unlink(missing_ok=True)
    try:
        current = read_lease(root)
        if current is None:
            return False  # released meanwhile: take it the normal way
        if current.get("token") != dead.get("token") or is_live(current):
            return False
        tmp = _write_tmp(root, info)
        try:
            os.replace(tmp, lease_path(root))
        except OSError:
            tmp.unlink(missing_ok=True)
            raise
        return True
    finally:
        takeover.unlink(missing_ok=True)


def acquire(
    root: str | Path,
    *,
    mode: str,
    url: str | None = None,
    wait: float | None = DEFAULT_WAIT,
    defer_to_server: bool = True,
) -> Lease:
    """Take (or share, within this process) the ingest lease of ``root``.

    Waits up to ``wait`` seconds (None: forever) for another holder to
    release it or die. With ``defer_to_server`` a live server holding it
    raises ``ServedByServer`` at once, so the caller can send its writes to
    that server instead.

    Raises:
        ServedByServer: A live server in another process holds the lease.
        LeaseBusy: Another process still held it after ``wait`` seconds.
    """
    root = Path(root).expanduser().resolve()
    deadline = None if wait is None else time.monotonic() + wait
    pause = 0.02
    while True:
        with _registry_lock:
            held = _held(root)
            if held is not None:
                held.refs += 1
                lease = Lease(held)
                if url is not None and held.info.get("url") != url:
                    held.set_url(url, mode)
                return lease
            info = {
                "host": hostname(), "pid": os.getpid(), "token": secrets.token_hex(16),
                "mode": mode, "url": url,
                "acquired_at": time.time(), "expires_at": time.time() + TTL,
            }
            root.mkdir(parents=True, exist_ok=True)
            tmp = _write_tmp(root, info)
            try:
                won = _link_exclusive(tmp, lease_path(root))
            finally:
                tmp.unlink(missing_ok=True)
            if not won:
                current = read_lease(root)
                if current is not None and not is_live(current):
                    info["expires_at"] = time.time() + TTL
                    won = _try_takeover(root, current, info)
                    if won:
                        log.info("took over the dead ingest lease of %s from %s", root, current)
            if won:
                held = _ProcessLease(root, info)
                held.refs = 1
                _registry[root] = held
                return Lease(held)
        if (
            defer_to_server and current is not None and current.get("url")
            and is_live(current) and current.get("pid") != os.getpid()
        ):
            raise ServedByServer(current)
        if deadline is not None and time.monotonic() >= deadline:
            raise LeaseBusy(root, current)
        time.sleep(pause * (0.5 + random.random()))
        pause = min(pause * 2, 0.25)


def held_by_this_process(root: str | Path) -> Lease | None:
    """A new reference to this process's lease on ``root``, if it holds one."""
    root = Path(root).expanduser().resolve()
    with _registry_lock:
        held = _held(root)
        if held is None:
            return None
        held.refs += 1
        return Lease(held)


@atexit.register
def _release_all() -> None:
    with _registry_lock:
        leases = list(_registry.values())
        _registry.clear()
    for held in leases:
        try:
            held.drop()
        except Exception:  # interpreter shutdown: nothing left to tell
            log.debug("releasing the ingest lease at exit failed", exc_info=True)
