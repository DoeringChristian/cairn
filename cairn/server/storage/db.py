"""SQLite wrapper with WAL mode for concurrent multi-process access.

SQLite in WAL mode supports:
- One writer at a time (others wait via busy_timeout)
- Multiple concurrent readers alongside the writer
- Cross-process access without a server

All SDK traffic is serialized through a reentrant lock within each process.
Cross-process serialization is handled by SQLite's file-level locking.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Sequence

from .migrations import apply_migrations


class Database:
    """Owns a SQLite connection with WAL mode enabled."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(self.path),
            check_same_thread=False,
            timeout=10.0,  # busy timeout for write contention
        )
        # Enable WAL mode for concurrent read/write access across processes.
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._closed = False

    @classmethod
    def open(cls, path: Path) -> "Database":
        """Open (or create) a database, run migrations, return it."""
        db = cls(path)
        with db._lock:
            apply_migrations(db._conn)
        return db

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._conn.close()

    # --- writes ------------------------------------------------------------

    def write(self, sql: str, params: Sequence[Any] | None = None) -> None:
        with self._lock:
            self._conn.execute(sql, params or [])
            self._conn.commit()

    def executemany(self, sql: str, seq: Sequence[Sequence[Any]]) -> None:
        with self._lock:
            self._conn.executemany(sql, list(seq))
            self._conn.commit()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Yield the connection inside a BEGIN/COMMIT (rollback on error)."""
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
            except Exception:
                self._conn.rollback()
                raise
            else:
                self._conn.commit()

    # --- reads -------------------------------------------------------------

    def read(
        self, sql: str, params: Sequence[Any] | None = None
    ) -> list[tuple[Any, ...]]:
        with self._lock:
            return self._conn.execute(sql, params or []).fetchall()

    def read_one(
        self, sql: str, params: Sequence[Any] | None = None
    ) -> tuple[Any, ...] | None:
        with self._lock:
            return self._conn.execute(sql, params or []).fetchone()

    def read_columns(
        self, sql: str, params: Sequence[Any] | None = None
    ) -> list[dict[str, Any]]:
        """Return rows as dicts keyed by column name."""
        with self._lock:
            cur = self._conn.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
