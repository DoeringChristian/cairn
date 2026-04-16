"""DuckDB schema + idempotent migration runner.

Spec deviation: the CAIRN_SPEC puts a JSON ``context`` column in the primary
key of ``sequences``. DuckDB doesn't allow JSON in a PK, so we derive a
``context_hash`` VARCHAR column (md5 of sorted-key JSON, empty string for NULL
context) and key on that. The original ``context`` JSON is still stored and
queryable.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import duckdb

SCHEMA_VERSION = 1

# Each statement is executed independently so migration is robust to DuckDB's
# per-statement parser restrictions (e.g., CREATE INDEX can't be in the same
# batch as CREATE TABLE in some versions).
SCHEMA_SQL: list[str] = [
    """
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS projects (
        id            VARCHAR PRIMARY KEY,
        name          VARCHAR NOT NULL,
        created_at    TIMESTAMP NOT NULL,
        description   VARCHAR,
        tags          JSON
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tasks (
        id            VARCHAR PRIMARY KEY,
        project_id    VARCHAR NOT NULL REFERENCES projects(id),
        name          VARCHAR NOT NULL,
        created_at    TIMESTAMP NOT NULL,
        description   VARCHAR,
        tags          JSON
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS runs (
        id            VARCHAR PRIMARY KEY,
        project_id    VARCHAR NOT NULL REFERENCES projects(id),
        task_id       VARCHAR NOT NULL REFERENCES tasks(id),
        display_name  VARCHAR,
        created_at    TIMESTAMP NOT NULL,
        ended_at      TIMESTAMP,
        status        VARCHAR NOT NULL,
        exit_code     INTEGER,
        git_sha       VARCHAR,
        git_dirty     BOOLEAN,
        git_branch    VARCHAR,
        cli_args      JSON,
        env_snapshot  JSON,
        hostname      VARCHAR,
        "user"        VARCHAR,
        tags          JSON,
        notes         VARCHAR
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS params (
        run_id        VARCHAR NOT NULL REFERENCES runs(id),
        key           VARCHAR NOT NULL,
        value         JSON NOT NULL,
        value_type    VARCHAR NOT NULL,
        PRIMARY KEY (run_id, key)
    )
    """,
    # Deviation from spec: context_hash derived column added to PK.
    """
    CREATE TABLE IF NOT EXISTS sequences (
        run_id        VARCHAR NOT NULL REFERENCES runs(id),
        name          VARCHAR NOT NULL,
        step          BIGINT NOT NULL,
        wall_time     TIMESTAMP NOT NULL,
        context       JSON,
        context_hash  VARCHAR NOT NULL DEFAULT '',
        object_type   VARCHAR NOT NULL,
        scalar_value  DOUBLE,
        artifact_hash VARCHAR,
        PRIMARY KEY (run_id, name, step, context_hash)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS artifacts (
        hash          VARCHAR PRIMARY KEY,
        mime_type     VARCHAR NOT NULL,
        size_bytes    BIGINT NOT NULL,
        metadata      JSON,
        created_at    TIMESTAMP NOT NULL
    )
    """,
    # Deviation: spec says step is nullable, but DuckDB enforces NOT NULL on
    # PK columns. We store a sentinel ``-1`` for "no step" and surface it as
    # ``None`` in the API layer.
    """
    CREATE TABLE IF NOT EXISTS run_artifacts (
        run_id        VARCHAR NOT NULL REFERENCES runs(id),
        name          VARCHAR NOT NULL,
        hash          VARCHAR NOT NULL REFERENCES artifacts(hash),
        step          BIGINT NOT NULL DEFAULT -1,
        created_at    TIMESTAMP NOT NULL,
        PRIMARY KEY (run_id, name, step)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS log_lines (
        run_id        VARCHAR NOT NULL REFERENCES runs(id),
        stream        VARCHAR NOT NULL,
        wall_time     TIMESTAMP NOT NULL,
        line_no       BIGINT NOT NULL,
        content       VARCHAR NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sequences_run_name ON sequences(run_id, name)",
    "CREATE INDEX IF NOT EXISTS idx_sequences_step ON sequences(step)",
    "CREATE INDEX IF NOT EXISTS idx_log_lines_run ON log_lines(run_id, line_no)",
]


def hash_context(context: Any) -> str:
    """Derive the deterministic hash used as part of the sequences PK.

    ``None`` / empty context yields an empty string (avoids extra bucket).
    """
    if context is None or context == {} or context == "":
        return ""
    if isinstance(context, str):
        # already a JSON string
        try:
            parsed = json.loads(context)
        except json.JSONDecodeError:
            return hashlib.md5(context.encode("utf-8")).hexdigest()
        return hash_context(parsed)
    canonical = json.dumps(context, sort_keys=True, separators=(",", ":"))
    return hashlib.md5(canonical.encode("utf-8")).hexdigest()


def apply_migrations(con: duckdb.DuckDBPyConnection) -> int:
    """Run schema DDL idempotently; return current schema version."""
    for stmt in SCHEMA_SQL:
        con.execute(stmt)
    existing = con.execute("SELECT version FROM schema_version").fetchall()
    if not existing:
        con.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION])
    elif existing[0][0] != SCHEMA_VERSION:
        # v1-only: no migration paths yet. Future versions would branch here.
        con.execute("DELETE FROM schema_version")
        con.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION])
    return SCHEMA_VERSION
