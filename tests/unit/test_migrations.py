"""Unit tests for schema migrations."""

from __future__ import annotations

import sqlite3

import pytest

from cairn.server.storage.migrations import (
    SCHEMA_VERSION,
    apply_migrations,
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
        "artifact_versions",
        "artifact_entries",
        "log_lines",
    }
    assert expected.issubset(_tables(conn))
    assert "run_artifacts" not in _tables(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(runs)")}
    assert {"config", "summary", "archived_at"} <= cols


def test_old_registry_and_run_attachments_are_dropped(conn):
    """No data migration (a user ruling): an old-shape registry and the run
    attachments table are dropped and recreated empty."""
    conn.execute("CREATE TABLE run_artifacts (run_id TEXT, name TEXT)")
    conn.execute(
        "CREATE TABLE artifact_versions (id TEXT PRIMARY KEY, family_id TEXT, version INT, "
        "hash TEXT, size_bytes INT, metadata TEXT, created_at TEXT, created_by_run TEXT)"
    )
    conn.execute("INSERT INTO artifact_versions (id) VALUES ('old')")
    apply_migrations(conn)
    assert "run_artifacts" not in _tables(conn)
    assert conn.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == (0,)
    assert "file_count" in {r[1] for r in conn.execute("PRAGMA table_info(artifact_versions)")}


def _old_project_docs(conn, kinds="'workspace','view'"):
    conn.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, description TEXT, tags TEXT)")
    conn.execute(
        f"""CREATE TABLE project_docs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
            kind TEXT NOT NULL CHECK(kind IN ({kinds})),
            name TEXT NOT NULL DEFAULT '', rev INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)"""
    )
    conn.execute(
        "CREATE UNIQUE INDEX idx_project_docs_workspace ON project_docs(project_id) WHERE kind = 'workspace'"
    )


def test_old_comparison_tables_dropped_and_project_docs_rebuilt(conn):
    """Comparisons became project_docs rows: old tables go, comparisons stay."""
    conn.execute("CREATE TABLE comparisons (id TEXT PRIMARY KEY, payload TEXT)")
    conn.execute("CREATE TABLE comparison_templates (id TEXT PRIMARY KEY, payload TEXT)")
    _old_project_docs(conn, "'workspace','comparison','view'")
    conn.execute("INSERT INTO projects VALUES ('p', 'p', 't', NULL, NULL)")
    conn.execute("INSERT INTO project_docs VALUES ('c1', 'p', 'comparison', 'c', 4, 't', 't', '{\"runs\": {}}')")
    apply_migrations(conn)
    tables = _tables(conn)
    assert "comparisons" not in tables
    assert "comparison_templates" not in tables
    assert conn.execute("SELECT id, kind, name, rev, payload FROM project_docs").fetchall() == [
        ("c1", "comparison", "c", 4, '{"runs": {}}'),
    ]
    apply_migrations(conn)  # idempotent
    assert len(conn.execute("SELECT * FROM project_docs").fetchall()) == 1


def test_project_workspace_becomes_the_default_view(conn):
    """The run page's workspace is the first view, "Default", and current;
    saved views ({layout}) become views holding their layout."""
    _old_project_docs(conn)
    conn.execute("INSERT INTO projects VALUES ('p', 'p', 't', NULL, NULL)")
    conn.execute("INSERT INTO projects VALUES ('q', 'q', 't', NULL, NULL)")
    conn.execute(
        "INSERT INTO project_docs VALUES ('w1', 'p', 'workspace', '', 7, '2025-02', '2025-03', '{\"sections\": [1]}')"
    )
    conn.execute(
        "INSERT INTO project_docs VALUES ('v1', 'p', 'view', 'Media', 2, '2025-01', '2025-01', '{\"layout\": {\"autoPanels\": false}}')"
    )
    conn.execute(
        "INSERT INTO project_docs VALUES ('v2', 'q', 'view', 'Only', 1, '2025-05', '2025-05', '{\"layout\": {\"a\": 1}}')"
    )
    apply_migrations(conn)
    rows = conn.execute(
        "SELECT project_id, id, kind, name, rev, payload FROM project_docs ORDER BY project_id, created_at, rowid"
    ).fetchall()
    assert rows[:2] == [
        ("p", "w1", "view", "Default", 7, '{"sections": [1]}'),
        ("p", "v1", "view", "Media", 2, '{"autoPanels": false}'),
    ]
    # A project with saved views but no workspace gets an empty Default first.
    (_, q_default, _, q_name, _, q_payload), q_saved = rows[2], rows[3]
    assert (q_name, q_payload) == ("Default", "{}")
    assert q_saved[1:] == ("v2", "view", "Only", 1, '{"a": 1}')
    assert dict(conn.execute("SELECT project_id, view_id FROM project_view_state").fetchall()) == {
        "p": "w1", "q": q_default,
    }
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'project_docs'").fetchone()[0]
    assert "'workspace'" not in sql
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO project_docs VALUES ('x', 'p', 'workspace', '', 1, 't', 't', '{}')")
    apply_migrations(conn)  # idempotent
    assert len(conn.execute("SELECT * FROM project_docs").fetchall()) == 4
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


