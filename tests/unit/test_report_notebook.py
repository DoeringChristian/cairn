"""Reference behavior: Prism tests/test_notebook.py (4 tests passed on reference).

Critical branches: changed upstream resets kernel; unchanged prefix reuses state;
cache survives restart; source edits preserve cell identity; malformed/stale edits
reject; metadata cannot be deleted; failed execution retains preceding outputs.
"""
import time
import pytest
from cairn.backend.storage.context import StorageConfig
from cairn.backend import report_workspaces
from cairn.reports.notebook import NotebookManager

SOURCE='''---
title: Notebook
---
# Editable prose

```{python}
x = 4
print('upstream')
```

```{python}
print(x * 2)
```
'''
@pytest.fixture
def notebook(tmp_path):
    storage=StorageConfig(tmp_path/'repo');manager=NotebookManager(storage)
    draft=report_workspaces.create(manager.db,manager.blobs,slug='notebook',files={'report.qmd':SOURCE})
    yield manager,draft,storage
    manager.close()

def code(view,index):return [c for c in view['cells'] if c['type']=='code'][index]
def text(cell):return ''.join(o.get('text','') for o in cell['outputs'])
def wait(manager,job):
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        result=manager.job(job['id'])
        if result['state'] in {'finished','failed'}:
            while any(s.busy for s in manager.sessions.values()) and time.monotonic()<deadline:time.sleep(.01)
            return result
        time.sleep(.02)
    pytest.fail('Notebook execution timed out')

def test_reference_prefix_reuse_cache_stale_and_pinned_execution(notebook):
    manager,draft,_=notebook;ident=draft['id'];view=manager.notebook(ident)
    first=wait(manager,manager.submit(ident,code(view,0)['id']))
    assert first['state']=='finished',first
    assert text(code(first,0))=='upstream\n'
    second=wait(manager,manager.submit(ident,code(view,1)['id']))
    assert second['reused_cells']==1 and text(code(second,1))=='8\n'
    cached=wait(manager,manager.submit(ident,code(view,1)['id']))
    assert cached['cache_hit'] and cached['execution_ref']!=second['execution_ref']
    current=manager.notebook(ident)
    changed=manager.edit(ident,code(current,0)['id'],"x=7\nprint('changed')",code(current,0)['hash'])
    assert code(changed,0)['id']==code(view,0)['id'] and code(changed,1)['status']=='stale'
    rerun=wait(manager,manager.submit(ident,code(changed,1)['id']))
    assert not rerun['cache_hit'] and rerun['reused_cells']==0
    assert text(code(rerun,1))=='14\n'
    assert text(code(manager.job(second['id']),1))=='8\n'
    forced=wait(manager,manager.submit(ident,code(changed,1)['id'],force=True))
    assert not forced['cache_hit'] and forced['reused_cells']==0


def test_reference_metadata_insert_delete_conflict_failure_restart(notebook):
    manager,draft,storage=notebook;ident=draft['id'];view=manager.notebook(ident)
    with pytest.raises(report_workspaces.Conflict):manager.edit(ident,code(view,0)['id'],'x=100','stale')
    with pytest.raises(ValueError):manager.delete(ident,view['cells'][0]['id'],view['hash'])
    inserted=manager.insert(ident,'markdown','An inserted paragraph',view['cells'][1]['id'],view['hash'])
    prose=next(c for c in inserted['cells'] if c['source'].strip()=='An inserted paragraph')
    removed=manager.delete(ident,prose['id'],prose['hash'])
    assert not any(c['source'].strip()=='An inserted paragraph' for c in removed['cells'])
    bad=manager.edit(ident,code(removed,0)['id'],"print('before')\nraise ValueError('cell failed')",code(removed,0)['hash'])
    failed=wait(manager,manager.submit(ident,code(bad,0)['id']))
    assert failed['state']=='failed' and 'before\n' in text(code(failed,0)) and 'cell failed' in failed['error']
    fixed=manager.edit(ident,code(bad,0)['id'],'x=4',code(bad,0)['hash'])
    good=wait(manager,manager.submit(ident,code(fixed,1)['id']))
    assert good['state']=='finished'
    # A distinct manager has no live kernel; retained cache and output still work.
    manager.close();other=NotebookManager(storage)
    try:
        cached=wait(other,other.submit(ident,code(fixed,1)['id']))
        assert cached['cache_hit'] and text(code(cached,1))=='8\n'
        assert code(other.notebook(ident),1)['status']=='finished'
    finally:other.close()


def test_http_notebook_contract_and_idle_shutdown(tmp_path):
    from fastapi.testclient import TestClient
    from cairn.server.app import create_app
    with TestClient(create_app(tmp_path/'repo',auth_enabled=False,background_tasks=False)) as client:
        created=client.post('/api/report-workspaces',json={'slug':'cells','files':{'report.qmd':SOURCE}})
        assert created.status_code==201,created.text
        ident=created.json()['id'];base=f'/api/report-workspaces/{ident}'
        view=client.get(base+'/notebook').json()
        cell=code(view,0)
        assert client.put(base+'/cells/'+cell['id'],json={'source':'x=9','expected_hash':'stale'}).status_code==409
        changed=client.put(base+'/cells/'+cell['id'],json={'source':'x=9','expected_hash':cell['hash']})
        assert changed.status_code==200,changed.text
        target=code(changed.json(),1)
        client.app.state.notebooks.idle_seconds=.1
        response=client.post(base+'/cells/'+target['id']+'/run',json={})
        assert response.status_code==202,response.text
        job=response.json();deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            result=client.get('/api/notebook-jobs/'+job['id']).json()
            if result['state'] in {'finished','failed'}:break
            time.sleep(.02)
        assert result['state']=='finished',result
        assert text(code(result,1))=='18\n'
        manager=client.app.state.notebooks
        session=manager.sessions[ident]
        while session.busy:time.sleep(.01)
        # Exercise idle policy without a 30-second test delay.
        session.thread.join(timeout=5)
        assert session.stopped and not session.thread.is_alive() and not session.root.exists()


def test_multiple_managers_reject_overlapping_execution_without_failing_live_job(notebook):
    manager,draft,storage=notebook;ident=draft['id'];other=NotebookManager(storage)
    try:
        view=manager.notebook(ident);cell=code(view,0)
        view=manager.edit(ident,cell['id'],'import time\ntime.sleep(.4)\nx=4',cell['hash'])
        queued=manager.submit(ident,code(view,0)['id'])
        assert other.job(queued['id'])['state'] in {'queued','running'}
        with pytest.raises(report_workspaces.Conflict,match='running'):
            other.submit(ident,code(view,0)['id'])
        with pytest.raises(report_workspaces.Conflict,match='running'):
            other.edit(ident,code(view,0)['id'],'x=2',code(view,0)['hash'])
        assert wait(manager,queued)['state']=='finished'
        assert other.job(queued['id'])['state']=='finished'
    finally:other.close()
