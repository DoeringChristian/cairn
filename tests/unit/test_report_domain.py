"""Publications are read-only; edits belong to source workspaces."""
import json

import pytest
from fastapi.testclient import TestClient

import cairn
from cairn.backend import reports
from cairn.backend.report_publications import PublicationConflict, publish
from cairn.backend.repository import Repository
from cairn.server.app import create_app


def publication(repo, tmp_path, text, expected=None):
    page=tmp_path/'index.html';page.write_text(text)
    artifact=cairn.Artifact('report-study',type='report')
    artifact.add_file(page,'study/index.html')
    version=cairn.log_artifact(artifact,project='study',repo=repo.repo_root)
    return publish(repo._db,'study','study',text,'---\ntitle: '+text+'\n---\n',version.id,expected_version=expected)


def test_domain_publications_history_and_compare_delete(tmp_path):
    repo=Repository(tmp_path/'repo')
    try:
        first=publication(repo,tmp_path,'First')
        second=publication(repo,tmp_path,'Second',first['version_id'])
        assert reports.read(repo._db,first['id'])['version_id']==second['version_id']
        assert reports.list_page(repo._db,'study')['total']==1
        history=reports.history(repo._db,first['id'])['versions']
        assert len(history)==2 and sum(v['current'] for v in history)==1
        assert reports.file_entry(repo._db,first['id'],'study/index.html',version_id=first['version_id'])['digest']
        with pytest.raises(PublicationConflict):
            reports.delete(repo._db,first['id'],expected_version=first['version_id'])
        reports.delete(repo._db,first['id'],expected_version=second['version_id'])
        assert reports.list_page(repo._db)['total']==0
        with cairn.Reader(repo.repo_root) as reader:
            assert reader.artifact('study/report-study:v1').id==first['version_id']
    finally:
        repo.close()


def test_local_http_reads_share_domain_and_legacy_editor_is_absent(tmp_path):
    path=tmp_path/'repo';repo=Repository(path)
    try:
        published=publication(repo,tmp_path,'Current')
        repo._db.write('INSERT INTO reports(id,project_id,name,created_at,updated_at,payload) VALUES(?,?,?,?,?,?)',
                       ['legacy','study','Old mutable source','now','now',json.dumps({'source':'old'})])
    finally:
        repo.close()
    with TestClient(create_app(path,auth_enabled=False)) as client, cairn.Reader(path) as reader:
        assert len(reader.reports('study'))==1
        rows=client.get('/api/projects/study/reports').json()['reports']
        assert [r['id'] for r in rows]==[published['id']]
        assert client.get('/api/reports/legacy').status_code==404
        detail=client.get('/api/reports/'+published['id']).json()
        assert detail['read_only'] is True
        assert reader.report(published['id']).source==detail['payload']['source']
        assert client.post('/api/projects/study/reports',json={'name':'Old','payload':{'source':'bad'}}).status_code==405
        assert client.put('/api/projects/study/reports/'+published['id'],json={'name':'Mutated'}).status_code==405
        assert client.get('/api/reports/'+published['id']+'/history').json()['total']==1
        assert client.delete('/api/reports/'+published['id']).status_code==422
        assert client.delete('/api/reports/'+published['id'],params={'expected_version':'stale'}).status_code==409
        assert client.delete('/api/reports/'+published['id'],params={'expected_version':published['version_id']}).status_code==200
