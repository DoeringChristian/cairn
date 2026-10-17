"""Report edits publish revisions in one artifact family; forks are explicit."""
import json
import time

import pytest

from cairn.backend import artifact_registry_ops as artifacts
from cairn.backend import report_publications as publications
from cairn.backend import report_workspaces as workspaces
from cairn.backend import reports


def version(db, blobs, *, slug='study', source='first'):
    files = []
    for path, data in ((f'{slug}/index.html', source), ('sources/report.qmd', source)):
        digest, size = blobs.put(data.encode())
        files.append({'path':path,'hash':digest,'size':size})
    digest, _ = blobs.put(json.dumps({'files':files}).encode())
    return artifacts.create_version(db,blobs,project_id='p',name='report-'+slug,type='report',digest=digest)


def initial(db, blobs):
    v = version(db,blobs)
    report = publications.publish(db,'p','study','Study','first',v['id'])
    return report, v


def publish_job(db, blobs, workspace, source):
    job = workspaces.submit(db,workspace['id'],expected_revision=workspace['revision'])
    v = version(db,blobs,slug=workspace['slug'],source=source)
    db.write("UPDATE report_builds SET status='running',lease_until=? WHERE id=?", [time.time()+60,job['id']])
    result = publications.publish(db,'p',workspace['slug'],'Study',source,v['id'],
                                  expected_version=job['expected_version'],build_id=job['id'])
    return result, v


def test_edit_keeps_artifact_family_and_advances_workspace_base(fresh_db,blob_store):
    db,blobs=fresh_db,blob_store
    report,v1=initial(db,blobs)
    edit=workspaces.create(db,blobs,report_id=report['id'])
    assert edit['slug']=='study'
    assert json.loads(edit['origin'])['base_version']==v1['id']
    edited=workspaces.update(db,blobs,edit['id'],files={'report.qmd':'second'},expected_revision=1)
    second,v2=publish_job(db,blobs,edited,'second')
    assert second['id']==report['id']
    assert v2['family_id']==v1['family_id'] and v2['version']==2
    assert len(reports.history(db,report['id'])['versions'])==2
    base=workspaces.get(db,blobs,edit['id'])
    assert json.loads(base['origin'])['version_id']==v2['id']
    third,v3=publish_job(db,blobs,base,'third')
    assert third['id']==report['id'] and v3['version']==3
    assert artifacts.version_files(db,v1['id'])[0]['digest']


@pytest.mark.parametrize('status', ['queued', 'running'])
def test_repeated_submit_reuses_active_build(fresh_db, blob_store, status):
    db, blobs = fresh_db, blob_store
    edit = workspaces.create(db, blobs, slug='study', files={'report.qmd': 'First draft'})
    first = workspaces.submit(db, edit['id'], expected_revision=1)
    db.write('UPDATE report_builds SET status=? WHERE id=?', [status, first['id']])

    repeated = workspaces.submit(db, edit['id'], expected_revision=1)

    assert repeated['id'] == first['id']
    assert repeated['status'] == status
    assert db.read_one('SELECT COUNT(*) FROM report_builds')[0] == 1


def test_concurrent_submit_creates_one_build(fresh_db, blob_store):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    db, blobs = fresh_db, blob_store
    edit = workspaces.create(db, blobs, slug='study', files={'report.qmd': 'First draft'})
    ready = threading.Barrier(8)

    def submit(_):
        ready.wait(timeout=5)
        return workspaces.submit(db, edit['id'], expected_revision=1)

    with ThreadPoolExecutor(max_workers=8) as pool:
        builds = list(pool.map(submit, range(8)))

    assert len({build['id'] for build in builds}) == 1
    assert db.read_one('SELECT COUNT(*) FROM report_builds')[0] == 1


def test_failed_build_can_be_submitted_again(fresh_db, blob_store):
    db, blobs = fresh_db, blob_store
    edit = workspaces.create(db, blobs, slug='study', files={'report.qmd': 'First draft'})
    first = workspaces.submit(db, edit['id'], expected_revision=1)
    db.write("UPDATE report_builds SET status='failed' WHERE id=?", [first['id']])

    retried = workspaces.submit(db, edit['id'], expected_revision=1)

    assert retried['id'] != first['id']
    assert retried['status'] == 'queued'


