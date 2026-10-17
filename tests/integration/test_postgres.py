"""The storage contract against a real PostgreSQL server.

Set CAIRN_TEST_DATABASE_URL to a disposable PostgreSQL database. Each test
uses an isolated schema; no existing schema or application data is modified.
"""

# Imported tests deliberately reuse the same contract on PostgreSQL.
# ruff: noqa: F401
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest


@pytest.fixture
def database_url():
    url = os.environ.get("CAIRN_TEST_DATABASE_URL")
    if not url:
        pytest.skip("set CAIRN_TEST_DATABASE_URL to run PostgreSQL contracts")
    sqlalchemy = pytest.importorskip("sqlalchemy")
    from sqlalchemy.engine import make_url

    url = make_url(url).set(drivername="postgresql+psycopg")
    schema = "cairn_test_" + uuid.uuid4().hex
    engine = sqlalchemy.create_engine(url)
    with engine.begin() as con:
        con.exec_driver_sql(f"CREATE SCHEMA {schema}")
    try:
        yield url.update_query_dict(
            {"options": f"-csearch_path={schema}"}
        ).render_as_string(hide_password=False)
    finally:
        with engine.begin() as con:
            con.exec_driver_sql(f"DROP SCHEMA {schema} CASCADE")
        engine.dispose()


@pytest.fixture
def fresh_db(database_url):
    from cairn.backend.storage.db import Database

    db = Database.open(database_url)
    yield db
    db.close()


@pytest.fixture
def client(database_url, tmp_path):
    from fastapi.testclient import TestClient

    from cairn.server.app import create_app

    app = create_app(
        data_dir=tmp_path,
        database_url=database_url,
        auth_enabled=False,
        mount_ui=False,
        background_tasks=False,
    )
    with TestClient(app) as client:
        yield client


# Run the same durability specifications as the embedded repository.
from tests.unit.test_backend_contract import (
    test_conflicting_retry_is_rejected_and_original_data_survives,
    test_gap_inside_batch_rolls_back_new_records,
    test_rejected_record_rolls_back_batch_and_ack,
    test_report_publication_compare_and_swap_and_historical_retention,
    test_unknown_operation_is_not_acknowledged,
)
from tests.unit.test_ingest_protocol import (
    test_apply_and_progress,
    test_bad_names_are_422,
    test_blob_hash_mismatch_is_400,
    test_blob_head_put,
    test_blob_name_must_be_sha256,
    test_body_over_the_limit_is_413,
    test_busy_server_says_retry_later,
    test_fork_waits_for_its_parent,
    test_from_seq_must_match_first_record,
    test_gap_is_409_with_applied_seq,
    test_gzip_body,
    test_malformed_batches_are_422,
    test_missing_blobs_are_409_and_nothing_applied,
    test_record_without_payload_object,
    test_replay_is_ignored,
    test_unknown_log_is_at_zero,
    test_worker_log_cannot_finish_the_run,
    test_worker_log_waits_for_its_run,
)
from tests.unit.test_metric_stats import test_out_of_order_and_resent_points
from tests.unit.test_gc import test_gc_reupload_preserves_new_metadata
from tests.unit.test_archive_guards import (
    test_invalid_archives_are_rejected_before_mutation,
    test_keep_ids_collision_preserves_existing_config_and_logs,
    test_keep_ids_sweep_collision_is_rejected_before_run_import,
    test_archive_late_failure_rolls_back_every_row_and_log_projection,
    test_archive_console_and_blob_roundtrip,
)
from tests.unit.test_report_workspaces import (
    test_concurrent_submit_creates_one_build,
    test_failed_build_can_be_submitted_again,
    test_reopening_workspace_restores_latest_build_status,
    test_repeated_submit_reuses_active_build,
)


def test_nested_transaction_rollback_and_hooks(fresh_db):
    db = fresh_db
    hooks = []
    with db.transaction():
        db.after_commit(lambda: hooks.append("outer"))
        with pytest.raises(ValueError), db.transaction():
            db.write(
                "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
                ["discard", "Discard", "now"],
            )
            db.after_commit(lambda: hooks.append("discard"))
            raise ValueError("rollback savepoint")
        db.write(
            "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
            ["kept", "Kept", "now"],
        )
    assert hooks == ["outer"]
    assert db.read("SELECT id FROM projects") == [("kept",)]