def test_sequences_keyed_by_run_name_step(conn):
    apply_migrations(conn)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(sequences)")}
    assert not {"context", "context_hash"} & cols
    conn.execute("INSERT INTO projects VALUES ('p', 'p', '2025-01-01', NULL, NULL)")
    conn.execute("INSERT INTO runs (id, project_id, created_at, status) VALUES ('r', 'p', '2025-01-01', 'running')")
    row = "INSERT INTO sequences (run_id, name, step, wall_time, object_type) VALUES ('r', 'loss', 0, 't', 'scalar')"
    conn.execute(row)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(row)


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


# The runs/sequences DDL as it stood before parent/fork/epoch/group/... and
# per-point metadata were added.
_OLD_SCHEMA = [
    "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, "
    "created_at TEXT NOT NULL, description TEXT, tags TEXT)",
    """CREATE TABLE runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        display_name TEXT, created_at TEXT NOT NULL, ended_at TEXT,
        status TEXT NOT NULL, exit_code INTEGER, git_sha TEXT, git_dirty INTEGER,
        git_branch TEXT, cli_args TEXT, env_snapshot TEXT, hostname TEXT,
        "user" TEXT, tags TEXT, notes TEXT, last_heartbeat TEXT)""",
    """CREATE TABLE sequences (
        run_id TEXT NOT NULL REFERENCES runs(id), name TEXT NOT NULL,
        step INTEGER NOT NULL, wall_time TEXT NOT NULL, object_type TEXT NOT NULL,
        scalar_value REAL, artifact_hash TEXT,
        PRIMARY KEY (run_id, name, step))""",
    "CREATE TABLE schema_version (version INTEGER NOT NULL)",
    "INSERT INTO schema_version VALUES (2)",
    "INSERT INTO projects VALUES ('p', 'p', '2025-01-01', NULL, NULL)",
    "INSERT INTO runs (id, project_id, created_at, status) "
    "VALUES ('r', 'p', '2025-01-01', 'completed')",
    "INSERT INTO sequences (run_id, name, step, wall_time, object_type, scalar_value) "
    "VALUES ('r', 'loss', 0, '2025-01-01', 'scalar', 1.0)",
]


def _columns(con, table: str) -> set[str]:
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})").fetchall()}


def test_old_database_gains_new_columns_and_tables(conn):
    for stmt in _OLD_SCHEMA:
        conn.execute(stmt)
    conn.commit()

    apply_migrations(conn)

    assert {
        "parent_run_id", "fork_step", "data_epoch", "git_remote", "run_group",
        "job_type", "sweep_id", "stop_requested",
    } <= _columns(conn, "runs")
    assert "metadata" in _columns(conn, "sequences")
    assert {"alerts", "metric_defs", "sweeps", "sweep_trials"} <= _tables(conn)
    indexes = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    ).fetchall()}
    assert {"idx_runs_parent", "idx_runs_sweep", "idx_alerts_project"} <= indexes
    # Existing rows survive; the added columns read as their defaults.
    row = conn.execute(
        "SELECT status, data_epoch, run_group, stop_requested FROM runs WHERE id = 'r'"
    ).fetchone()
    assert row == ("completed", 0, None, None)
    assert conn.execute("SELECT scalar_value, metadata FROM sequences").fetchone() == (1.0, None)
    # A second pass is a no-op.
    apply_migrations(conn)


def test_fresh_schema_matches_migrated_schema(tmp_path):
    """SCHEMA_SQL and the column migrations describe the same runs/sequences."""
    fresh = sqlite3.connect(str(tmp_path / "fresh.db"))
    old = sqlite3.connect(str(tmp_path / "old.db"))
    try:
        apply_migrations(fresh)
        for stmt in _OLD_SCHEMA:
            old.execute(stmt)
        apply_migrations(old)
        for table in ("runs", "sequences"):
            assert _columns(fresh, table) == _columns(old, table)
    finally:
        fresh.close()
        old.close()


def test_old_sweeps_gain_program_and_their_command_becomes_an_argv(conn):
    """A sweep's shell-string command (params appended by the agent) becomes
    the JSON argv ending in ``${args}``, which the agent expands the same way."""
    conn.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, "
                 "created_at TEXT NOT NULL, description TEXT, tags TEXT)")
    conn.execute(
        "CREATE TABLE sweeps (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT, "
        "method TEXT NOT NULL, space TEXT NOT NULL, metric TEXT, goal TEXT, command TEXT, "
        "status TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    conn.execute("INSERT INTO sweeps VALUES ('a', 'p', NULL, 'grid', '{}', NULL, NULL, "
                 "'python \"my train.py\"', 'running', '2025-01-01')")
    conn.execute("INSERT INTO sweeps VALUES ('b', 'p', NULL, 'grid', '{}', NULL, NULL, "
                 "NULL, 'cancelled', '2025-01-01')")
    conn.commit()
    apply_migrations(conn)
    assert {"program", "run_cap", "description"} <= _columns(conn, "sweeps")
    converted = '["python", "my train.py", "${args}"]'
    assert conn.execute("SELECT id, command FROM sweeps ORDER BY id").fetchall() == [
        ("a", converted), ("b", None),
    ]
    apply_migrations(conn)  # a second pass leaves the converted command alone
    assert conn.execute("SELECT command FROM sweeps WHERE id = 'a'").fetchone() == (converted,)
