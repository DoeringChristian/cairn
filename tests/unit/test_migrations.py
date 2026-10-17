"""Non-destructive opening and atomic upgrades of the supported storage baseline."""
from __future__ import annotations

import sqlite3

import pytest

from cairn.backend.storage.db import Database
from cairn.backend.storage.migrations import (
    MIN_SCHEMA_VERSION,
    SCHEMA_VERSION,
    SchemaTooNew,
    UnsupportedSchema,
    apply_migrations,
    needs_migration,
)


@pytest.fixture
def conn(tmp_path):
    con = sqlite3.connect(tmp_path / "test.db")
    con.execute("PRAGMA foreign_keys=ON")
    yield con
    con.close()


def _tables(con):
    return {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _snapshot(con):
    return list(con.iterdump())


def _supported_old(con, version):
    """Remove precisely the additions after the supported version under test."""
    apply_migrations(con)
    con.execute("INSERT INTO projects VALUES ('p','Project','2026-01-01',NULL,NULL)")
    con.execute("INSERT INTO runs(id,project_id,created_at,status) VALUES ('r','p','2026-01-01','completed')")
    con.execute("INSERT INTO sequences(run_id,name,step,wall_time,object_type,scalar_value) "
                "VALUES ('r','loss',2147483648,'2026-01-01','scalar',0.5)")
    if version <= 9:
        con.execute("DROP TABLE run_records")
    if version in (7, 8):
        for column in ('owner', 'lease_until'):
            con.execute(f'ALTER TABLE report_builds DROP COLUMN {column}')
        for column in ('revision_id', 'selection', 'revision'):
            con.execute(f'ALTER TABLE comments DROP COLUMN {column}')
    con.execute("UPDATE schema_version SET version=?", [version])
    con.commit()


def test_fresh_schema_creates_current_domain_tables(conn):
    apply_migrations(conn)
    assert {'projects', 'runs', 'sequences', 'run_records', 'artifacts',
            'artifact_versions', 'artifact_entries', 'log_lines', 'resource_heads',
            'resource_revisions', 'report_workspaces', 'report_builds',
            'report_publications', 'ingest_progress', 'ingest_receipts'} <= _tables(conn)
    assert not {'run_artifacts', 'comparisons', 'sessions', 'tokens'} & _tables(conn)
    assert conn.execute("SELECT version FROM schema_version").fetchall() == [(SCHEMA_VERSION,)]


@pytest.mark.parametrize('version', [7, 8, 9, 10])
def test_supported_upgrade_preserves_rows_and_adds_only_supported_features(conn, version):
    _supported_old(conn, version)
    runs = conn.execute('SELECT * FROM runs').fetchall()
    points = conn.execute('SELECT * FROM sequences').fetchall()
    assert needs_migration(conn)
    apply_migrations(conn)
    assert conn.execute('SELECT * FROM runs').fetchall() == runs
    assert conn.execute('SELECT * FROM sequences').fetchall() == points
    assert 'run_records' in _tables(conn)
    assert {'owner', 'lease_until'} <= {r[1] for r in conn.execute('PRAGMA table_info(report_builds)')}
    assert {'revision_id', 'selection', 'revision'} <= {r[1] for r in conn.execute('PRAGMA table_info(comments)')}
    assert conn.execute('SELECT version FROM schema_version').fetchone() == (SCHEMA_VERSION,)
    before = _snapshot(conn)
    apply_migrations(conn)
    assert _snapshot(conn) == before


def test_sqlite_v10_widening_is_marker_only(conn):
    _supported_old(conn, 10)
    before = conn.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').fetchall()
    statements = []
    conn.set_trace_callback(statements.append)
    apply_migrations(conn)
    assert conn.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').fetchall() == before
    assert not any(sql.lstrip().upper().startswith(('CREATE ', 'ALTER ', 'DROP ', 'INSERT ', 'DELETE ')) for sql in statements)
    assert sum(sql.lstrip().upper().startswith('UPDATE ') for sql in statements) == 1


def test_current_schema_does_no_ddl_or_data_rewrite(conn):
    apply_migrations(conn)
    statements = []
    conn.set_trace_callback(statements.append)
    apply_migrations(conn)
    assert not any(sql.lstrip().upper().startswith(('CREATE ', 'ALTER ', 'DROP ', 'INSERT ', 'UPDATE ', 'DELETE ', 'BEGIN', 'COMMIT')) for sql in statements)


def test_current_schema_does_not_commit_callers_transaction(conn):
    apply_migrations(conn)
    conn.execute("INSERT INTO projects VALUES ('uncommitted','p','t',NULL,NULL)")
    apply_migrations(conn)
    assert conn.in_transaction
    conn.rollback()
    assert conn.execute('SELECT id FROM projects').fetchall() == []


@pytest.mark.parametrize('version', [0, 2, 3, 6])
def test_unsupported_version_is_refused_without_touching_data(conn, version):
    conn.execute('CREATE TABLE schema_version(version INTEGER NOT NULL)')
    conn.execute('INSERT INTO schema_version VALUES (?)', [version])
    conn.execute('CREATE TABLE saved_data(payload TEXT)')
    conn.execute("INSERT INTO saved_data VALUES ('keep this')")
    conn.commit()
    before = _snapshot(conn)
    with pytest.raises(UnsupportedSchema, match='supported range'):
        apply_migrations(conn)
    assert _snapshot(conn) == before


@pytest.mark.parametrize('table', ['run_artifacts', 'comparisons', 'comparison_templates', 'tokens'])
def test_populated_unversioned_database_is_refused_without_conversion(conn, table):
    conn.execute(f'CREATE TABLE {table}(payload TEXT)')
    conn.execute(f"INSERT INTO {table} VALUES ('keep this')")
    conn.commit()
    before = _snapshot(conn)
    with pytest.raises(UnsupportedSchema, match='no Cairn schema version'):
        apply_migrations(conn)
    assert _snapshot(conn) == before


@pytest.mark.parametrize('legacy_sql', [
    'CREATE TABLE run_artifacts(run_id TEXT,name TEXT)',
    'CREATE TABLE comparisons(id TEXT,payload TEXT)',
    'CREATE TABLE comparison_templates(id TEXT,payload TEXT)',
])
def test_supported_marker_does_not_authorize_destructive_legacy_conversion(conn, legacy_sql):
    _supported_old(conn, MIN_SCHEMA_VERSION)
    conn.execute(legacy_sql)
    conn.commit()
    before = _snapshot(conn)
    with pytest.raises(UnsupportedSchema, match='unsupported legacy table shape'):
        apply_migrations(conn)
    assert _snapshot(conn) == before


def test_old_registry_shape_is_refused_instead_of_dropped(conn):
    _supported_old(conn, 7)
    conn.execute('DROP TABLE artifact_versions')
    conn.execute('CREATE TABLE artifact_versions(id TEXT PRIMARY KEY,hash TEXT)')
    conn.execute("INSERT INTO artifact_versions VALUES ('old','still-important')")
    conn.commit()
    before = _snapshot(conn)
    with pytest.raises(UnsupportedSchema, match='artifact_versions'):
        apply_migrations(conn)
    assert _snapshot(conn) == before


@pytest.mark.parametrize('versions', [[], [7, 8], ['unknown']])
def test_ambiguous_version_marker_is_refused(conn, versions):
    conn.execute('CREATE TABLE schema_version(version)')
    conn.executemany('INSERT INTO schema_version VALUES (?)', [(v,) for v in versions])
    conn.commit()
    before = _snapshot(conn)
    with pytest.raises(UnsupportedSchema, match='version marker'):
        apply_migrations(conn)
    assert _snapshot(conn) == before


def test_future_schema_is_refused_without_modification(conn):
    _supported_old(conn, 10)
    conn.execute('UPDATE schema_version SET version=?', [SCHEMA_VERSION + 1])
    conn.commit()
    before = _snapshot(conn)
    with pytest.raises(SchemaTooNew):
        apply_migrations(conn)
    assert _snapshot(conn) == before


@pytest.mark.parametrize('failure', ['create', 'commit'])
def test_failed_upgrade_rolls_back_ddl_rows_and_version(conn, failure):
    _supported_old(conn, 7)
    before = _snapshot(conn)
    def authorize(action, arg1, arg2, database, trigger):
        fail = (failure == 'create' and action == sqlite3.SQLITE_CREATE_TABLE and arg1 == 'run_records')
        fail |= (failure == 'commit' and action == sqlite3.SQLITE_TRANSACTION and arg1 == 'COMMIT')
        return sqlite3.SQLITE_DENY if fail else sqlite3.SQLITE_OK
    conn.set_authorizer(authorize)
    try:
        with pytest.raises(sqlite3.DatabaseError, match='not authorized'):
            apply_migrations(conn)
    finally:
        conn.set_authorizer(None)
    assert not conn.in_transaction
    assert _snapshot(conn) == before
    apply_migrations(conn)
    assert conn.execute('SELECT version FROM schema_version').fetchone() == (SCHEMA_VERSION,)


def test_database_open_backs_up_once_before_supported_upgrade(tmp_path):
    path = tmp_path / 'cairn.db'
    with sqlite3.connect(path) as con:
        _supported_old(con, 10)
        before = _snapshot(con)
    db = Database.open(path)
    db.close()
    backups = list((tmp_path / 'backups').glob('*.db'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as con:
        assert _snapshot(con) == before
    db = Database.open(path)
    db.close()
    assert list((tmp_path / 'backups').glob('*.db')) == backups


def test_database_open_refuses_unsupported_before_changing_journal_mode(tmp_path):
    path = tmp_path / 'old.db'
    with sqlite3.connect(path) as con:
        con.execute('CREATE TABLE run_artifacts(payload TEXT)')
        con.execute("INSERT INTO run_artifacts VALUES ('retain')")
    before = path.read_bytes()
    with pytest.raises(UnsupportedSchema):
        Database.open(path)
    assert path.read_bytes() == before
    assert not (tmp_path / 'backups').exists()


def test_unknown_database_scheme_is_rejected_before_filesystem_writes(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    with pytest.raises(ValueError, match='PostgreSQL or SQLite'):
        Database.open('mysql://localhost/cairn')
    assert list(tmp_path.iterdir()) == []
