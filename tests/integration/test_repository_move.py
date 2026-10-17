"""A local repository can become a server repository without changing its format."""
import importlib
import json
import shutil
import time

import pytest
from fastapi.testclient import TestClient

import cairn
from cairn.backend import artifact_registry_ops as artifacts
from cairn.backend import report_publications as publications
from cairn.backend import report_workspaces as workspaces
from cairn.backend.repository import Repository
from cairn.backend.snapshots import capture_run
from cairn.sdk.runlog.rundir import RunDir
from cairn.sdk.runlog.writer import RunWriter
from cairn.server.app import create_app
from cairn.uploader.local import recover_journals

STANDIN = False
QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


def pending_run(repo, run_id, *, endpoint='local', stored_repo=None):
    """Durable bytes left by a writer before their database application."""
    directory = RunDir.for_run(run_id, repo)
    directory.write_meta({'run_id': run_id, 'endpoint': endpoint,
                          'repo': str(stored_repo or repo)})
    writer = RunWriter(directory, run_id)
    try:
        writer.create_run({'project': 'portable', 'run_id': run_id, 'name': 'Pending run'})
        digest = writer.upload_artifact(b'durable pending bytes', 'text/plain')
        writer.post_summary(run_id, {'result': 42})
        writer.finish('completed', 0)
    finally:
        writer.close()
    return directory, digest


@pytest.mark.parametrize('access', ['reader', 'server'])
def test_moved_repository_recovers_pending_local_journals(tmp_path, access):
    original, moved = tmp_path/'original', tmp_path/'moved'
    Repository(original).close()
    run_id = 'a'*32
    _, digest = pending_run(original, run_id)
    shutil.move(original, moved)

    if access == 'reader':
        with cairn.Reader(moved) as reader:
            assert reader.run(run_id).summary['result'] == 42
            assert reader.run(run_id).status == 'completed'
    else:
        with TestClient(create_app(data_dir=moved, auth_enabled=False,
                                   background_tasks=False)) as client:
            response = client.get('/api/runs/'+run_id)
            assert response.status_code == 200, response.text
            assert response.json()['summary_doc']['result'] == 42
            assert response.json()['run']['status'] == 'completed'

    # Reopening is idempotent, including blob recovery and receipt retention.
    with cairn.Reader(moved) as reader:
        assert [run.id for run in reader.runs()] == [run_id]
    storage = Repository(moved)
    try:
        assert storage.blobs.get(digest) == b'durable pending bytes'
        assert storage._db.read_one('SELECT COUNT(*) FROM ingest_receipts WHERE run_id=?', [run_id])[0] == 4
    finally:
        storage.close()
    assert RunDir.for_run(run_id, moved).meta()['repo'] == str(moved)
    assert not original.exists()


def test_recovery_ignores_remote_buffers_and_external_local_directories(tmp_path):
    root, outside = tmp_path/'repo', tmp_path/'outside'
    storage = Repository(root)
    try:
        remote, _ = pending_run(root, 'b'*32, endpoint='https://remote.example')
        foreign, _ = pending_run(outside, 'c'*32, stored_repo=root)
        (root/'runs'/foreign.run_id).symlink_to(foreign.path, target_is_directory=True)
        recover_journals(storage.data_dir, storage._db, storage.blobs)
        recover_journals(storage.data_dir, storage._db, storage.blobs, run_dir=foreign)
        assert storage._db.read_one('SELECT COUNT(*) FROM runs')[0] == 0
        assert remote.meta()['endpoint'] == 'https://remote.example'
        assert remote.meta()['repo'] == str(root)
        assert foreign.meta()['repo'] == str(root)
    finally:
        storage.close()


def report_version(storage, text, expected=None):
    source = '---\ntitle: Portable report\n---\n\n'+text+'\n\n```{python}\nprint("rebuilt after moving")\n```\n'
    files = []
    for path, content in [('study/index.html', '<h1>'+text+'</h1>'),
                          ('sources/report.qmd', source)]:
        digest, size = storage.blobs.put(content.encode())
        files.append({'path': path, 'hash': digest, 'size': size})
    manifest, _ = storage.blobs.put(json.dumps({'files': files}).encode())
    version = artifacts.create_version(storage._db, storage.blobs, project_id='portable',
                                       name='report-study', type='report', digest=manifest)
    return publications.publish(storage._db, 'portable', 'study', 'Portable report',
                                source, version['id'], expected_version=expected)


