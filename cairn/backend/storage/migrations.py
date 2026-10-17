"""Storage schema and supported, transactional SQLite upgrades.

Schema 7 is the supported baseline. Older or unversioned populated databases
need an explicit conversion outside normal opening; never infer a destructive
conversion from their table shapes. Python package refactors do not change this
version. Version 11 widens PostgreSQL counters and sizes to SQLite's 64-bit range.
"""

from __future__ import annotations

import sqlite3

#: 1: DuckDB; 2: SQLite (cairn <= 0.5); 3: server ingestion (cairn 0.6:
#: ``ingest_progress``). A database written by a newer schema is refused.
SCHEMA_VERSION = 11
MIN_SCHEMA_VERSION = 7

#: The release a schema version came with: names the automatic backup taken
#: before migrating an older database (``cairn-<ts>-pre-<release>.db``).
SCHEMA_RELEASE = {3: "0.6", 4: "backend-v4", 5: "backend-v5", 6: "reports-v6", 7: "deployment-v7", 8: "deployment-v8", 9: "deployment-v9", 10: "records-v10", 11: "storage-v11"}

# Persisted positions, counts and byte sizes have the same signed 64-bit range
# on both engines. Flags and the schema marker remain ordinary INTEGERs.
# SQLite INTEGER already has this range, so its 10 -> 11 upgrade is marker-only.
WIDE_INTEGER_COLUMNS = {
    "resource_heads": ("revision",),
    "resource_revisions": ("revision",),
    "report_workspaces": ("revision",),
    "report_builds": ("revision",),
    "ingest_receipts": ("seq",),
    "runs": ("fork_step", "data_epoch", "total_steps", "max_step", "version"),
    "run_series": ("last_version",),
    "sequences": ("step",),
    "artifacts": ("size_bytes",),
    "log_lines": ("line_no",),
    "metric_stats": ("count", "first_step", "last_step"),
    "comments": ("revision",),
    "project_docs": ("rev",),
    "artifact_families": ("last_version",),
    "artifact_versions": ("version", "size_bytes", "file_count", "ref_count", "step"),
    "artifact_entries": ("size",),
    "wal_progress": ("offset",),
    "ingest_progress": ("applied_seq",),
    "sweeps": ("run_cap",),
}

