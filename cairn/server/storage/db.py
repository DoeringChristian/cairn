"""SQLite wrapper with WAL mode for concurrent multi-process access.

SQLite in WAL mode supports:
- One writer at a time (others wait via busy_timeout)
- Multiple concurrent readers alongside the writer, each reading the last
  committed state

This class uses both. Writes go through ONE writer connection, serialized by a
reentrant lock within the process (cross-process serialization is SQLite's
file lock). Reads take a connection from a pool of read-only connections and
never touch that lock, so a page load never waits behind an ingest
transaction, and reads never wait behind each other. The one exception: a
read made by the thread that currently holds the write lock (inside
``transaction()``, say) runs on the writer connection, so it sees that
transaction's own uncommitted rows.

Heavy reads (a statement that returned thousands of rows last time) run one
at a time. Python's sqlite3 releases the GIL around every row it steps, so
two threads fetching large results at once hand the GIL back and forth per
row, each waiting up to the interpreter's switch interval for it: measured,
four concurrent 4000-row series reads took 250-400 ms each instead of 3 ms,
and the WAL could not be checkpointed while they overlapped (it grew by
hundreds of MB). Light reads (a project list, a session check) skip that
queue, so they never wait behind a heavy one.
"""

from __future__ import annotations

import os
import sqlite3
from collections import deque
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Sequence

from .metric_stats import backfill_metric_stats
from .migrations import apply_migrations

#: Idle read connections kept for reuse; more are opened on demand under
#: load and closed again when returned beyond this many.
_MAX_IDLE_READERS = 8

#: A read statement that last took longer than this is "heavy": heavy reads
#: run one at a time (see ``_reader``).
_HEAVY_READ_S = 0.005


class _FifoLock:
    """A lock granted in arrival order (``threading.Lock`` is not: a thread
    that releases and re-acquires in a loop can starve the others)."""

    def __init__(self) -> None:
        self._mutex = threading.Lock()
        self._held = False
        self._waiters: deque[threading.Event] = deque()

    def acquire(self) -> None:
        with self._mutex:
            if not self._held:
                self._held = True
                return
            turn = threading.Event()
            self._waiters.append(turn)
        turn.wait()  # release() hands the lock over by setting it

    def release(self) -> None:
        with self._mutex:
            if self._waiters:
                self._waiters.popleft().set()
            else:
                self._held = False


@contextmanager
def _open_lock(db_path: Path) -> Iterator[None]:
    """Serialize opening ``db_path`` across processes.

    The first open of a new database switches it to WAL mode and creates the
    schema. The journal-mode switch needs the database to itself, and SQLite
    answers a concurrent one with an immediate "database is locked" (the busy
    timeout does not apply to it), so eight sweep workers starting on a fresh
    repo used to lose some of their number. Every open therefore takes an
    exclusive lock on a sibling file for the switch and the migrations; it is
    held for milliseconds, and only while opening.
    """
    lock_path = db_path.with_name(db_path.name + ".open-lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+b") as fh:
        if os.name == "nt":
            import msvcrt

            fh.seek(0)
            while True:
                try:
                    msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
                    break
                except OSError:  # LK_LOCK gives up after ~10 s; keep waiting
                    continue
            try:
                yield
            finally:
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


