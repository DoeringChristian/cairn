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
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Sequence

from .metric_stats import backfill_metric_stats
from .migrations import apply_migrations

#: Idle read connections kept for reuse; more are opened on demand under
#: load and closed again when returned beyond this many.
_MAX_IDLE_READERS = 8


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
        self._closed = False

    @classmethod
    def open(cls, path: Path) -> "Database":
        """Open (or create) a database, run migrations, return it."""
        db = cls(path)
        with db._write_lock():
            apply_migrations(db._conn)
            backfill_metric_stats(db._conn)
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

    @contextmanager
    def _reader(self) -> Iterator[sqlite3.Connection]:
        if getattr(self._writing, "depth", 0):
            # Inside this thread's own write: read what it wrote so far.
            yield self._conn
            return
        with self._pool_lock:
            con = self._pool.pop() if self._pool else None
        if con is None:
            con = self._open_reader()
        try:
            yield con
        finally:
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
        with self._reader() as con:
            return con.execute(sql, params or []).fetchall()

    def read_one(
        self, sql: str, params: Sequence[Any] | None = None
    ) -> tuple[Any, ...] | None:
        with self._reader() as con:
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
        with self._reader() as con:
            cur = con.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