SCHEMA_SQL: list[str] = [
    """CREATE TABLE IF NOT EXISTS resource_heads (
        kind TEXT NOT NULL, id TEXT NOT NULL, revision BIGINT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY (kind, id))""",
    """CREATE TABLE IF NOT EXISTS resource_revisions (
        kind TEXT NOT NULL, id TEXT NOT NULL, revision BIGINT NOT NULL,
        payload TEXT NOT NULL, digest TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (kind, id, revision))""",
    """CREATE TABLE IF NOT EXISTS report_workspaces (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL,
        revision BIGINT NOT NULL, files TEXT NOT NULL, origin TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS report_builds (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision BIGINT NOT NULL,
        project_id TEXT NOT NULL, slug TEXT NOT NULL, files TEXT NOT NULL,
        expected_version TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL,
        started_at TEXT, ended_at TEXT, result TEXT, error TEXT,
        owner TEXT, lease_until DOUBLE PRECISION)""",
    """CREATE INDEX IF NOT EXISTS idx_report_build_queue ON report_builds(status,created_at)""",
    """CREATE TABLE IF NOT EXISTS run_sources (
        run_id TEXT PRIMARY KEY, archive_hash TEXT NOT NULL, manifest TEXT NOT NULL)""",

    """CREATE TABLE IF NOT EXISTS ingest_receipts (
        run_id TEXT NOT NULL, log TEXT NOT NULL, seq BIGINT NOT NULL,
        digest TEXT NOT NULL, PRIMARY KEY (run_id, log, seq))""",
    """CREATE TABLE IF NOT EXISTS report_publications (
        report_id TEXT NOT NULL, version_id TEXT NOT NULL,
        published_at TEXT NOT NULL, source TEXT NOT NULL,
        PRIMARY KEY (report_id, version_id))""",

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
        fork_step     BIGINT,
        -- Bumped whenever a run's history is rewritten (rewind), so a live
        -- client knows its rowid cursor is stale.
        data_epoch    BIGINT DEFAULT 0,
        git_remote    TEXT,
        -- "group" is reserved in SQL; the API field is ``group``.
        run_group     TEXT,
        job_type      TEXT,
        sweep_id      TEXT,
        -- Timestamp of a stop request from the UI; NULL when none is pending.
        stop_requested TEXT,
        -- The nested config / summary documents exactly as logged (after the
        -- deep merge of every write): the source of truth. The ``params`` and
        -- ``summary`` tables are a derived flat index (dotted keys) rebuilt
        -- from them on every write (see config_doc.py).
        config        TEXT,
        summary       TEXT,
        -- When the run was archived; NULL = not archived. Archiving never
        -- touches ``status``.
        archived_at   TEXT,
        -- Progress (see cairn/server/progress.py): the declared total, the
        -- highest non-system step logged, and the ETA's step samples
        -- (JSON [[unix_time, step]]); an explicit run.progress(i, total)
        -- value, its total (NULL: total_steps) and samples.
        total_steps   BIGINT,
        max_step      BIGINT,
        step_samples  TEXT,
        progress_value DOUBLE PRECISION,
        progress_total DOUBLE PRECISION,
        progress_samples TEXT,
        -- The run's number in its series (project, group, job type, display
        -- name), assigned by the server from ``run_series``; NULL for an
        -- unnamed run.
        version       BIGINT
    )
    """,
    # A run series' counter: the highest version ever given in it, so a
    # number is never reused, also after its run is deleted or renamed away.
    # A series is (project, group, job type, name); ``grouped`` = 0 is no
    # group (``run_group`` then ''), ``typed`` = 0 no job type (``job_type``
    # then ''), so a missing value is part of the key and '' differs from it.
    """CREATE TABLE IF NOT EXISTS run_records (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        event_id BIGINT NOT NULL, writer_id TEXT NOT NULL,
        sequence BIGINT NOT NULL, timestamp TEXT NOT NULL, values_json TEXT NOT NULL,
        PRIMARY KEY (run_id, event_id), UNIQUE (run_id, writer_id, sequence))""",
    """
    CREATE TABLE IF NOT EXISTS run_series (
        project_id    TEXT NOT NULL,
        grouped       INTEGER NOT NULL,
        run_group     TEXT NOT NULL,
        typed         INTEGER NOT NULL,
        job_type      TEXT NOT NULL,
        name          TEXT NOT NULL,
        last_version  BIGINT NOT NULL,
        PRIMARY KEY (project_id, grouped, run_group, typed, job_type, name)
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
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id        TEXT NOT NULL REFERENCES runs(id),
        name          TEXT NOT NULL,
        step          BIGINT NOT NULL,
        wall_time     TEXT NOT NULL,
        object_type   TEXT NOT NULL,
        scalar_value  DOUBLE PRECISION,
        artifact_hash TEXT,
        -- Per-point JSON (e.g. a media caption); NULL when there is none.
        metadata      TEXT,
        -- 1: a SUMMARY media value (``run.summary(fig=cairn.Figure(f))``),
        -- the one point of its series, at step 0. These rows are a derived
        -- index of the run's summary document, rebuilt with it
        -- (ingest_ops.write_doc); 0: a tracked point.
        summary       INTEGER NOT NULL DEFAULT 0,
        UNIQUE (run_id, name, step)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS artifacts (
        hash          TEXT PRIMARY KEY,
        mime_type     TEXT NOT NULL,
        size_bytes    BIGINT NOT NULL,
        metadata      TEXT,
        object_type   TEXT,
        created_at    TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS log_lines (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        stream        TEXT NOT NULL,
        wall_time     TEXT NOT NULL,
        line_no       BIGINT NOT NULL,
        content       TEXT NOT NULL,
        -- The label of the process that printed the line (several processes
        -- can log into one run); NULL for an unlabelled one.
        label         TEXT
    )
    """,
    # A derived index over sequences' scalar points (count, sum, min, max,
    # first and last by step), maintained with every point write and rebuilt
    # when history is deleted or copied. See storage/metric_stats.py.
    """
    CREATE TABLE IF NOT EXISTS metric_stats (
        run_id        TEXT NOT NULL REFERENCES runs(id),
        name          TEXT NOT NULL,
        count         BIGINT NOT NULL,
        sum           DOUBLE PRECISION,
        min           DOUBLE PRECISION NOT NULL,
        max           DOUBLE PRECISION NOT NULL,
        first_step    BIGINT NOT NULL,
        first_value   DOUBLE PRECISION NOT NULL,
        last_step     BIGINT NOT NULL,
        last_value    DOUBLE PRECISION NOT NULL,
        -- 1: the values never decrease along the steps (NULL: not yet scanned).
        monotonic     INTEGER,
        PRIMARY KEY (run_id, name)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sequences_run_name ON sequences(run_id, name)",
    "CREATE INDEX IF NOT EXISTS idx_sequences_step ON sequences(step)",
    # The points ``metric_stats`` does not summarize (media, NaN scalars,
    # anything not typed ``scalar``): with it, a run's sequence catalogue
    # reads both instead of scanning every point (routes/sequences.py).
    "CREATE INDEX IF NOT EXISTS idx_sequences_unsummarized "
    "ON sequences(run_id, name, step, object_type, scalar_value) "
    "WHERE object_type != 'scalar' OR scalar_value IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_log_lines_run ON log_lines(run_id, line_no)",
    # Indexes for efficient project listing and run queries at scale.
    "CREATE INDEX IF NOT EXISTS idx_runs_project_created ON runs(project_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)",
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
    # Comments are bound to a published report revision.
    """
    CREATE TABLE IF NOT EXISTS comments (
        id            TEXT PRIMARY KEY,
        report_id     TEXT NOT NULL REFERENCES reports(id),
        -- A reply's thread root; NULL for a thread's first comment.
        parent_id     TEXT,
        anchor_kind   TEXT NOT NULL CHECK(anchor_kind IN ('report','block','card','quote')),
        anchor_id     TEXT,
        quote         TEXT,
        body          TEXT NOT NULL,
        author_id     TEXT,
        author        TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        resolved_at   TEXT,
        resolved_by   TEXT,
        revision_id   TEXT,
        selection     TEXT,
        revision      BIGINT NOT NULL DEFAULT 1
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_comments_report ON comments(report_id, created_at)",
    # A project's shared UI documents: its workspace views (named layouts
    # plus the workspace page's run state; the run page and the workspace
    # show the project's current one, ``project_view_state``).
    # ``rev`` counts writes so a client can PUT against the revision it last
    # saw and be told when another tab or user wrote in between.
    """
    CREATE TABLE IF NOT EXISTS project_docs (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        kind          TEXT NOT NULL CHECK(kind IN ('view')),
        name          TEXT NOT NULL DEFAULT '',
        rev           BIGINT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        payload       TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_docs(project_id, kind)",
    # The view the run page shows, per project (routes/project_docs.py).
    """
    CREATE TABLE IF NOT EXISTS project_view_state (
        project_id    TEXT PRIMARY KEY REFERENCES projects(id),
        view_id       TEXT NOT NULL
    )
    """,
    # ── Artifact registry tables ──────────────────────────────────────
    # A family is every version of one name in a project; it keeps one type.
    """
    CREATE TABLE IF NOT EXISTS artifact_families (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL REFERENCES projects(id),
        name          TEXT NOT NULL,
        type          TEXT NOT NULL DEFAULT 'artifact',
        description   TEXT,
        -- The highest version number ever given: numbers are never reused,
        -- also after a version is deleted.
        last_version  BIGINT NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE(project_id, name)
    )
    """,
    # A version is an immutable manifest of entries; ``hash`` is the manifest
    # blob's digest. ``size_bytes`` sums the uploaded entries (references
    # excluded); ``file_count`` counts every entry, ``ref_count`` the
    # references among them.
    """
    CREATE TABLE IF NOT EXISTS artifact_versions (
        id              TEXT PRIMARY KEY,
        family_id       TEXT NOT NULL REFERENCES artifact_families(id),
        version         BIGINT NOT NULL,
        hash            TEXT NOT NULL,
        size_bytes      BIGINT NOT NULL,
        file_count      BIGINT NOT NULL,
        ref_count       BIGINT NOT NULL DEFAULT 0,
        metadata        TEXT,
        description     TEXT,
        step            BIGINT,
        -- A JSON list of free-form labels (aliases name versions; tags
        -- describe them and may repeat across versions).
        tags            TEXT,
        created_at      TEXT NOT NULL,
        created_by_run  TEXT,
        UNIQUE(family_id, version)
    )
    """,
    # The manifest's entries, indexed for the explorer (the manifest blob
    # stays the source of truth). An uploaded entry has ``hash``; a reference
    # has ``uri`` instead.
    """
    CREATE TABLE IF NOT EXISTS artifact_entries (
        version_id    TEXT NOT NULL REFERENCES artifact_versions(id),
        path          TEXT NOT NULL,
        hash          TEXT,
        size          BIGINT,
        mime          TEXT,
        object_type   TEXT,
        uri           TEXT,
        etag          TEXT,
        meta          TEXT,
        PRIMARY KEY (version_id, path)
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
    # Direct run -> run lineage without an artifact: ``run_id`` used
    # ``used_run_id`` (``run.use_run``). No FKs: deleting either run deletes
    # the link explicitly (ingest_ops.delete_run).
    """
    CREATE TABLE IF NOT EXISTS run_links (
        run_id        TEXT NOT NULL,
        used_run_id   TEXT NOT NULL,
        role          TEXT,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (run_id, used_run_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_run_links_used ON run_links(used_run_id)",
    # ── Legacy run-log import (cairn <= 0.5) ────────────────────────────
    # How far each 0.5 run log in ``wals/`` had been applied: the byte offset
    # just past the last complete line ingested. Read (and advanced) only by
    # the one-time import of pending legacy logs at upgrade
    # (legacy_wal_import.py), so nothing is applied twice.
    """
    CREATE TABLE IF NOT EXISTS wal_progress (
        path          TEXT PRIMARY KEY,
        run_id        TEXT NOT NULL,
        "offset"      BIGINT NOT NULL,
        finished      INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT NOT NULL,
        worker        INTEGER NOT NULL DEFAULT 0
    )
    """,
    # ── Server ingestion (cairn 0.6) ─────────────────────────────────────
    # How far each uploaded run log has been applied: ``applied_seq`` is the
    # highest record sequence number applied, committed in the SAME
    # transaction as that record's ops (exactly once; see
    # cairn/server/record_apply.py). ``log`` is ``main`` or an attached
    # process's label. ``worker``: the log opened with ``join`` (an attached
    # process: it never changes the run's status). ``finished``: the last
    # record applied was the run's ``finish`` (a worker's: its ``detach``).
    """
    CREATE TABLE IF NOT EXISTS ingest_progress (
        run_id        TEXT NOT NULL,
        log           TEXT NOT NULL,
        applied_seq   BIGINT NOT NULL,
        worker        INTEGER NOT NULL DEFAULT 0,
        finished      INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (run_id, log)
    )
    """,
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
    CREATE TABLE IF NOT EXISTS viewer_defaults (
        project_id    TEXT NOT NULL REFERENCES projects(id),
        -- What the default is for: a built-in type ('volume') or custom data
        -- ('custom:<kind>', a glob allowed: 'custom:guiding/*').
        kind          TEXT NOT NULL,
        -- The custom viewer's name. No row: a built-in type's built-in renderer.
        viewer        TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (project_id, kind)
    )
    """,
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
    # A project's override of a metric's rule (cairn/server/metric_rules.py):
    # NULL fields are not overridden.
    """
    CREATE TABLE IF NOT EXISTS metric_overrides (
        project_id    TEXT NOT NULL,
        name          TEXT NOT NULL,
        -- min | max | mean | last
        summary       TEXT,
        -- lower | higher | none
        goal          TEXT,
        updated_at    TEXT NOT NULL,
        PRIMARY KEY (project_id, name)
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
        -- JSON argument list (wandb's ``command``), macros unexpanded.
        command       TEXT,
        program       TEXT,
        run_cap       BIGINT,
        description   TEXT,
        status        TEXT NOT NULL,
        created_at    TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sweeps_project ON sweeps(project_id)",
    """
    CREATE TABLE IF NOT EXISTS sweep_trials (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
        id            TEXT NOT NULL UNIQUE,
        sweep_id      TEXT NOT NULL REFERENCES sweeps(id),
        -- No FK: a trial outlives a deleted run.
        run_id        TEXT,
        params        TEXT NOT NULL,
        status        TEXT NOT NULL,
        value         DOUBLE PRECISION,
        created_at    TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sweep_trials_sweep ON sweep_trials(sweep_id)",
]


_ADDED_COLUMN_INDEXES: list[str] = [
    "CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_runs_sweep ON runs(sweep_id)",
    # A run's summary media series (tiny): what every point batch checks its
    # names against, and what the summary write rebuilds.
    "CREATE INDEX IF NOT EXISTS idx_sequences_summary ON sequences(run_id, name) WHERE summary = 1",
]


def _add_column_if_missing(
    con: sqlite3.Connection, table: str, column: str, col_type: str,
) -> None:
    """ALTER TABLE ADD COLUMN, ignoring if it already exists."""
    cols = {row[1] for row in con.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in cols:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")


class SchemaTooNew(RuntimeError):
    """The database was written by a newer cairn (downgrades are refused)."""


class UnsupportedSchema(RuntimeError):
    """Opening must not guess how to convert an unknown or obsolete database."""


def check_schema_version(version: int | None, *, populated: bool) -> None:
    """Read-only version guard shared by SQLite and PostgreSQL."""
    if version is None:
        if populated:
            raise UnsupportedSchema(
                "populated database has no Cairn schema version; explicit conversion is required; "
                "existing data was not changed"
            )
        return
    if type(version) is not int or version < MIN_SCHEMA_VERSION:
        raise UnsupportedSchema(
            f"database schema {version!r} is outside the supported range "
            f"{MIN_SCHEMA_VERSION}–{SCHEMA_VERSION}; explicit conversion is required; "
            "existing data was not changed"
        )
    if version > SCHEMA_VERSION:
        raise SchemaTooNew(
            f"this database has schema version {version}, newer than this cairn's "
            f"({SCHEMA_VERSION}); upgrade cairn instead of opening it with an older one"
        )


def version_from_rows(rows) -> int | None:
    """A version marker is exactly one integer, never MAX of ambiguous rows."""
    if len(rows) != 1 or type(rows[0][0]) is not int:
        raise UnsupportedSchema("invalid Cairn schema version marker; existing data was not changed")
    return rows[0][0]


def stored_schema_version(con: sqlite3.Connection) -> int | None:
    has_table = con.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'"
    ).fetchone()
    if not has_table:
        return None
    try:
        return version_from_rows(con.execute("SELECT version FROM schema_version").fetchall())
    except sqlite3.DatabaseError as exc:
        raise UnsupportedSchema("invalid Cairn schema version table; existing data was not changed") from exc


def _check_sqlite_shape(con: sqlite3.Connection, tables: set[str]) -> None:
    """Refuse shapes formerly converted by dropping/renumbering stored data."""
    obsolete = tables & {"run_artifacts", "comparisons", "comparison_templates"}
    required = {
        "artifact_versions": "file_count",
        "run_series": "job_type",
        "sequences": "event_id",
        "sweep_trials": "ordinal",
        "sweeps": "program",
    }
    for table, column in required.items():
        if table in tables and column not in {row[1] for row in con.execute(f"PRAGMA table_info({table})")}:
            obsolete.add(table)
    if "project_docs" in tables:
        sql = con.execute("SELECT sql FROM sqlite_master WHERE name='project_docs'").fetchone()[0] or ""
        if "'workspace'" in sql or "'comparison'" in sql:
            obsolete.add("project_docs")
    if obsolete:
        raise UnsupportedSchema(
            f"unsupported legacy table shape: {', '.join(sorted(obsolete))}; "
            "explicit conversion is required; existing data was not changed"
        )


def needs_migration(con: sqlite3.Connection) -> bool:
    """Validate without writes; only supported older schemas need migration."""
    version = stored_schema_version(con)
    tables = {row[0] for row in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )}
    check_schema_version(version, populated=bool(tables))
    if version is not None:
        _check_sqlite_shape(con, tables)
    return version is not None and version < SCHEMA_VERSION


def apply_migrations(con: sqlite3.Connection) -> int:
    """Initialize an empty database or upgrade schema 7+ in one transaction.

    An already-current schema is a read-only no-op. Every failure rolls back
    DDL, data and the marker together. Derived indexes present in the supported
    baseline are not rebuilt as a side effect of opening a database.
    """
    needs_migration(con)
    version = stored_schema_version(con)
    if version == SCHEMA_VERSION:
        return SCHEMA_VERSION
    if con.in_transaction:
        raise RuntimeError("schema migration requires a connection without an active transaction")
    con.execute("BEGIN IMMEDIATE")
    try:
        if version is None:
            for statement in SCHEMA_SQL:
                con.execute(statement)
            for statement in _ADDED_COLUMN_INDEXES:
                con.execute(statement)
            con.execute("INSERT INTO schema_version(version) VALUES (?)", [SCHEMA_VERSION])
        else:
            if version in (7, 8):
                _add_column_if_missing(con, "report_builds", "owner", "TEXT")
                _add_column_if_missing(con, "report_builds", "lease_until", "DOUBLE PRECISION")
                _add_column_if_missing(con, "comments", "revision_id", "TEXT")
                _add_column_if_missing(con, "comments", "selection", "TEXT")
                _add_column_if_missing(con, "comments", "revision", "BIGINT NOT NULL DEFAULT 1")
            if version <= 9:
                statement = next(sql for sql in SCHEMA_SQL if "CREATE TABLE IF NOT EXISTS run_records (" in sql)
                con.execute(statement)
            # 10 -> 11: SQLite's existing INTEGER columns already store int64.
            # Keep all tables/identities/blob references byte-for-byte unchanged.
            con.execute("UPDATE schema_version SET version=?", [SCHEMA_VERSION])
        con.commit()
    except BaseException:
        con.rollback()
        raise
    return SCHEMA_VERSION
