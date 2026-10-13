"""A run's record log: segmented, single writer, group commit (0.6 spec §2).

``LogWriter`` owns a log directory (``log/`` of a run directory, or
``procs/<label>/log/``) for as long as it is open: an exclusive advisory lock
on ``log/.lock`` keeps every other writer out. ``append`` only encodes the
record and hands it to the OS at once (so a killed process loses nothing it
appended); a flusher thread fsyncs at most every ``CAIRN_SYNC_INTERVAL_MS``
(default 100 ms), so a power loss loses at most that much, and ``flush`` /
``close`` fsync at once. A write the OS refuses (disk full) keeps the record
in memory; the flusher retries it, and ``append`` never raises for it.

``LogReader`` reads a log any time, also while its writer appends: a frame
still being written reads as the (retryable) end.
"""

from __future__ import annotations

import atexit
import errno
import logging
import os
import sys
import threading
import time
import weakref
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import codec

log = logging.getLogger(__name__)

SEGMENT_BYTES = 64 << 20
LOCK_NAME = ".lock"
SEGMENT_SUFFIX = ".seg"


class LogLocked(RuntimeError):
    """Another live process writes this log."""


class CorruptLog(RuntimeError):
    """A log is damaged before its tail (only disk damage does that)."""


def sync_interval() -> float:
    """Seconds between group commits (``CAIRN_SYNC_INTERVAL_MS``)."""
    try:
        ms = float(os.environ.get("CAIRN_SYNC_INTERVAL_MS", "100"))
    except ValueError:
        ms = 100.0
    return max(ms, 0.0) / 1000.0


def fsync_file(fd: int) -> None:
    """Make a file's data durable (``F_FULLFSYNC`` on macOS, where plain
    fsync leaves it in the drive's cache)."""
    if sys.platform == "darwin":
        try:
            import fcntl

            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
            return
        except (ImportError, AttributeError, OSError):
            pass
    os.fsync(fd)


def fsync_dir(path: Path) -> None:
    """Make a directory's entries (a created or renamed file) durable."""
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def try_lock(path: Path, *, shared: bool = False) -> int | None:
    """An open fd holding a non-blocking flock on ``path`` (created), or None
    when another open file holds a conflicting one. Where the platform has no
    flock, always succeeds."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        import fcntl
    except ImportError:  # pragma: no cover - Windows
        return fd
    try:
        fcntl.flock(fd, (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB)
    except OSError as exc:
        os.close(fd)
        if exc.errno in (errno.EWOULDBLOCK, errno.EAGAIN, errno.EACCES):
            return None
        raise
    return fd


def is_locked(path: Path) -> bool:
    """True while a process holds ``path``'s exclusive lock (a live writer)."""
    if not path.exists():
        return False
    fd = try_lock(path, shared=True)
    if fd is None:
        return True
    os.close(fd)
    return False


def segment_paths(log_dir: Path) -> list[Path]:
    try:
        return sorted(p for p in log_dir.iterdir() if p.suffix == SEGMENT_SUFFIX)
    except FileNotFoundError:
        return []


def segment_name(index: int) -> str:
    return f"{index:06d}{SEGMENT_SUFFIX}"


class ScanResult:
    """What ``scan`` found in a log."""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []
        #: The last valid record's seq (0: none).
        self.last_seq = 0
        #: Where valid data ends in the last segment: (path, offset).
        self.tail: tuple[Path, int] | None = None
        #: A failed check before the tail (corruption), else None.
        self.error: str | None = None
        #: The tail of the last segment failed a check or was truncated.
        self.torn = False


