"""Structured log entries have the same durable/query contract locally and over HTTP."""
import hashlib
import io
import json
import time
import zipfile

import pytest
import cairn
from tests.integration.test_artifacts import repo  # noqa: F401 - parametrized local/HTTP fixture
from tests.unit.test_ingest_protocol import _create, _post, _url, RID

QUIET = dict(capture_source=False,capture_stdout=False,capture_env=False,capture_system_metrics=False)


def test_nested_json_optional_repeated_steps_and_predicates(repo):
    observations=[
        {'loss':3.0,'step':8,'split':'train','config':{'batch':16},'samples':[{'label':'cat','ok':True}], 'optional':None},
        {'loss':2.0,'step':8,'split':'validation','config':{'batch':32},'weird/key':{'a.b':7}},
        {'loss':1.0,'step':2,'split':'train','config':{'batch':64}},
        {'loss':0.5,'split':'validation','config':{'batch':128}},
    ]
    with cairn.init(project='records',repo=repo,**QUIET) as run:
        for observation in observations:
            run.log(observation)
    with cairn.Reader(repo) as reader:
        saved=reader.run(run.id)
        first=saved.records(limit=2)
        second=saved.records(limit=2,cursor=first['next_cursor'])
        assert [r['values'] for r in first['items']+second['items']]==observations
        assert [r['event_id'] for r in first['items']+second['items']]==[1,2,3,4]
        assert second['next_cursor'] is None
        assert len(saved.records(where={'config.batch':{'gte':32},'split':'validation'})['items'])==2
        assert saved.records(where={'/weird~1key/a.b':7})['items'][0]['values']==observations[1]
        assert saved.records(where={'samples.0.ok':True})['items'][0]['values']==observations[0]
        assert saved.records(where={'step':{'exists':False}})['items'][0]['values']==observations[3]
        points=saved.record_series('loss',x='step')['points']
        assert [(p['x'],p['y']) for p in points]==[(8,3.0),(8,2.0),(2,1.0),(3,0.5)]
        assert [p['x'] for p in saved.record_series('loss',x=None)['points']]==[0,1,2,3]
        fields={r['path']:r for r in saved.record_fields()['fields']}
        assert fields['/config/batch']['types']==['number']
        assert fields['/split']['types']==['string']
        assert fields['/optional']['types']==['null']


def test_nested_media_and_track_metadata_roundtrip(repo):
    with cairn.init(project='records',repo=repo,**QUIET) as run:
        run.log({'examples':[{'caption':'first','media':cairn.Text('nested text')}], 'round':1})
        run.track(cairn.Text('tracked text'),{'split':'test','sample':{'id':'abc'}})
    with cairn.Reader(repo) as reader:
        saved=reader.run(run.id)
        rows=saved.records()['items']
        assert len(rows)==2
        media=rows[0]['values']['examples'][0]['media']['$media']
        assert media['object_type']=='text'
        assert reader._backend.get_artifact_bytes(media['hash'])==b'nested text'
        assert rows[1]['values']['split']=='test' and rows[1]['values']['sample']=={'id':'abc'}
        assert rows[1]['values']['value']['$media']['object_type']=='text'
        assert len(saved.records(where={'split':'test'})['items'])==1


def entry(seq, values, **extra):
    return {'seq':seq,'op':'entry','payload':{'run_id':RID,'values':values,'timestamp':'2026-10-17T00:00:00+00:00',**extra}}


def test_record_receipts_replay_conflict_and_atomic_invalid_batch(client):
    original=[_create(),entry(2,{'loss':2,'step':4})]
    assert _post(client,original).status_code==200
    assert _post(client,original).status_code==200
    assert _post(client,[entry(2,{'loss':9})]).status_code==409
    response=_post(client,[entry(3,{'loss':1}),entry(4,{'loss':2},timestamp='invalid')])
    assert response.status_code==422,response.text
    assert client.get(_url()).json()=={'applied_seq':2}
    rows=client.get(f'/api/runs/{RID}/records').json()['items']
    assert [r['values'] for r in rows]==[{'loss':2,'step':4}]
    assert client.app.state.db.read_one('SELECT COUNT(*) FROM sequences WHERE run_id=? AND name=?',[RID,'loss'])[0]==1


def test_missing_nested_media_is_not_acknowledged(client):
    digest=hashlib.sha256(b'missing').hexdigest()
    response=_post(client,[_create(),entry(2,{'list':[{'$media':{'hash':digest,'object_type':'text'}}]})])
    assert response.status_code==409,response.text
    assert response.json()['missing_blobs']==[digest]
    assert client.get(_url()).json()=={'applied_seq':0}


