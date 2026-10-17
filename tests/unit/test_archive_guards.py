"""Run copies validate first and commit their authoritative rows as one unit."""
import hashlib
import io
import json
import zipfile

import pytest

from cairn.backend import run_archive


def _members():
    payload = b'archive blob'
    digest = hashlib.sha256(payload).hexdigest()
    return {
        'manifest.json': json.dumps({'cairn_export_version': 1, 'run_ids': ['archived-run']}),
        'archived-run/run.json': json.dumps({'run': {
            'id': 'archived-run', 'project_id': 'imported', 'display_name': 'Source',
            'created_at': '2026-01-01', 'status': 'completed', 'config': '{"n":1}',
            'summary': '{}',
        }}),
        'archived-run/logs.json': json.dumps([
            {'stream': 'stdout', 'wall_time': '2026-01-01', 'line_no': 0, 'content': 'hello', 'label': None},
        ]),
        'archived-run/logs/combined.log': b'[stdout] hello\n',
        f'artifacts/{digest}.txt': payload,
    }


def _zip(members):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, value in members.items():
            archive.writestr(name, value)
    buf.seek(0)
    return zipfile.ZipFile(buf)


def _state(db):
    tables = ('projects', 'runs', 'run_series', 'params', 'summary', 'artifacts', 'sequences',
              'run_records', 'metric_stats', 'log_lines', 'sweeps', 'sweep_trials', 'alerts',
              'artifact_families', 'artifact_versions', 'artifact_entries', 'artifact_aliases',
              'run_inputs', 'run_links', 'run_sources', 'resource_heads', 'resource_revisions')
    return {table: sorted(map(repr, db.read_columns('SELECT * FROM '+table))) for table in tables}


def _restore(db, blobs, data_dir, members, **kwargs):
    with _zip(members) as archive:
        return run_archive.restore_archive(db, blobs, data_dir, archive, keep_ids=True, **kwargs)


@pytest.mark.parametrize('case', ['future', 'unversioned', 'missing-run', 'different-run', 'duplicate-run',
                                 'bad-json', 'bad-row-json', 'bad-checksum', 'duplicate-blob'])
def test_invalid_archives_are_rejected_before_mutation(fresh_db, blob_store, data_dir, case):
    members = _members()
    if case in ('future', 'unversioned', 'duplicate-run'):
        manifest = json.loads(members['manifest.json'])
        if case == 'future':
            manifest['cairn_export_version'] = 999
        elif case == 'unversioned':
            del manifest['cairn_export_version']
        else:
            manifest['run_ids'].append('archived-run')
        members['manifest.json'] = json.dumps(manifest)
    elif case == 'missing-run':
        del members['archived-run/run.json']
    elif case == 'different-run':
        members['archived-run/run.json'] = json.dumps({'run': {'id': 'different'}})
    elif case == 'bad-json':
        members['archived-run/logs.json'] = '['
    elif case == 'bad-row-json':
        members['archived-run/records.json'] = json.dumps([{'values_json': '{'}])
    else:
        blob = next(name for name in members if name.startswith('artifacts/'))
        if case == 'bad-checksum':
            members[blob] = b'corrupt'
        else:
            members[blob[:-4]+'.bin'] = members[blob]
    before = _state(fresh_db)
    with pytest.raises(ValueError):
        _restore(fresh_db, blob_store, data_dir, members)
    assert _state(fresh_db) == before
    assert list(blob_store.root.rglob('blob')) == []
    assert list(data_dir.logs_dir.iterdir()) == []


@pytest.mark.parametrize('name', ['.', 'archived-run/logs/../../outside', '/outside',
                                'archived-run/logs/sub/../outside', 'archived-run/logs/./outside',
                                'archived-run/logs//outside', 'archived-run\\logs\\outside'])
def test_archive_member_paths_cannot_escape(fresh_db, blob_store, data_dir, name):
    members = _members()
    members[name] = 'outside marker'
    before = _state(fresh_db)
    with pytest.raises(ValueError, match='path'):
        _restore(fresh_db, blob_store, data_dir, members)
    assert _state(fresh_db) == before
    assert not (data_dir.root/'outside').exists()


@pytest.mark.parametrize('run_id', ['..', '../escape', '/absolute', 'nested/run', r'bad\run', 'C:drive'])
def test_archive_run_id_is_one_portable_component(fresh_db, blob_store, data_dir, run_id):
    members = _members()
    members['manifest.json'] = json.dumps({'cairn_export_version': 1, 'run_ids': [run_id]})
    with pytest.raises(ValueError, match='run id'):
        _restore(fresh_db, blob_store, data_dir, members)
    assert fresh_db.read('SELECT id FROM runs') == []