def scan(log_dir: Path, *, keep: bool = True) -> ScanResult:
    """Read a whole log. Stops at the first bad or truncated frame; a bad
    frame followed by more segments is ``error`` (corruption)."""
    res = ScanResult()
    segs = segment_paths(log_dir)
    expect: int | None = None
    for i, path in enumerate(segs):
        data = path.read_bytes()
        last = i == len(segs) - 1
        try:
            kind = codec.parse_header(data[: codec.HEADER_LEN])
        except codec.CorruptRecord as exc:
            if last and len(data) < codec.HEADER_LEN and data == codec.MAGIC[: len(data)]:
                # A segment whose header write was torn: empty.
                res.tail = (path, 0)
                res.torn = True
                return res
            res.error = f"{path.name}: {exc}"
            return res
        frames, end, problem = codec.decode_frames(data, kind, codec.HEADER_LEN)
        for _end, payload in frames:
            try:
                rec = codec.decode_payload(payload)
            except codec.CorruptRecord as exc:
                problem = str(exc)
                end = _end - len(payload) - codec.FRAME_OVERHEAD
                break
            if expect is not None and rec["seq"] != expect:
                problem = f"seq {rec['seq']} where {expect} was expected"
                end = _end - len(payload) - codec.FRAME_OVERHEAD
                break
            expect = rec["seq"] + 1
            res.last_seq = rec["seq"]
            if keep:
                res.records.append(rec)
        res.tail = (path, end)
        if problem is not None:
            if not last:
                res.error = f"{path.name}: {problem}"
            res.torn = True
            return res
    return res