def test_local_repository_moves_to_authenticated_server_with_history_and_draft(tmp_path):
    original, moved = tmp_path/'local', tmp_path/'server'
    with cairn.init(project='portable', repo=original, **QUIET) as run:
        run.log({'loss': 0.25, 'label': 'retained'})
        run.summary['result'] = 42
    storage = Repository(original)
    try:
        snapshot = capture_run(storage._db, run.id)
        first = report_version(storage, 'First version')
        second = report_version(storage, 'Second version', first['version_id'])
        draft = workspaces.create(storage._db, storage.blobs, report_id=second['id'])
    finally:
        storage.close()
    shutil.move(original, moved)

    with TestClient(create_app(data_dir=moved, auth_enabled=True, token='move-test-token')) as client:
        assert client.get('/api/runs').status_code == 401
        client.headers['Authorization'] = 'Bearer move-test-token'
        assert client.get('/api/runs/'+run.id).json()['run']['id'] == run.id
        pinned = client.get('/api/runs/'+run.id+'/snapshot',
                            params={'revision': snapshot['snapshot_id']}).json()
        assert pinned['snapshot_id'] == snapshot['snapshot_id']
        assert pinned['documents']['summary']['result'] == 42
        history = client.get('/api/reports/'+first['id']+'/history').json()
        assert {row['version_id'] for row in history['versions']} == {first['version_id'], second['version_id']}
        restored = client.get('/api/report-workspaces/'+draft['id']).json()
        assert restored['revision'] == draft['revision']
        assert restored['origin'] == draft['origin']
        first_url = f"/api/reports/{first['id']}/builds/{first['version_id']}/"
        assert 'First version' in client.get(first_url).text

        submitted = client.post('/api/report-workspaces/'+draft['id']+'/build',
                                json={'expected_revision': restored['revision']})
        assert submitted.status_code == 202, submitted.text
        deadline = time.monotonic()+40
        while time.monotonic() < deadline:
            build = client.get('/api/report-builds/'+submitted.json()['id']).json()
            if build['status'] not in ('queued', 'running'):
                break
            time.sleep(.1)
        assert build['status'] == 'completed', build
        assert build['result']['id'] == first['id']
        history = client.get('/api/reports/'+first['id']+'/history').json()
        assert {row['version'] for row in history['versions']} == {1, 2, 3}
        assert 'First version' in client.get(first_url).text
        published = build['result']
        assert 'rebuilt after moving' in client.get(
            f"/api/reports/{published['id']}/builds/{published['version_id']}/").text
    assert not original.exists()


@pytest.mark.parametrize('owned', [True, False])
def test_server_recovery_failure_respects_database_ownership(data_dir, fresh_db, blob_store, monkeypatch, owned):
    app_module = importlib.import_module('cairn.server.app')
    opened = []
    real_open = app_module.open_repo_database

    def open_database(*args, **kwargs):
        database = real_open(*args, **kwargs)
        opened.append(database)
        return database

    def fail(*args, **kwargs):
        raise ValueError('damaged durable journal')

    monkeypatch.setattr(app_module, 'open_repo_database', open_database)
    monkeypatch.setattr('cairn.uploader.local.recover_journals', fail)
    options = {'data_dir': data_dir.root} if owned else {
        'db': fresh_db, 'blobs': blob_store, 'data_dir_obj': data_dir}
    with pytest.raises(ValueError, match='damaged durable journal'):
        with TestClient(create_app(**options, auth_enabled=False, background_tasks=False)):
            pass
    if owned:
        assert len(opened) == 1 and opened[0]._closed
    assert not fresh_db._closed
    assert fresh_db.read_one('SELECT 1') == (1,)