def test_duplicate_archive_names_are_not_ambiguous(fresh_db, blob_store, data_dir):
    with _zip(_members()) as original:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as archive:
            for name in original.namelist():
                archive.writestr(name, original.read(name))
            with pytest.warns(UserWarning, match='Duplicate name'):
                archive.writestr('archived-run/run.json', '{}')
        with zipfile.ZipFile(buf) as archive, pytest.raises(ValueError, match='Duplicate archive member'):
            run_archive.restore_archive(fresh_db, blob_store, data_dir, archive, keep_ids=True)
    assert fresh_db.read('SELECT id FROM runs') == []
    assert list(blob_store.root.rglob('blob')) == []


def test_keep_ids_collision_preserves_existing_config_and_logs(fresh_db, blob_store, data_dir):
    members = _members()
    _restore(fresh_db, blob_store, data_dir, members)
    fresh_db.write('UPDATE runs SET config=? WHERE id=?', ['{"n":99}', 'archived-run'])
    before = _state(fresh_db)
    contents = (data_dir.logs_dir/'archived-run'/'combined.log').read_bytes()
    with pytest.raises(ValueError, match='runs id already exists'):
        _restore(fresh_db, blob_store, data_dir, members)
    assert _state(fresh_db) == before
    assert (data_dir.logs_dir/'archived-run'/'combined.log').read_bytes() == contents


def test_keep_ids_sweep_collision_is_rejected_before_run_import(fresh_db, blob_store, data_dir):
    fresh_db.write("INSERT INTO projects(id,name,created_at) VALUES('existing','Existing','now')")
    fresh_db.write("INSERT INTO sweeps(id,project_id,name,method,space,status,created_at) "
                   "VALUES('sweep','existing','Original','grid','{}','created','now')")
    members = _members()
    members['sweeps.json'] = json.dumps([{'sweep': {'id': 'sweep'}, 'trials': []}])
    before = _state(fresh_db)
    with pytest.raises(ValueError, match='sweeps id already exists'):
        _restore(fresh_db, blob_store, data_dir, members)
    assert _state(fresh_db) == before
    assert list(blob_store.root.rglob('blob')) == []


def test_archive_late_failure_rolls_back_every_row_and_log_projection(fresh_db, blob_store, data_dir, monkeypatch):
    before = _state(fresh_db)
    def fail(*args, **kwargs):
        assert fresh_db.read('SELECT id FROM runs') == [('archived-run',)]
        assert fresh_db.read('SELECT content FROM log_lines') == [('hello',)]
        raise RuntimeError('late import failure')
    monkeypatch.setattr(run_archive, '_restore_registry', fail)
    with pytest.raises(RuntimeError, match='late import failure'):
        _restore(fresh_db, blob_store, data_dir, _members())
    assert _state(fresh_db) == before
    assert list(data_dir.logs_dir.iterdir()) == []


@pytest.mark.parametrize('level', ['logs', 'run', 'file'])
def test_archive_log_projection_rejects_symlink_destinations(fresh_db, blob_store, data_dir, tmp_path, level):
    outside = tmp_path/'outside'
    outside.mkdir()
    sentinel = outside/'combined.log'
    sentinel.write_bytes(b'keep')
    run_dir = data_dir.logs_dir/'archived-run'
    if level == 'logs':
        data_dir.logs_dir.rmdir()
        data_dir.logs_dir.symlink_to(outside, target_is_directory=True)
    elif level == 'run':
        run_dir.symlink_to(outside, target_is_directory=True)
    else:
        run_dir.mkdir()
        (run_dir/'combined.log').symlink_to(sentinel)
    before = _state(fresh_db)
    with pytest.raises(ValueError, match='log destination'):
        _restore(fresh_db, blob_store, data_dir, _members())
    assert _state(fresh_db) == before
    assert sentinel.read_bytes() == b'keep'


def test_archive_console_and_blob_roundtrip(fresh_db, blob_store, data_dir):
    _restore(fresh_db, blob_store, data_dir, _members())
    assert fresh_db.read('SELECT run_id,stream,line_no,content FROM log_lines') == [
        ('archived-run', 'stdout', 0, 'hello'),
    ]
    assert (data_dir.logs_dir/'archived-run'/'combined.log').read_text() == '[stdout] hello\n'
    assert blob_store.get(hashlib.sha256(b'archive blob').hexdigest()) == b'archive blob'
    # Export must retain the authoritative rows even when a derived log file
    # was lost or never written (for example on a remote storage deployment).
    (data_dir.logs_dir/'archived-run'/'combined.log').unlink()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as archive:
        run_archive.write_archive(fresh_db, blob_store, data_dir, ['archived-run'], archive)
    with zipfile.ZipFile(buf) as archive:
        assert json.loads(archive.read('archived-run/logs.json'))[0]['content'] == 'hello'
        assert 'archived-run/logs/combined.log' not in archive.namelist()


def test_import_http_returns_bad_request_for_invalid_archive(client):
    members = _members()
    members['manifest.json'] = '{'
    with _zip(members) as archive:
        response = client.post('/api/import', files={'file': ('bad.zip', archive.fp.getvalue(), 'application/zip')})
    assert response.status_code == 400
    assert client.app.state.db.read('SELECT id FROM runs') == []