class LogWriter:
    """The single writer of one log directory.

    Args:
        log_dir: The log's directory (created).
        base_seq: The seq before the first record of a NEW log (a log
            continuing one the server has records of already).
        interval: Seconds between group commits (default
            ``sync_interval()``).
        segment_bytes: Start a new segment past this size.
        before_commit: Called (under the append lock) right before each
            commit, and before each ``append``: appends what the caller
            accumulates (points, console lines) so it lands in order.
        on_commit: Called with the last durable seq after each commit.

    Raises:
        LogLocked: Another live process writes this log.
        CorruptLog: The log is damaged before its tail.
    """

    def __init__(
        self,
        log_dir: Path,
        *,
        base_seq: int = 0,
        interval: float | None = None,
        segment_bytes: int = SEGMENT_BYTES,
        before_commit: Callable[[], None] | None = None,
        on_commit: Callable[[int], None] | None = None,
    ) -> None:
        self.dir = Path(log_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        lock_fd = try_lock(self.dir / LOCK_NAME)
        if lock_fd is None:
            raise LogLocked(f"{self.dir} is written by another live process")
        self._lock_fd: int | None = lock_fd
        self._interval = sync_interval() if interval is None else interval
        self._segment_bytes = segment_bytes
        self._before_commit = before_commit
        self._on_commit = on_commit
        try:
            self._open_tail(base_seq)
        except BaseException:
            os.close(lock_fd)
            self._lock_fd = None
            raise
        self._lock = threading.RLock()  # appends
        self._io = threading.Lock()  # writes + fsync
        self._pending: list[bytes] = []  # payloads the OS refused (disk full), in order
        self._retired: list[Any] = []  # full segments' files, closed after their fsync
        self._in_hook = False
        self._closed = False
        self._error: BaseException | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="cairn-log-commit", daemon=True)
        self._thread.start()
        _live_writers.add(self)

    # ---- opening -----------------------------------------------------------

    def _open_tail(self, base_seq: int) -> None:
        res = scan(self.dir, keep=False)
        if res.error is not None:
            raise CorruptLog(f"{self.dir}: {res.error}; run `cairn fsck`")
        segs = segment_paths(self.dir)
        if not segs:
            self.last_seq = base_seq
            self._new_segment(0)
            self.durable_seq = self.last_seq
            return
        self.last_seq = res.last_seq if res.last_seq else base_seq
        path, end = res.tail if res.tail is not None else (segs[-1], codec.HEADER_LEN)
        self._index = int(path.stem)
        if end < codec.HEADER_LEN:
            # Torn header: rewrite the segment from scratch.
            path.unlink()
            self._new_segment(self._index)
        else:
            self._fh = open(path, "r+b")  # noqa: SIM115
            if res.torn:
                log.warning("cairn: %s: dropping a torn record at its tail", path)
                self._fh.truncate(end)
                fsync_file(self._fh.fileno())
            self._fh.seek(end)
            self._kind = codec.parse_header(path.read_bytes()[: codec.HEADER_LEN])
            self._size = end
        self.durable_seq = self.last_seq

    def _new_segment(self, index: int) -> None:
        self._index = index
        self._kind = codec.default_kind()
        path = self.dir / segment_name(index)
        self._fh = open(path, "xb")  # noqa: SIM115
        self._fh.write(codec.header(self._kind))
        self._fh.flush()
        fsync_file(self._fh.fileno())
        fsync_dir(self.dir)
        self._size = codec.HEADER_LEN

    # ---- appending -----------------------------------------------------------

    def append(self, op: str, fields: dict[str, Any] | None = None) -> int:
        """Add a record; returns its seq. Never waits on the disk.

        Raises:
            RuntimeError: The writer is closed.
        """
        with self._lock:
            if self._closed:
                raise RuntimeError(f"log {self.dir} is closed")
            self._drain_hook()
            return self._append_locked(op, fields or {})

    def _append_locked(self, op: str, fields: dict[str, Any]) -> int:
        seq = self.last_seq + 1
        payload = codec.encode_payload(codec.make_record(seq, op, time.time(), fields))
        self._pending.append(payload)
        self.last_seq = seq
        self._write_pending()
        return seq

    def _write_pending(self) -> None:
        """Hand the pending records to the OS one by one (under ``_lock``); on
        an error (disk full) the rest stay pending for the flusher to retry."""
        while self._pending:
            try:
                self._write(self._pending[0])
            except OSError as exc:
                if self._error is None:
                    log.error("cairn: cannot write the run log %s: %s", self.dir, exc)
                self._error = exc
                return
            self._pending.pop(0)

    def append_from_hook(self, op: str, fields: dict[str, Any]) -> int:
        """``append`` for the ``before_commit`` hook (which runs under the lock)."""
        return self._append_locked(op, fields)

    def _drain_hook(self) -> None:
        if self._before_commit is not None and not self._in_hook:
            self._in_hook = True
            try:
                self._before_commit()
            finally:
                self._in_hook = False

    # ---- committing ------------------------------------------------------------

    def flush(self) -> int:
        """Write and fsync everything appended so far; returns the durable seq."""
        with self._io:
            with self._lock:
                if not self._closed:
                    self._drain_hook()
                self._write_pending()
                if self._pending:
                    raise self._error or OSError(f"cannot write the run log {self.dir}")
                self._error = None
                upto = self.last_seq
                fh, retired, self._retired = self._fh, self._retired, []
            if upto > self.durable_seq:
                # Outside the append lock: appends go on while the disk syncs.
                for old in retired:
                    fsync_file(old.fileno())
                    old.close()
                fsync_file(fh.fileno())
                self.durable_seq = upto
                if self._on_commit is not None:
                    try:
                        self._on_commit(upto)
                    except Exception:  # noqa: BLE001
                        log.debug("on_commit hook failed", exc_info=True)
        return self.durable_seq

    def _write(self, payload: bytes) -> None:
        """Write one frame to the OS (no fsync), rolling the segment when it is
        full (under ``_lock``). All or nothing: a failed write is cut off again."""
        frame = codec.encode_frame(payload, self._kind)
        if self._size + len(frame) > self._segment_bytes and self._size > codec.HEADER_LEN:
            self._retired.append(self._fh)  # fsynced and closed by the next flush
            self._new_segment(self._index + 1)
            frame = codec.encode_frame(payload, self._kind)
        fd = self._fh.fileno()
        view = memoryview(frame)
        try:
            while view:
                view = view[os.write(fd, view):]
        except OSError:
            os.ftruncate(fd, self._size)
            os.lseek(fd, self._size, os.SEEK_SET)
            raise
        self._size += len(frame)

    def _loop(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self.flush()
            except Exception as exc:  # noqa: BLE001 - disk full, I/O error
                if self._error is None:
                    log.error("cairn: cannot write the run log %s: %s", self.dir, exc)
                self._error = exc

    def close(self) -> None:
        """Commit everything and release the log."""
        with self._lock:
            if self._closed:
                return
        self._stop.set()
        if self._thread is not threading.current_thread():
            self._thread.join(timeout=10)
        try:
            self.flush()
        finally:
            with self._lock:
                self._closed = True
            try:
                self._fh.close()
            except OSError:
                pass
            if self._lock_fd is not None:
                os.close(self._lock_fd)
                self._lock_fd = None
            _live_writers.discard(self)

    @property
    def closed(self) -> bool:
        return self._closed


#: Open writers, committed once more at interpreter exit (a safety net under
#: a Run's own atexit finish, which closes its writer).
_live_writers: "weakref.WeakSet[LogWriter]" = weakref.WeakSet()


def _flush_all() -> None:
    for w in list(_live_writers):
        try:
            w.flush()
        except Exception:  # noqa: BLE001
            pass


atexit.register(_flush_all)




class LogReader:
    """Reads one log incrementally: a cursor remembers where the last read
    ended, so polling a growing log never re-reads it. Safe while the
    log's writer appends (a frame still being written reads as the end)."""

    def __init__(self, log_dir: Path) -> None:
        self.dir = Path(log_dir)
        self._reset()

    def _reset(self) -> None:
        self._seg = 0  # index into segment_paths()
        self._offset = 0  # 0: header not read yet
        self._kind: int | None = None
        self._next_seq: int | None = None  # the seq the next record must have
        #: A failed check the reader cannot get past (corruption), else None.
        self.error: str | None = None

    def read(
        self, after_seq: int, *, max_bytes: int = 4 << 20, max_records: int = 10_000,
    ) -> list[dict[str, Any]]:
        """Records with ``seq > after_seq`` in order: as many as fit in
        ``max_bytes`` of payload (at least one). Empty at the log's current end."""
        if self._next_seq is not None and self._next_seq - 1 > after_seq:
            self._reset()  # asked to go back (a server that lost records)
        out: list[dict[str, Any]] = []
        total = 0
        while len(out) < max_records and total < max_bytes and self.error is None:
            segs = segment_paths(self.dir)
            if self._seg >= len(segs):
                return out
            path = segs[self._seg]
            last = self._seg == len(segs) - 1
            try:
                with open(path, "rb") as fh:
                    if self._kind is None:
                        head = fh.read(codec.HEADER_LEN)
                        if len(head) < codec.HEADER_LEN:
                            if not last:
                                self.error = f"{path.name}: truncated header"
                            return out
                        try:
                            self._kind = codec.parse_header(head)
                        except codec.CorruptRecord as exc:
                            self.error = f"{path.name}: {exc}"
                            return out
                        self._offset = codec.HEADER_LEN
                    fh.seek(self._offset)
                    data = fh.read()
            except FileNotFoundError:
                return out
            frames, _end, problem = codec.decode_frames(
                data, self._kind, max_bytes=max_bytes - total,
            )
            for _f_end, payload in frames:
                try:
                    rec = codec.decode_payload(payload)
                except codec.CorruptRecord as exc:
                    self.error = f"{path.name}: {exc}"
                    return out
                if self._next_seq is not None and rec["seq"] != self._next_seq:
                    self.error = (
                        f"{path.name}: seq {rec['seq']} where {self._next_seq} was expected"
                    )
                    return out
                self._next_seq = rec["seq"] + 1
                self._offset += len(payload) + codec.FRAME_OVERHEAD
                if rec["seq"] > after_seq:
                    out.append(rec)
                    total += len(payload)
                    if len(out) >= max_records:
                        return out
            if problem == codec.LIMIT:
                continue
            if problem is None and not last:
                # A finished segment (its writer moved on): the next one.
                self._seg += 1
                self._kind = None
                self._offset = 0
                continue
            if problem is not None and not last:
                self.error = f"{path.name}: {problem} before the next segment"
            # The last segment's end: clean, still being written, or torn.
            return out
        return out

    @property
    def position(self) -> int | None:
        """The seq of the last record read so far (None: nothing read)."""
        return None if self._next_seq is None else self._next_seq - 1
