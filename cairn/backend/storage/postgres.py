"""Pooled PostgreSQL transactions with the same explicit SQL contract as SQLite.

Only parameter binding is translated. Queries and schemas use portable SQL;
there is no SQLite emulation or database-wide request lock.
"""

import hashlib
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError


def _parameter(value):
    # Timestamp columns are TEXT on both backends. Binding datetime directly
    # lets PostgreSQL stringify it in the connection's timezone and with a
    # space separator, breaking portable lexical ordering and archive equality.
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def bind_sql(sql, values):
    """Convert unquoted qmark bind markers into SQLAlchemy named parameters."""
    chunks, index, quote = [], 0, None
    offset = 0
    while offset < len(sql):
        char = sql[offset]
        if quote:
            chunks.append(char)
            if char == quote:
                if offset + 1 < len(sql) and sql[offset + 1] == quote:
                    chunks.append(sql[offset + 1])
                    offset += 1
                else:
                    quote = None
        elif char in ("'", '"'):
            quote = char
            chunks.append(char)
        elif char == "?":
            chunks.append(f":p{index}")
            index += 1
        else:
            chunks.append(char)
        offset += 1
    if index != len(values):
        raise ValueError(f"SQL expects {index} parameters; got {len(values)}")
    return text("".join(chunks)), {f"p{i}": _parameter(value) for i, value in enumerate(values)}


class Result:
    def __init__(self, result):
        self.result = result
        self.rowcount = result.rowcount
        self.description = (
            [(key,) for key in result.keys()] if result.returns_rows else None  # noqa: SIM118 - Result is not a mapping
        )

    def fetchone(self):
        row = self.result.fetchone()
        return tuple(row) if row is not None else None

    def fetchall(self):
        return [tuple(row) for row in self.result.fetchall()]

    def close(self):
        self.result.close()

    def __iter__(self):
        return (tuple(row) for row in self.result)


class Connection:
    dialect = "postgresql"

    def __init__(self, connection):
        self.raw = connection

    def execute(self, sql, params=None):
        statement, bound = bind_sql(sql, list(params or []))
        return Result(self.raw.execute(statement, bound))

    def executemany(self, sql, rows):
        rows = list(rows)
        if not rows:
            return None
        statement, _ = bind_sql(sql, rows[0])
        return Result(
            self.raw.execute(
                statement,
                [{f"p{i}": _parameter(value) for i, value in enumerate(row)} for row in rows],
            )
        )


class PostgresDatabase:
    dialect = "postgresql"
    integrity_errors = (IntegrityError,)

    def __init__(self, url):
        url = (
            str(url)
            .replace("postgres://", "postgresql+psycopg://", 1)
            .replace("postgresql://", "postgresql+psycopg://", 1)
        )
        self.engine = create_engine(
            url, pool_pre_ping=True, pool_size=10, max_overflow=20
        )
        self._state = threading.local()
        self.path = None
        try:
            self._initialize()
        except BaseException:
            self.engine.dispose()
            raise

    def _initialize(self):
        from .migrations import (
            _ADDED_COLUMN_INDEXES,
            SCHEMA_SQL,
            SCHEMA_VERSION,
            WIDE_INTEGER_COLUMNS,
            check_schema_version,
            version_from_rows,
        )

        with self.transaction() as connection:
            connection.execute("SELECT pg_advisory_xact_lock(729184623714)")
            tables = inspect(connection.raw).get_table_names()
            exists = "schema_version" in tables
            version = (
                version_from_rows(connection.execute("SELECT version FROM schema_version").fetchall())
                if exists
                else None
            )
            check_schema_version(version, populated=bool(tables))
            if version == SCHEMA_VERSION:
                return
            if version in (7, 8):
                connection.execute(
                    "ALTER TABLE report_builds ADD COLUMN IF NOT EXISTS owner TEXT"
                )
                connection.execute(
                    "ALTER TABLE report_builds ADD COLUMN IF NOT EXISTS lease_until DOUBLE PRECISION"
                )
                connection.execute(
                    "ALTER TABLE comments ADD COLUMN IF NOT EXISTS revision_id TEXT"
                )
                connection.execute(
                    "ALTER TABLE comments ADD COLUMN IF NOT EXISTS selection TEXT"
                )
                connection.execute(
                    "ALTER TABLE comments ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1"
                )
                version = 9
            if version == 9:
                statement = next(sql for sql in SCHEMA_SQL if "CREATE TABLE IF NOT EXISTS run_records (" in sql)
                connection.execute(statement)
                version = 10
            if version == 10:
                for table, columns in WIDE_INTEGER_COLUMNS.items():
                    for column in columns:
                        connection.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE BIGINT')
                connection.execute("UPDATE schema_version SET version = ?", [SCHEMA_VERSION])
            if version is None:
                for statement in SCHEMA_SQL:
                    # Identity columns have an explicit dialect-specific DDL declaration.
                    statement = statement.replace(
                        "INTEGER PRIMARY KEY AUTOINCREMENT",
                        "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY",
                    )
                    connection.execute(statement)
                for statement in _ADDED_COLUMN_INDEXES:
                    connection.execute(statement)
                connection.execute(
                    "INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION]
                )

    @contextmanager
    def transaction(self, *, immediate=False):
        current = getattr(self._state, "connection", None)
        if current is not None:
            checkpoint = len(self._state.hooks)
            try:
                with current.raw.begin_nested():
                    yield current
            except BaseException:
                del self._state.hooks[checkpoint:]
                raise
            return
        with self.engine.connect() as raw:
            connection = Connection(raw)
            self._state.connection, self._state.hooks = connection, []
            try:
                with raw.begin():
                    yield connection
                hooks = self._state.hooks
            finally:
                self._state.connection = None
                self._state.hooks = []
            for hook in hooks:
                hook()

    _write_lock = transaction

    def lock_resource(self, kind, identifier):
        connection = getattr(self._state, "connection", None)
        if connection is None:
            raise RuntimeError("resource locks require a transaction")
        key = int.from_bytes(
            hashlib.sha256(f"{kind}\0{identifier}".encode()).digest()[:8],
            "big",
            signed=True,
        )
        connection.execute("SELECT pg_advisory_xact_lock(?)", [key])

    def after_commit(self, function):
        if getattr(self._state, "connection", None) is not None:
            self._state.hooks.append(function)
        else:
            function()

    @contextmanager
    def _reader(self, sql=None):
        current = getattr(self._state, "connection", None)
        if current is not None:
            yield current
        else:
            with self.engine.connect() as raw:
                yield Connection(raw)

    def write(self, sql, params=None):
        with self.transaction() as connection:
            connection.execute(sql, params)

    def executemany(self, sql, rows):
        with self.transaction() as connection:
            connection.executemany(sql, rows)

    def read(self, sql, params=None):
        with self._reader() as connection:
            return connection.execute(sql, params).fetchall()

    def read_one(self, sql, params=None):
        with self._reader() as connection:
            return connection.execute(sql, params).fetchone()

    def read_columns(self, sql, params=None):
        with self._reader() as connection:
            result = connection.execute(sql, params)
            keys = [column[0] for column in result.description]
            return [dict(zip(keys, row)) for row in result.fetchall()]

    def columns(self, table):
        with self._reader() as connection:
            return [
                column["name"] for column in inspect(connection.raw).get_columns(table)
            ]

    def close(self):
        self.engine.dispose()