def test_invalid_timestamp_is_a_final_validation_error(client):
    response=_post(client,[_create(),entry(2,{'loss':2},timestamp={'bad':'timestamp'})])
    assert response.status_code==422,response.text
    assert client.get(_url()).json()=={'applied_seq':0}


def test_record_snapshots_export_and_gc_preserve_nested_media(tmp_path):
    from cairn.backend.repository import Repository
    from cairn.backend import snapshots,gc,run_archive,ingest_ops,records
    from cairn.backend.storage.datadir import DataDir
    from cairn.backend.storage.db import Database
    from cairn.backend.storage.blobs import BlobStore
    root=tmp_path/'repo'
    with cairn.init(project='records',repo=root,**QUIET) as run:
        run.log({'list':[{'picture':cairn.Text('only nested media')}],'meta':{'step':-1}})
    store=Repository(root)
    try:
        db,blobs=store._db,store.blobs
        snapshot=snapshots.capture_run(db,run.id)
        values=snapshot['records'][0]['values']
        digest=values['list'][0]['picture']['$media']['hash']
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            run_archive.write_archive(db,blobs,DataDir(root),[run.id],archive)
        target=DataDir(tmp_path/'restored'); other=Database.open(target.db_path); other_blobs=BlobStore(target.artifacts_dir)
        try:
            stream.seek(0)
            with zipfile.ZipFile(stream) as archive:
                restored=run_archive.restore_archive(other,other_blobs,target,archive,keep_ids=False)
            rows=records.page(other,restored[0]['new_id'])['items']
            assert rows[0]['values']==values and rows[0]['event_id']==1
            assert other_blobs.get(digest)==b'only nested media'
        finally:
            other.close()
        ingest_ops.delete_run(db,DataDir(root),run.id)
        assert digest in gc.mark(db,DataDir(root),blobs)
        assert snapshots.capture_run(db,run.id,snapshot['snapshot_id'])['records'][0]['values']==values
    finally:
        store.close()


def test_ordinary_json_markers_empty_keys_and_projection_paths(repo):
    values = {'': 1, '$media': 'ordinary', 'nested': {'$media': {'description': 'plain'}},
              '/a/b': 2, 'a': {'b': 3}, 'large': 10 ** 100}
    with cairn.init(project='records', repo=repo, **QUIET) as run:
        run.log(values)
    with cairn.Reader(repo) as reader:
        saved = reader.run(run.id)
        assert saved.records()['items'][0]['values'] == values
        fields = {item['path']: item for item in saved.record_fields()['fields']}
        assert fields['/nested/$media/description']['types'] == ['string']
        assert saved.record_series('/~1a~1b')['points'][0]['y'] == 2
        assert saved.record_series('/a/b')['points'][0]['y'] == 3
        assert saved.record_series('/')['points'][0]['y'] == 1


def test_record_series_shares_byte_budget_across_pages(tmp_path, monkeypatch):
    from cairn.backend import records
    from cairn.backend.repository import Repository
    root = tmp_path / 'bounded'
    with cairn.init(project='records', repo=root, **QUIET) as run:
        for i in range(1100):
            run.log({'value': i, 'padding': 'x' * 100})
    store = Repository(root)
    try:
        monkeypatch.setattr(records, 'MAX_SCAN_BYTES', 135_000)
        result = records.series(store._db, run.id, 'value')
        assert 1000 < result['scanned'] < 1100
        assert result['truncated']
    finally:
        store.close()


def test_general_log_preserves_explicit_metric_axis(tmp_path):
    from cairn.backend.repository import Repository
    with cairn.init(project='records', repo=tmp_path, **QUIET) as run:
        run.define_metric('loss', step_metric='epoch')
        run.log({'step': 1, 'epoch': 3, 'loss': 2})
    store = Repository(tmp_path)
    try:
        assert store._db.read_one('SELECT x FROM metric_defs WHERE run_id=? AND name=?', [run.id, 'loss'])[0] == 'epoch'
        from cairn.backend import records
        with pytest.raises(ValueError, match='media'):
            records.encode({'value': {'$media': {'hash': 'bad', 'object_type': 'text'}}})
    finally:
        store.close()


def test_named_sequence_collision_warns_without_losing_record(tmp_path):
    from cairn.backend.repository import Repository
    with cairn.init(project='records', repo=tmp_path, **QUIET) as run:
        run.track(99, 'loss', step=0)
        run.log({'loss': 3})
    store = Repository(tmp_path)
    try:
        from cairn.backend import records
        assert records.page(store._db, run.id)['items'][0]['values'] == {'loss': 3}
        assert records.series(store._db, run.id, 'loss')['points'][0]['y'] == 3
        assert store._db.read_one('SELECT COUNT(*) FROM alerts WHERE run_id=? AND level=?', [run.id, 'warn'])[0] == 1
    finally:
        store.close()