class Database:
    """Owns a SQLite writer connection and a pool of read connections."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        # Per-thread depth of the write lock: a thread inside a write reads
        # on the writer connection (see ``_reader``).
        self._writing = threading.local()
        self._conn = sqlite3.connect(
            str(self.path),
            check_same_thread=False,
            timeout=10.0,  # busy timeout for write contention
        )
        # Enable WAL mode for concurrent read/write access across processes.
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._pool: list[sqlite3.Connection] = []
        self._pool_lock = threading.Lock()
        self._heavy_gate = _FifoLock()
        # SQL text -> seconds its last run took (bounded; see _note_duration).
        self._read_cost: dict[str, float] = {}
        self._closed = False

    @classmethod
    def open(cls, path: Path) -> "Database":
        """Open (or create) a database, run migrations, return it.

        Safe to call from many processes at once on a database that does not
        exist yet (see ``_open_lock``).
        """
        with _open_lock(Path(path)):
            db = cls(path)
            try:
                with db._write_lock():
                    apply_migrations(db._conn)
                    backfill_metric_stats(db._conn)
            except BaseException:
                db.close()
                raise
        return db

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        with self._pool_lock:
            idle, self._pool = self._pool, []
        for con in idle:
            con.close()
        with self._lock:
            self._conn.close()

    # --- connections -------------------------------------------------------

    @contextmanager
    def _write_lock(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._writing.depth = getattr(self._writing, "depth", 0) + 1
            try:
                yield self._conn
            finally:
                self._writing.depth -= 1

    def _open_reader(self) -> sqlite3.Connection:
        con = sqlite3.connect(str(self.path), check_same_thread=False, timeout=10.0)
        con.execute("PRAGMA busy_timeout=5000")
        # A read connection must never write: its writes would bypass the
        # writer lock that serializes this process's transactions.
        con.execute("PRAGMA query_only=ON")
        return con

    def _note_duration(self, sql: str, seconds: float) -> None:
        cost = self._read_cost
        if len(cost) > 4096 and sql not in cost:  # dynamic SQL: start over
            cost.clear()
        cost[sql] = seconds

    @contextmanager
    def _reader(self, sql: str) -> Iterator[sqlite3.Connection]:
        if getattr(self._writing, "depth", 0):
            # Inside this thread's own write: read what it wrote so far.
            yield self._conn
            return
        heavy = self._read_cost.get(sql, 0.0) > _HEAVY_READ_S
        if heavy:
            self._heavy_gate.acquire()
        with self._pool_lock:
            con = self._pool.pop() if self._pool else None
        if con is None:
            con = self._open_reader()
        t0 = time.perf_counter()
        try:
            yield con
        finally:
            if heavy:
                self._heavy_gate.release()
            self._note_duration(sql, time.perf_counter() - t0)
            with self._pool_lock:
                keep = not self._closed and len(self._pool) < _MAX_IDLE_READERS
                if keep:
                    self._pool.append(con)
            if not keep:
                con.close()

    # --- writes ------------------------------------------------------------

    def write(self, sql: str, params: Sequence[Any] | None = None) -> None:
        with self._write_lock() as con:
            con.execute(sql, params or [])
            con.commit()

    def executemany(self, sql: str, seq: Sequence[Sequence[Any]]) -> None:
        with self._write_lock() as con:
            con.executemany(sql, list(seq))
            con.commit()

    @contextmanager
    def transaction(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        """Yield the writer connection inside a BEGIN/COMMIT (rollback on error).

        ``immediate`` takes the write lock up front: a transaction that reads
        and then writes must, or another process's writer makes its lock
        upgrade fail at once with "database is locked" (no busy wait).
        Keep the body to database work: every other writer in this process
        waits for it (readers do not).
        """
        with self._write_lock() as con:
            con.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
            try:
                yield con
            except BaseException:
                con.rollback()
                raise
            else:
                con.commit()

    # --- reads -------------------------------------------------------------

    def read(
        self, sql: str, params: Sequence[Any] | None = None
    ) -> list[tuple[Any, ...]]:
        with self._reader(sql) as con:
            return con.execute(sql, params or []).fetchall()

    def read_one(
        self, sql: str, params: Sequence[Any] | None = None
    ) -> tuple[Any, ...] | None:
        with self._reader(sql) as con:
            cur = con.execute(sql, params or [])
            try:
                return cur.fetchone()
            finally:
                # An unfinished statement would keep its read snapshot open.
                cur.close()

    def read_columns(
        self, sql: str, params: Sequence[Any] | None = None
    ) -> list[dict[str, Any]]:
        """Return rows as dicts keyed by column name."""
        with self._reader(sql) as con:
            cur = con.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
