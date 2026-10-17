"""Publication comments remain anchored to immutable revisions and use CAS."""
import json
import pytest
from fastapi.testclient import TestClient
import cairn
from cairn.backend.report_publications import publish
from cairn.backend.repository import Repository
from cairn.server.app import create_app

@pytest.fixture
def publication_client(tmp_path):
    path=tmp_path/'repo'
    repo=Repository(path)
    document=tmp_path/'document.json';document.write_text(json.dumps({'blocks':[{'id':'first','type':'markdown','text':'Hello world'},{'id':'second','type':'card'}]}))
    page=tmp_path/'index.html';page.write_text('Hello world')
    versions=[];expected=None
    for i in range(2):
        artifact=cairn.Artifact('report-study',type='report');artifact.add_file(page,'study/index.html');artifact.add_file(document,'study/document.json')
        version=cairn.log_artifact(artifact,project='study',repo=path)
        report=publish(repo._db,'study','study','Study','source',version.id,expected_version=expected)
        expected=version.id;versions.append(version.id)
        page.write_text('second')
    repo.close()
    with TestClient(create_app(path,auth_enabled=False)) as client:
        yield client,f"/api/projects/study/reports/{report['id']}/comments",versions


def test_revision_isolation_passage_reply_resolve_and_cas(publication_client):
    client,url,versions=publication_client
    selection={'schema':'cairn.text-selection/v1','exact':'Hello','prefix':'','suffix':' world','start':{'block_id':'first','offset':0},'end':{'block_id':'first','offset':5}}
    response=client.post(url,json={'body':'Check this','revision_id':versions[0],'anchor_kind':'quote','anchor_id':'first','quote':'Hello','selection':selection})
    assert response.status_code==200,response.text
    comment=response.json();assert comment['revision']==1 and comment['selection']==selection
    assert client.get(url,params={'revision_id':versions[1]}).json()=={'comments':[]}
    assert len(client.get(url,params={'revision_id':versions[0]}).json()['comments'])==1
    reply=client.post(url,json={'body':'Agreed','revision_id':versions[0],'parent_id':comment['id']}).json()
    assert reply['selection']==selection
    assert client.post(url,json={'body':'Wrong revision','revision_id':versions[1],'parent_id':comment['id']}).status_code==400
    edited=client.put(url+'/'+comment['id'],json={'body':'Edited','expected_revision':1}).json()
    assert edited['revision']==2
    assert client.put(url+'/'+comment['id'],json={'body':'Lost update','expected_revision':1}).status_code==409
    resolved=client.post(url+'/'+comment['id']+'/resolve',json={'resolved':True,'expected_revision':2}).json()
    assert resolved['resolved_at'] and resolved['revision']==3
    assert client.post(url+'/'+reply['id']+'/resolve',json={'resolved':True,'expected_revision':1}).status_code==400
    assert client.delete(url+'/'+comment['id'],params={'expected_revision':2}).status_code==409
    assert set(client.delete(url+'/'+comment['id'],params={'expected_revision':3}).json()['deleted'])=={comment['id'],reply['id']}


def test_invalid_revision_anchor_and_body(publication_client):
    client,url,versions=publication_client
    assert client.get(url).status_code==422
    assert client.get(url,params={'revision_id':'missing'}).status_code==404
    base={'body':'Note','revision_id':versions[0],'anchor_kind':'block','anchor_id':'missing'}
    assert client.post(url,json=base).status_code==400
    assert client.post(url,json={**base,'anchor_id':'first','anchor_kind':'card'}).status_code==400
    assert client.post(url,json={**base,'anchor_id':'first','body':' '}).status_code==400
    assert client.post(url,json={**base,'anchor_id':'first','anchor_kind':'quote','quote':'Hello'}).status_code==400
    assert client.post(url,json={**base,'revision_id':'missing'}).status_code==404
    assert client.post(url,json={**base,'anchor_kind':'report','anchor_id':None}).status_code==200
