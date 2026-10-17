"""Project cards report distinct published reports and data artifact families."""
import json
from cairn.backend import artifact_registry_ops, ingest_ops, report_publications
from tests.unit.test_report_workspaces import version


def test_project_card_counts_do_not_count_report_revisions_as_data_artifacts(client):
    db,blobs=client.app.state.db,client.app.state.blobs
    ingest_ops.create_run(db,project='p')
    first=version(db,blobs)
    report_publications.publish(db,'p','study','Study','first',first['id'])
    second=version(db,blobs,source='second')
    report_publications.publish(db,'p','study','Study','second',second['id'],expected_version=first['id'])
    digest,_=blobs.put(json.dumps({'files':[]}).encode())
    for _ in range(2):
        artifact_registry_ops.create_version(db,blobs,project_id='p',name='dataset',type='dataset',digest=digest)
    assert client.post('/api/projects',json={'name':'Empty'}).status_code==200
    projects={row['id']:row for row in client.get('/api/projects').json()['projects']}
    assert projects['p']['report_count']==1
    assert projects['p']['artifact_count']==1
    assert projects['p']['run_count']==1
    assert projects['p']['active_run_count']==1
    assert projects['p']['last_activity_at']
    assert projects['empty']['report_count']==projects['empty']['artifact_count']==projects['empty']['run_count']==0
    reports=client.get('/api/projects/p/reports').json()['reports']
    assert reports[0]['version']==2