def test_parallel_artifact_versions_have_unique_order(fresh_db, blob_store):
    import json

    from cairn.backend.artifact_registry_ops import create_version

    digest, _ = blob_store.put(json.dumps({"files": []}).encode())

    def create(index):
        return create_version(
            fresh_db,
            blob_store,
            project_id="p",
            name="parallel",
            type="dataset",
            digest=digest,
            metadata={"index": index},
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        versions = list(pool.map(create, range(16)))
    assert sorted(v["version"] for v in versions) == list(range(1, 17))


def test_concurrent_sweep_claims_are_distinct(fresh_db):
    from cairn.backend.sweep_ops import create_sweep, next_trial

    sweep = create_sweep(
        fresh_db,
        project="p",
        name="grid",
        method="grid",
        space={"x": {"values": list(range(20))}},
    )
    with ThreadPoolExecutor(max_workers=8) as pool:
        trials = list(pool.map(lambda _: next_trial(fresh_db, sweep["id"]), range(24)))
    params = [row["trial"]["params"]["x"] for row in trials if row["trial"]]
    assert sorted(params) == list(range(20))


def test_pg_maintenance_is_explicit_about_external_backups(client):
    assert client.get("/api/admin/repo").json()["database_backend"] == "postgresql"
    assert client.post("/api/admin/backup").status_code == 501
    check = client.post("/api/admin/fsck").json()
    assert check["ok"] is True
    assert check["integrity"] == ["not_checked"]
    assert "pg_amcheck" in check["database_check"]


from tests.unit.test_artifact_routes import (
    test_create_errors,
    test_entry_range_past_the_end_is_clamped,
    test_runs_query_route,
    test_version_download_zips_uploaded_entries,
    test_version_routes,
)
from tests.unit.test_project_docs_route import (
    test_comparison_routes_are_gone,
    test_creating_a_view_stores_the_default_first,
    test_current_view_get_and_set,
    test_deleting_the_current_view_makes_the_first_remaining_current,
    test_first_access_lists_a_virtual_default,
    test_first_write_stores_the_default,
    test_last_view_cannot_be_deleted,
    test_legacy_project_workspace_is_preserved_and_requires_conversion,
    test_project_workspace_endpoint_is_gone,
    test_reads_and_writes_need_server_token,
    test_unknown_project_404,
    test_view_missing_404,
    test_view_stale_rev_409_carries_server_doc,
    test_views_are_per_project,
    test_views_crud_in_creation_order,
)
from tests.unit.test_sequences_route import (
    test_slash_named_metric_sequence_roundtrip,
)


def test_pg_s3_report_worker_executes_and_copies_sources(
    database_url, tmp_path, monkeypatch
):
    boto3 = pytest.importorskip("boto3")
    pytest.importorskip("moto.server")
    from fastapi.testclient import TestClient
    from moto.server import ThreadedMotoServer

    from cairn.server.app import create_app
    from tests.integration.test_server_report_builds import wait

    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    server = ThreadedMotoServer(ip_address="127.0.0.1", port=0, verbose=False)
    server.start()
    host, port = server.get_host_and_port()
    endpoint = f"http://{host}:{port}"
    monkeypatch.setenv("CAIRN_S3_ENDPOINT_URL", endpoint)
    try:
        boto3.client("s3", endpoint_url=endpoint).create_bucket(
            Bucket="cairn-report-test"
        )
        app = create_app(
            data_dir=tmp_path / "repo",
            database_url=database_url,
            blob_root="s3://cairn-report-test/reports",
            auth_enabled=False,
            mount_ui=False,
        )
        with TestClient(app) as client:
            source = '---\ntitle: Deployed report\n---\n```{python}\nprint("postgres-and-s3-42")\n```'
            workspace = client.post(
                "/api/report-workspaces",
                json={"slug": "deployed", "files": {"report.qmd": source}},
            ).json()
            response = client.post(
                f"/api/report-workspaces/{workspace['id']}/build",
                json={"expected_revision": 1},
            )
            assert response.status_code == 202, response.text
            result = wait(client, response.json()["id"])
            assert result["status"] == "completed", result
            publication = result["result"]
            pinned = (
                f"/api/reports/{publication['id']}/builds/{publication['version_id']}/"
            )
            assert "postgres-and-s3-42" in client.get(pinned).text
            copy = client.post(
                "/api/report-workspaces", json={"report_id": publication["id"]}
            )
            assert copy.status_code == 201, copy.text
            copied = client.get("/api/report-workspaces/" + copy.json()["id"]).json()
            assert {item["path"]: item["text"] for item in copied["files"]}[
                "report.qmd"
            ] == source
    finally:
        server.stop()

from tests.unit.test_report_workspaces import (
    test_edit_keeps_artifact_family_and_advances_workspace_base,
    test_stale_edit_cannot_capture_newer_head_at_submit,
    test_explicit_fork_creates_new_family_without_changing_original,
    test_deleting_catalog_keeps_artifacts_and_prevents_stale_edit_resurrection,
    test_edit_during_build_prevents_publication,
)


@pytest.fixture
def auth_env(database_url, tmp_path):
    from fastapi.testclient import TestClient
    from cairn.server.app import create_app
    app = create_app(data_dir=tmp_path, database_url=database_url, token='test-token',
                     mount_ui=False, background_tasks=False)
    with TestClient(app) as client:
        yield client, {'write': {'Authorization': 'Bearer test-token'},
                       'read': {'Authorization': 'Bearer invalid'}}

from tests.integration.test_general_records import (
    test_record_receipts_replay_conflict_and_atomic_invalid_batch,
    test_missing_nested_media_is_not_acknowledged,
    test_invalid_timestamp_is_a_final_validation_error,
)
from tests.unit.test_project_cards import test_project_card_counts_do_not_count_report_revisions_as_data_artifacts


def test_structured_record_queries_on_postgres(client):
    import json
    from tests.integration.test_general_records import entry
    from tests.unit.test_ingest_protocol import _create, _post, RID
    observations=[{'loss':.5,'step':10,'experiment':{'seed':1},'data':[{'ok':True}]},
                  {'loss':.4,'step':10,'experiment':{'seed':2}},
                  {'loss':.3,'step':2,'experiment':{'seed':3}},
                  {'loss':.2,'experiment':{'seed':4}}]
    response=_post(client,[_create(),*[entry(i+2,row) for i,row in enumerate(observations)]])
    assert response.status_code==200,response.text
    base=f'/api/runs/{RID}'
    assert [row['values'] for row in client.get(base+'/records').json()['items']]==observations
    filtered=client.get(base+'/records',params={'where':json.dumps({'experiment.seed':{'gte':3}})}).json()['items']
    assert [row['values'] for row in filtered]==observations[2:]
    points=client.get(base+'/record-series',params={'key':'loss'}).json()['points']
    assert [(p['x'],p['y']) for p in points]==[(10,.5),(10,.4),(2,.3),(3,.2)]
    fields=client.get(base+'/record-fields').json()['fields']
    assert '/experiment/seed' in [field['path'] for field in fields]

from tests.unit.test_report_workspaces import test_publication_and_version_delete_share_artifact_family_lock


def _postgres_old_schema(database_url, version):
    """Represent known 7–10 storage with its former 32-bit persisted columns."""
    from cairn.backend.storage.db import Database
    from cairn.backend.storage.migrations import WIDE_INTEGER_COLUMNS
    db = Database.open(database_url)
    with db.transaction():
        for table, columns in WIDE_INTEGER_COLUMNS.items():
            for column in columns:
                db.write(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE INTEGER')
        db.write("INSERT INTO artifacts(hash,mime_type,size_bytes,created_at) VALUES (?,?,?,?)",
                 ['a'*64, 'application/octet-stream', 17, '2026-01-01T00:00:00+00:00'])
        if version <= 9:
            db.write('DROP TABLE run_records')
        if version in (7, 8):
            for column in ('owner', 'lease_until'):
                db.write(f'ALTER TABLE report_builds DROP COLUMN {column}')
            for column in ('revision_id', 'selection', 'revision'):
                db.write(f'ALTER TABLE comments DROP COLUMN {column}')
        db.write('UPDATE schema_version SET version=?', [version])
    db.close()


@pytest.mark.parametrize('version', [7, 8, 9, 10])
def test_pg_supported_upgrade_widens_sizes_and_counters(database_url, version):
    from cairn.backend.storage.db import Database
    from cairn.backend.storage.migrations import SCHEMA_VERSION, WIDE_INTEGER_COLUMNS
    from cairn.backend import artifact_registry_ops, ingest_ops
    from cairn.backend.storage.blobs import BlobStore
    import json
    import tempfile
    from pathlib import Path

    _postgres_old_schema(database_url, version)
    db = Database.open(database_url)
    try:
        assert db.read_one('SELECT version FROM schema_version') == (SCHEMA_VERSION,)
        assert db.read_one('SELECT size_bytes,created_at FROM artifacts WHERE hash=?', ['a'*64]) == (17, '2026-01-01T00:00:00+00:00')
        types = {(r['table_name'], r['column_name']): r['data_type'] for r in db.read_columns(
            'SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema()')}
        assert all(types[(table,column)] == 'bigint' for table,columns in WIDE_INTEGER_COLUMNS.items() for column in columns)
        large = 2**31
        db.write('UPDATE artifacts SET size_bytes=? WHERE hash=?', [large, 'a'*64])
        assert db.read_one('SELECT size_bytes FROM artifacts WHERE hash=?', ['a'*64]) == (large,)
        rid = ingest_ops.create_run(db, project='p')['run_id']
        ingest_ops.insert_batch(db, rid, [{'name':'large-step', 'step':large, 'wall_time':'now',
                                         'object_type':'scalar', 'scalar_value':1.0}])
        assert db.read_one('SELECT step FROM sequences WHERE run_id=?', [rid]) == (large,)
        with tempfile.TemporaryDirectory() as directory:
            blobs = BlobStore(Path(directory))
            digest, _ = blobs.put(json.dumps({'files':[{'path':'large.bin','uri':'s3://external/large.bin','size':large}]}).encode())
            artifact = artifact_registry_ops.create_version(db, blobs, project_id='p', name='large', digest=digest)
            assert artifact_registry_ops.version_files(db, artifact['id'])[0]['size'] == large
    finally:
        db.close()


def test_pg_failed_widening_rolls_back_types_and_version(database_url, monkeypatch):
    from cairn.backend.storage.db import Database
    from cairn.backend.storage.postgres import Connection
    from sqlalchemy import create_engine

    _postgres_old_schema(database_url, 10)
    execute = Connection.execute
    def fail_midway(connection, sql, params=None):
        if sql == 'ALTER TABLE "artifacts" ALTER COLUMN "size_bytes" TYPE BIGINT':
            raise RuntimeError('injected widening failure')
        return execute(connection, sql, params)
    with monkeypatch.context() as patch:
        patch.setattr(Connection, 'execute', fail_midway)
        with pytest.raises(RuntimeError, match='injected widening failure'):
            Database.open(database_url)
    engine = create_engine(database_url)
    try:
        with engine.connect() as con:
            assert con.exec_driver_sql('SELECT version FROM schema_version').scalar() == 10
            assert con.exec_driver_sql("SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='resource_heads' AND column_name='revision'").scalar() == 'integer'
            assert con.exec_driver_sql('SELECT size_bytes FROM artifacts').scalar() == 17
    finally:
        engine.dispose()
    db = Database.open(database_url)
    db.close()


@pytest.mark.parametrize('version', [None, 6])
def test_pg_refuses_unsupported_populated_storage(database_url, version):
    from cairn.backend.storage.db import Database
    from cairn.backend.storage.migrations import UnsupportedSchema
    from sqlalchemy import create_engine

    engine = create_engine(database_url)
    try:
        with engine.begin() as con:
            con.exec_driver_sql('CREATE TABLE saved_data(payload TEXT)')
            con.exec_driver_sql("INSERT INTO saved_data VALUES ('retain')")
            if version is not None:
                con.exec_driver_sql('CREATE TABLE schema_version(version INTEGER)')
                con.exec_driver_sql('INSERT INTO schema_version VALUES (6)')
        with pytest.raises(UnsupportedSchema):
            Database.open(database_url)
        with engine.connect() as con:
            assert con.exec_driver_sql('SELECT payload FROM saved_data').scalar() == 'retain'
            assert con.exec_driver_sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=current_schema()").scalar() == (1 if version is None else 2)
    finally:
        engine.dispose()


def test_pg_datetime_bindings_ignore_server_timezone(fresh_db):
    from datetime import datetime, timedelta, timezone
    timestamp = datetime(2026, 10, 17, 23, 30, tzinfo=timezone(timedelta(hours=2)))
    with fresh_db.transaction():
        fresh_db.write("SET LOCAL TIME ZONE 'Europe/Zurich'")
        fresh_db.write('INSERT INTO projects(id,name,created_at) VALUES (?,?,?)', ['one','One',timestamp])
        fresh_db.executemany('INSERT INTO projects(id,name,created_at) VALUES (?,?,?)', [('two','Two',timestamp)])
    assert fresh_db.read('SELECT created_at FROM projects ORDER BY id') == [
        ('2026-10-17T21:30:00+00:00',), ('2026-10-17T21:30:00+00:00',)]
