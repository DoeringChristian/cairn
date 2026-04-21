"""DuckDB wrapper, serialized through a single connection + lock.

DuckDB can't open a read-only connection alongside a writer on the same file
within a single process. We therefore use one read/write connection and a
reentrant lock. Since all SDK traffic goes through a single server process
(spec §"Concurrency on the server"), serializing queries is both simple and
performant enough.

``cursor()``-based reads would let readers run off-lock, but DuckDB cursors
share the parent connection's state; we sidestep the complexity by using the
lock for both reads and writes. The server handles hundreds of ops/sec this
way with no contention issues.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Sequence

import duckdb

from .migrations import apply_migrations


class Database:
    """Owns a DuckDB connection for the server process."""

    def __init__(self, path: Path, *, read_only: bool = False):
        self.path = Path(path)
        self._lock = threading.RLock()
        self._read_only = read_only
        self._conn = duckdb.connect(str(self.path), read_only=read_only)
        self._closed = False

    @classmethod
    def open(cls, path: Path, *, read_only: bool = False) -> "Database":
        """Open (or create) a database, run migrations, return it."""
        db = cls(path, read_only=read_only)
        if not read_only:
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

    def executemany(self, sql: str, seq: Sequence[Sequence[Any]]) -> None:
        with self._lock:
            self._conn.executemany(sql, list(seq))

    @contextmanager
    def transaction(self) -> Iterator[duckdb.DuckDBPyConnection]:
        """Yield the connection inside a BEGIN/COMMIT (rollback on error)."""
        with self._lock:
            self._conn.execute("BEGIN TRANSACTION")
            try:
                yield self._conn
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            else:
                self._conn.execute("COMMIT")

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
