"""SQLite schema + idempotent migration runner."""

from __future__ import annotations

import sqlite3

SCHEMA_VERSION = 2  # Bumped from 1 (DuckDB) to 2 (SQLite). Breaking change.

SCHEMA_SQL: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS projects (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        description   TEXT,
        tags          TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS runs (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        display_name  TEXT,
        created_at    TEXT NOT NULL,
        ended_at      TEXT,
        status        TEXT NOT NULL,
        exit_code     INTEGER,
        git_sha       TEXT,
        git_dirty     INTEGER,
        git_branch    TEXT,
        cli_args      TEXT,
        env_snapshot  TEXT,
        hostname      TEXT,
        "user"        TEXT,
        tags          TEXT,
        notes         TEXT,
        last_heartbeat TEXT,
        -- A fork's parent and the step it was forked at. No FK: the parent
        -- may be deleted (or not imported) while the fork lives on.
        parent_run_id TEXT,
        fork_step     INTEGER,
        -- Bumped whenever a run's history is rewritten (rewind), so a live
        -- client knows its rowid cursor is stale.
        data_epoch    INTEGER DEFAULT 0,
        git_remote    TEXT,
        -- "group" is reserved in SQL; the API field is ``group``.
        run_group     TEXT,
        job_type      TEXT,
        sweep_id      TEXT,
        -- Timestamp of a stop request from the UI; NULL when none is pending.
        stop_requested TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS params (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        key           TEXT NOT NULL,
        value         TEXT NOT NULL,
        value_type    TEXT NOT NULL,
        PRIMARY KEY (run_id, key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS summary (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        key           TEXT NOT NULL,
        value         TEXT NOT NULL,
        value_type    TEXT NOT NULL,
        PRIMARY KEY (run_id, key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sequences (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        name          TEXT NOT NULL,
        step          INTEGER NOT NULL,
        wall_time     TEXT NOT NULL,
        object_type   TEXT NOT NULL,
        scalar_value  REAL,
        artifact_hash TEXT,
        -- Per-point JSON (e.g. a media caption); NULL when there is none.
        metadata      TEXT,
        PRIMARY KEY (run_id, name, step)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS artifacts (
        hash          TEXT PRIMARY KEY,
        mime_type     TEXT NOT NULL,
        size_bytes    INTEGER NOT NULL,
        metadata      TEXT,
        object_type   TEXT,
        created_at    TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS run_artifacts (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        name          TEXT NOT NULL,
        hash          TEXT NOT NULL REFERENCES artifacts(hash),
        step          INTEGER NOT NULL DEFAULT -1,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (run_id, name, step)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS log_lines (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        stream        TEXT NOT NULL,
        wall_time     TEXT NOT NULL,
        line_no       INTEGER NOT NULL,
        content       TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sequences_run_name ON sequences(run_id, name)",
    "CREATE INDEX IF NOT EXISTS idx_sequences_step ON sequences(step)",
    "CREATE INDEX IF NOT EXISTS idx_log_lines_run ON log_lines(run_id, line_no)",
    # Indexes for efficient project listing and run queries at scale.
    "CREATE INDEX IF NOT EXISTS idx_runs_project_created ON runs(project_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)",
    """
    CREATE TABLE IF NOT EXISTS comparisons (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        name          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        payload       TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_comparisons_project ON comparisons(project_id)",
    """
    CREATE TABLE IF NOT EXISTS comparison_templates (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        name          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        payload       TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_comparison_templates_project ON comparison_templates(project_id)",
    """
    CREATE TABLE IF NOT EXISTS reports (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        name          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        payload       TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_reports_project ON reports(project_id)",
    """
    CREATE TABLE IF NOT EXISTS report_templates (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        name          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        payload       TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_report_templates_project ON report_templates(project_id)",
    # A project's shared UI documents: its one workspace (run page and runs
    # table layout) and any number of saved views. ``rev`` counts writes so a
    # client can PUT against the revision it last saw and be told when
    # another tab or user wrote in between.
    """
    CREATE TABLE IF NOT EXISTS project_docs (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        kind          TEXT NOT NULL CHECK(kind IN ('workspace','view')),
        name          TEXT NOT NULL DEFAULT '',
        rev           INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        payload       TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_docs(project_id, kind)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_project_docs_workspace "
    "ON project_docs(project_id) WHERE kind = 'workspace'",
    # ── Artifact registry tables ──────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS artifact_families (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        name          TEXT NOT NULL,
        type          TEXT NOT NULL DEFAULT 'artifact',
        description   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE(project_id, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS artifact_versions (
        id              TEXT PRIMARY KEY,
        family_id       TEXT NOT NULL REFERENCES artifact_families(id),
        version         INTEGER NOT NULL,
        hash            TEXT NOT NULL REFERENCES artifacts(hash),
        size_bytes      INTEGER NOT NULL,
        metadata        TEXT,
        created_at      TEXT NOT NULL,
        created_by_run  TEXT,
        UNIQUE(family_id, version)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS artifact_aliases (
        family_id     TEXT NOT NULL REFERENCES artifact_families(id),
        alias         TEXT NOT NULL,
        version_id    TEXT NOT NULL REFERENCES artifact_versions(id),
        PRIMARY KEY (family_id, alias)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS run_inputs (
        run_id              TEXT NOT NULL REFERENCES runs(id),
        artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
        role                TEXT NOT NULL DEFAULT 'input',
        created_at          TEXT NOT NULL,
        PRIMARY KEY (run_id, artifact_version_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_artifact_families_project ON artifact_families(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_artifact_versions_family ON artifact_versions(family_id, version DESC)",
    "CREATE INDEX IF NOT EXISTS idx_artifact_versions_producer ON artifact_versions(created_by_run)",
    "CREATE INDEX IF NOT EXISTS idx_run_inputs_artifact ON run_inputs(artifact_version_id)",
    # ── Alerts, metric definitions, sweeps ─────────────────────────────
    # Ids are client-generated TEXT everywhere so a replayed WAL op is an
    # INSERT OR IGNORE, never a duplicate row.
    """
    CREATE TABLE IF NOT EXISTS alerts (
        id            TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL REFERENCES runs(id),
        project_id    TEXT NOT NULL,
        level         TEXT NOT NULL,
        title         TEXT NOT NULL,
        text          TEXT,
        created_at    TEXT NOT NULL,
        -- Set when the webhook delivery claimed the row.
        delivered_at  TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_alerts_run ON alerts(run_id)",
    """
    CREATE TABLE IF NOT EXISTS metric_defs (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        -- The metric's full name (exact; no globs).
        name          TEXT NOT NULL,
        -- The full name of another scalar series to plot this one against.
        x             TEXT,
        summary       TEXT,
        PRIMARY KEY (run_id, name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sweeps (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        name          TEXT,
        method        TEXT NOT NULL,
        space         TEXT NOT NULL,
        metric        TEXT,
        goal          TEXT,
        command       TEXT,
        status        TEXT NOT NULL,
        created_at    TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sweeps_project ON sweeps(project_id)",
    """
    CREATE TABLE IF NOT EXISTS sweep_trials (
        id            TEXT PRIMARY KEY,
        sweep_id      TEXT NOT NULL REFERENCES sweeps(id),
        -- No FK: a trial outlives a deleted run.
        run_id        TEXT,
        params        TEXT NOT NULL,
        status        TEXT NOT NULL,
        value         REAL,
        created_at    TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sweep_trials_sweep ON sweep_trials(sweep_id)",
    # ── Auth tables (workstream AUTH) ──────────────────────────────────
    # Plaintext secrets (tokens, OTPs, nonces) are never persisted — only
    # sha256 hex digests. See cairn/server/auth.py.
    # ``last_used_at`` is retained for compatibility but no longer written:
    # resolving a request must not write. See the token-only-auth design.
    """
    CREATE TABLE IF NOT EXISTS tokens (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL UNIQUE,
        token_hash    TEXT NOT NULL UNIQUE,
        role          TEXT NOT NULL CHECK(role IN ('admin','write','read')),
        created_at    TEXT NOT NULL,
        last_used_at  TEXT,
        expires_at    TEXT,
        disabled      INTEGER NOT NULL DEFAULT 0,
        -- The token this one was derived from (a per-browser token minted by
        -- /api/auth/otp). Revoking a parent revokes its children. No FK: the
        -- migrations here stay additive, and ALTER TABLE ADD COLUMN cannot
        -- add a constraint to an existing database.
        parent_id     TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_tokens_hash ON tokens(token_hash)",
    """
    CREATE TABLE IF NOT EXISTS auth_otp (
        otp_hash      TEXT PRIMARY KEY,
        token_id      TEXT NOT NULL REFERENCES tokens(id),
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS auth_nonces (
        nonce_hash    TEXT PRIMARY KEY,
        namespace     TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        expires_at    TEXT NOT NULL
    )
    """,
]


# Columns added to ``runs`` after its first release (also in SCHEMA_SQL).
_ADDED_RUN_COLUMNS: list[tuple[str, str]] = [
    ("parent_run_id", "TEXT"),
    ("fork_step", "INTEGER"),
    ("data_epoch", "INTEGER DEFAULT 0"),
    ("git_remote", "TEXT"),
    ("run_group", "TEXT"),
    ("job_type", "TEXT"),
    ("sweep_id", "TEXT"),
    ("stop_requested", "TEXT"),
]

_ADDED_COLUMN_INDEXES: list[str] = [
    "CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_runs_sweep ON runs(sweep_id)",
]


def _add_column_if_missing(
    con: sqlite3.Connection, table: str, column: str, col_type: str,
) -> None:
    """ALTER TABLE ADD COLUMN, ignoring if it already exists."""
    cols = {row[1] for row in con.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")


def apply_migrations(con: sqlite3.Connection) -> int:
    """Run schema DDL idempotently; return current schema version."""
    for stmt in SCHEMA_SQL:
        con.execute(stmt)

    # Incremental column migrations for existing databases.
    _add_column_if_missing(con, "runs", "last_heartbeat", "TEXT")
    _add_column_if_missing(con, "artifacts", "object_type", "TEXT")
    _add_column_if_missing(con, "tokens", "parent_id", "TEXT")
    for column, col_type in _ADDED_RUN_COLUMNS:
        _add_column_if_missing(con, "runs", column, col_type)
    _add_column_if_missing(con, "sequences", "metadata", "TEXT")
    # Indexes on added columns run after the ALTERs: in SCHEMA_SQL they would
    # fail on a database that predates the column.
    for stmt in _ADDED_COLUMN_INDEXES:
        con.execute(stmt)

    # The one destructive statement in this file. Auth is token-only: the
    # browser carries the token itself in the ``cairn_token`` cookie, so
    # sessions no longer exist. Dropping the table is safe because its rows
    # were ephemeral by construction (every one carried an expiry) and
    # nothing references them — no foreign key points at ``sessions``, and no
    # code reads it. The worst outcome for a user is that open browser tabs
    # holding a cookie from the old session model must log in again.
    con.execute("DROP INDEX IF EXISTS idx_sessions_token")
    con.execute("DROP TABLE IF EXISTS sessions")

    existing = con.execute("SELECT version FROM schema_version").fetchall()
    if not existing:
        con.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION])
    elif existing[0][0] != SCHEMA_VERSION:
        con.execute("DELETE FROM schema_version")
        con.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION])
    con.commit()
    return SCHEMA_VERSION
