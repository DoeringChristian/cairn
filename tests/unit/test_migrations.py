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


def test_comparison_templates_table_created(conn):
    apply_migrations(conn)
    assert "comparison_templates" in _tables(conn)
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).fetchall()
    assert "idx_comparison_templates_project" in {r[0] for r in rows}


def test_report_templates_table_created(conn):
    apply_migrations(conn)
    assert "report_templates" in _tables(conn)
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).fetchall()
    assert "idx_report_templates_project" in {r[0] for r in rows}


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


def test_tokens_gain_parent_id_column(conn):
    conn.execute(
        "CREATE TABLE tokens (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, "
        "token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL, created_at TEXT NOT NULL, "
        "last_used_at TEXT, expires_at TEXT, disabled INTEGER NOT NULL DEFAULT 0)"
    )
    conn.execute(
        "INSERT INTO tokens VALUES ('t1', 'admin', 'hash', 'admin', '2025-01-01', NULL, NULL, 0)"
    )
    conn.commit()
    apply_migrations(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(tokens)")}
    assert "parent_id" in cols
    assert conn.execute("SELECT parent_id FROM tokens WHERE id = 't1'").fetchone() == (None,)


def test_sessions_table_is_dropped(conn):
    conn.execute(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, token_id TEXT NOT NULL, "
        "created_at TEXT NOT NULL, expires_at TEXT NOT NULL)"
    )
    conn.execute("CREATE INDEX idx_sessions_token ON sessions(token_id)")
    conn.commit()
    apply_migrations(conn)
    assert "sessions" not in _tables(conn)
    assert "idx_sessions_token" not in {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")
    }
    assert "tokens" in _tables(conn)
