"""Unit tests for schema migrations."""

from __future__ import annotations

import duckdb
import pytest

from cairn.server.storage.migrations import (
    SCHEMA_VERSION,
    apply_migrations,
    hash_context,
)


@pytest.fixture
def conn(tmp_path):
    c = duckdb.connect(str(tmp_path / "test.db"))
    yield c
    c.close()


def _tables(con) -> set[str]:
    rows = con.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='main'"
    ).fetchall()
    return {r[0] for r in rows}


def test_fresh_schema_creates_all_tables(conn):
    apply_migrations(conn)
    expected = {
        "schema_version",
        "projects",
        "tasks",
        "runs",
        "params",
        "sequences",
        "artifacts",
        "run_artifacts",
        "log_lines",
    }
    assert expected.issubset(_tables(conn))


def test_version_row_written(conn):
    apply_migrations(conn)
    (version,) = conn.execute("SELECT version FROM schema_version").fetchone()
    assert version == SCHEMA_VERSION


def test_second_call_is_idempotent(conn):
    apply_migrations(conn)
    # Insert a row and make sure re-running doesn't wipe it.
    conn.execute(
        "INSERT INTO projects VALUES ('p', 'Proj', TIMESTAMP '2025-01-01', NULL, NULL)"
    )
    apply_migrations(conn)
    rows = conn.execute("SELECT id FROM projects").fetchall()
    assert rows == [("p",)]
    # Still only one row in schema_version
    (count,) = conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()
    assert count == 1


def test_indexes_created(conn):
    apply_migrations(conn)
    # DuckDB exposes indexes via pragma_database_list / information_schema; use
    # duckdb_indexes() system function.
    rows = conn.execute("SELECT index_name FROM duckdb_indexes()").fetchall()
    names = {r[0] for r in rows}
    # idx_ prefixed indexes we defined should be present (names are lower-case
    # as written in DDL).
    assert "idx_sequences_run_name" in names
    assert "idx_sequences_step" in names
    assert "idx_log_lines_run" in names


def test_hash_context_deterministic():
    a = hash_context({"subset": "train", "epoch": 1})
    b = hash_context({"epoch": 1, "subset": "train"})
    assert a == b and a != ""


def test_hash_context_empty_cases():
    assert hash_context(None) == ""
    assert hash_context({}) == ""
    assert hash_context("") == ""


def test_hash_context_distinguishes_different_payloads():
    assert hash_context({"subset": "train"}) != hash_context({"subset": "val"})


def test_hash_context_accepts_json_string():
    a = hash_context({"x": 1})
    b = hash_context('{"x": 1}')
    assert a == b


def test_hash_context_handles_malformed_string():
    # Should not raise; produces a hash.
    out = hash_context("not json at all")
    assert out != ""
