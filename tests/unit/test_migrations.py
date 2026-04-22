"""Unit tests for schema migrations."""

from __future__ import annotations

import sqlite3

import pytest

from cairn.server.storage.migrations import (
    SCHEMA_VERSION,
    apply_migrations,
    hash_context,
)


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(str(tmp_path / "test.db"))
    c.execute("PRAGMA foreign_keys=ON")
    yield c
    c.close()


def _tables(con) -> set[str]:
    rows = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    return {r[0] for r in rows}


def test_fresh_schema_creates_all_tables(conn):
    apply_migrations(conn)
    expected = {
        "schema_version",
        "projects",
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
    conn.execute(
        "INSERT INTO projects VALUES ('p', 'Proj', '2025-01-01T00:00:00', NULL, NULL)"
    )
    conn.commit()
    apply_migrations(conn)
    rows = conn.execute("SELECT id FROM projects").fetchall()
    assert rows == [("p",)]
    (count,) = conn.execute("SELECT COUNT(*) FROM schema_version").fetchone()
    assert count == 1


def test_indexes_created(conn):
    apply_migrations(conn)
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).fetchall()
    names = {r[0] for r in rows}
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
    out = hash_context("not json at all")
    assert out != ""
