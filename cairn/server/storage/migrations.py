"""SQLite schema + idempotent migration runner.

Spec deviation: the CAIRN_SPEC puts a JSON ``context`` column in the primary
key of ``sequences``. SQLite doesn't allow complex types in PKs either, so we
derive a ``context_hash`` TEXT column (md5 of sorted-key JSON, empty string for
NULL context) and key on that. The original ``context`` JSON is still stored
and queryable.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any

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
        last_heartbeat TEXT
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
    CREATE TABLE IF NOT EXISTS sequences (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        name          TEXT NOT NULL,
        step          INTEGER NOT NULL,
        wall_time     TEXT NOT NULL,
        context       TEXT,
        context_hash  TEXT NOT NULL DEFAULT '',
        object_type   TEXT NOT NULL,
        scalar_value  REAL,
        artifact_hash TEXT,
        PRIMARY KEY (run_id, name, step, context_hash)
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
]


def hash_context(context: Any) -> str:
    """Derive the deterministic hash used as part of the sequences PK.

    ``None`` / empty context yields an empty string (avoids extra bucket).
    """
    if context is None or context == {} or context == "":
        return ""
    if isinstance(context, str):
        try:
            parsed = json.loads(context)
        except json.JSONDecodeError:
            return hashlib.md5(context.encode("utf-8")).hexdigest()
        return hash_context(parsed)
    canonical = json.dumps(context, sort_keys=True, separators=(",", ":"))
    return hashlib.md5(canonical.encode("utf-8")).hexdigest()


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

    existing = con.execute("SELECT version FROM schema_version").fetchall()
    if not existing:
        con.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION])
    elif existing[0][0] != SCHEMA_VERSION:
        con.execute("DELETE FROM schema_version")
        con.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION])
    con.commit()
    return SCHEMA_VERSION