def test_reopening_workspace_restores_latest_build_status(fresh_db, blob_store):
    db, blobs = fresh_db, blob_store
    edit = workspaces.create(db, blobs, slug='study', files={'report.qmd': 'First draft'})
    assert edit['latest_build'] is None
    first = workspaces.submit(db, edit['id'], expected_revision=1)
    db.write("UPDATE report_builds SET status='failed',error='Previous failure',created_at='2000-01-01' WHERE id=?", [first['id']])
    latest = workspaces.submit(db, edit['id'], expected_revision=1)

    restored = workspaces.get(db, blobs, edit['id'])['latest_build']
    assert restored == latest
    assert 'files' not in restored
    db.write("UPDATE report_builds SET status='running' WHERE id=?", [latest['id']])
    workspaces.finish(db, latest['id'], error='Execution failed')
    restored = workspaces.get(db, blobs, edit['id'])['latest_build']
    assert restored['status'] == 'failed'
    assert restored['error'] == 'Execution failed'


def test_stale_edit_cannot_capture_newer_head_at_submit(fresh_db,blob_store):
    db,blobs=fresh_db,blob_store
    report,v1=initial(db,blobs)
    stale=workspaces.create(db,blobs,report_id=report['id'])
    current=workspaces.create(db,blobs,report_id=report['id'])
    publish_job(db,blobs,current,'newer')
    with pytest.raises(workspaces.Conflict,match='changed since'):
        workspaces.submit(db,stale['id'],expected_revision=1)
    assert db.read_one('SELECT COUNT(*) FROM report_builds')[0]==1


def test_explicit_fork_creates_new_family_without_changing_original(fresh_db,blob_store):
    db,blobs=fresh_db,blob_store
    report,v1=initial(db,blobs)
    fork=workspaces.create(db,blobs,report_id=report['id'],fork=True)
    assert fork['slug']!='study'
    copy,v2=publish_job(db,blobs,fork,'forked')
    assert copy['id']!=report['id'] and v2['family_id']!=v1['family_id']
    assert publications.current_version(db,'p','study')==v1['id']
    with pytest.raises(ValueError,match='fork'):
        workspaces.create(db,blobs,report_id=report['id'],slug='implicit-copy')
    with pytest.raises(ValueError,match='fork'):
        workspaces.submit(db,fork['id'],expected_revision=1,slug='implicit-copy')


def test_deleting_catalog_keeps_artifacts_and_prevents_stale_edit_resurrection(fresh_db,blob_store):
    db,blobs=fresh_db,blob_store
    report,v1=initial(db,blobs)
    edit=workspaces.create(db,blobs,report_id=report['id'])
    reports.delete(db,report['id'],expected_version=v1['id'])
    assert artifacts.get_version(db,v1['id'])['id']==v1['id']
    assert reports.list_page(db)['total']==0
    with pytest.raises(workspaces.Conflict):
        workspaces.submit(db,edit['id'],expected_revision=1)


def test_edit_during_build_prevents_publication(fresh_db,blob_store):
    db,blobs=fresh_db,blob_store
    report,v1=initial(db,blobs)
    edit=workspaces.create(db,blobs,report_id=report['id'])
    job=workspaces.submit(db,edit['id'],expected_revision=1)
    db.write("UPDATE report_builds SET status='running',lease_until=? WHERE id=?",[time.time()+60,job['id']])
    workspaces.update(db,blobs,edit['id'],files={'report.qmd':'changed'},expected_revision=1)
    v2=version(db,blobs,source='old build')
    with pytest.raises(publications.PublicationConflict,match='source copy changed'):
        publications.publish(db,'p','study','Study','old build',v2['id'],expected_version=v1['id'],build_id=job['id'])
    assert publications.current_version(db,'p','study')==v1['id']


def test_publication_and_version_delete_share_artifact_family_lock(fresh_db,blob_store,monkeypatch):
    """Pause publication after validation while deletion tries to remove its bytes."""
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    import threading
    db,blobs=fresh_db,blob_store
    candidate=version(db,blobs)
    validated=threading.Event(); release=threading.Event(); deleting=threading.Event()
    original=artifacts.version_files
    def pause_after_validation(database,version_id):
        files=original(database,version_id)
        if threading.current_thread().name.startswith('publish-race'):
            validated.set()
            assert release.wait(5)
        return files
    monkeypatch.setattr(artifacts,'version_files',pause_after_validation)
    def delete():
        deleting.set()
        with pytest.raises(ValueError,match='published report'):
            artifacts.delete_version(db,candidate['id'],force=True)
    with ThreadPoolExecutor(max_workers=1,thread_name_prefix='publish-race') as publisher, ThreadPoolExecutor(max_workers=1) as remover:
        published=publisher.submit(publications.publish,db,'p','study','Study','source',candidate['id'])
        assert validated.wait(5)
        deletion=remover.submit(delete)
        assert deleting.wait(5)
        with pytest.raises(TimeoutError):
            deletion.result(timeout=.05)
        release.set()
        result=published.result(timeout=5)
        deletion.result(timeout=5)
    assert reports.read(db,result['id'])['version_id']==candidate['id']
    assert artifacts.get_version(db,candidate['id'])['id']==candidate['id']
