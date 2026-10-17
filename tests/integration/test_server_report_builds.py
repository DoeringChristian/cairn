"""Real fresh-kernel server builds and immutable published source copies."""
import time
from fastapi.testclient import TestClient
from cairn.server.app import create_app


def wait(client, ident):
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        job = client.get('/api/report-builds/' + ident).json()
        if job['status'] not in ('queued', 'running'):
            return job
        time.sleep(.1)
    raise AssertionError('server report build did not finish')


def test_qmd_copy_edit_server_build_is_pinned(tmp_path):
    app = create_app(data_dir=tmp_path/'repo', auth_enabled=False)
    source = '---\ntitle: Server report\n---\n\n```{python}\nprint("server-result-42")\n```\n'
    with TestClient(app) as client:
        response = client.post('/api/report-workspaces', json={'project_id': 'demo', 'slug': 'example',
                               'files': {'report.qmd': source}})
        assert response.status_code == 201, response.text
        workspace = response.json()
        job = client.post(f"/api/report-workspaces/{workspace['id']}/build", json={'expected_revision': 1}).json()
        finished = wait(client, job['id'])
        assert finished['status'] == 'completed', finished
        result = finished['result']
        pinned = f"/api/reports/{result['id']}/builds/{result['version_id']}/"
        html = client.get(pinned)
        assert html.status_code == 200
        assert 'server-result-42' in html.text
        listing = client.get(f"/api/reports/{result['id']}/files",params={'version_id':result['version_id']})
        assert listing.status_code == 200, listing.text
        assert any(f['path']=='sources/report.qmd' for f in listing.json()['files'])
        archive = client.get(f"/api/reports/{result['id']}/bundle",params={'version_id':result['version_id']})
        assert archive.status_code == 200
        import io, zipfile
        with zipfile.ZipFile(io.BytesIO(archive.content)) as bundled:
            assert bundled.read('sources/report.qmd').decode() == source
        copy = client.post('/api/report-workspaces', json={'report_id': result['id'], 'fork': True}).json()
        assert copy['slug'] != 'example'
        edited = client.put('/api/report-workspaces/'+copy['id'], json={
            'expected_revision': 1, 'files': {'report.qmd': source.replace('42', '99')}})
        assert edited.status_code == 200, edited.text
        stale = client.put('/api/report-workspaces/'+copy['id'], json={
            'expected_revision': 1, 'files': {'report.qmd': 'stale'}})
        assert stale.status_code == 409
        job2 = client.post(f"/api/report-workspaces/{copy['id']}/build", json={'expected_revision': 2}).json()
        second = wait(client, job2['id'])
        assert second['status'] == 'completed', second
        assert second['result']['id'] != result['id']
        assert client.get(pinned).text == html.text


def test_failed_server_build_keeps_diagnostics_and_no_publication(tmp_path):
    with TestClient(create_app(data_dir=tmp_path/'repo', auth_enabled=False)) as client:
        workspace = client.post('/api/report-workspaces', json={'slug':'broken', 'files':{
            'report.qmd': '```{python}\nraise RuntimeError("expected failure")\n```'}}).json()
        job = client.post(f"/api/report-workspaces/{workspace['id']}/build", json={'expected_revision': 1}).json()
        result = wait(client, job['id'])
        assert result['status'] == 'failed'
        assert 'expected failure' in result['error']
        assert list((tmp_path/'repo'/'report-jobs'/job['id']).rglob('failed.ipynb'))
        diagnostics=client.get(f"/api/report-builds/{job['id']}/diagnostics").json()['files']
        failed=next(f['path'] for f in diagnostics if f['path'].endswith('failed.ipynb'))
        assert client.get(f"/api/report-builds/{job['id']}/diagnostics/{failed}").status_code==200
        assert client.get('/api/report-publications/current',params={'project_id':'default','slug':'broken'}).json()['version_id'] is None


def test_queued_inputs_are_captured_before_worker_runs(tmp_path):
    import cairn
    from cairn.reports.worker import Worker
    repo = tmp_path/'repo'
    with cairn.init(project='demo', repo=repo, capture_source=False) as run:
        run.summary['value'] = 42
    with TestClient(create_app(data_dir=repo, auth_enabled=False, background_tasks=False)) as client:
        source = f'---\ninputs:\n  fit: run:{run.id}\n---\n```{{python}}\nprint("PINNED", inputs["fit"].summary["value"])\n```'
        workspace = client.post('/api/report-workspaces', json={'project_id':'demo','slug':'pinned',
            'files':{'report.qmd':source}}).json()
        response = client.post(f"/api/report-workspaces/{workspace['id']}/build", json={'expected_revision':1})
        assert response.status_code == 202, response.text
        job=response.json()
        with cairn.Reader(repo) as reader:
            with reader.run(run.id).edit() as editor:
                editor.set_summary(value=99)
        # A repeated click must keep the already accepted build and its pinned
        # evidence, even if an input changed while that build was queued.
        repeated = client.post(f"/api/report-workspaces/{workspace['id']}/build", json={'expected_revision':1})
        assert repeated.status_code == 202, repeated.text
        assert repeated.json()['id'] == job['id']
        restored = client.get(f"/api/report-workspaces/{workspace['id']}").json()['latest_build']
        assert restored['id'] == job['id'] and restored['status'] == 'queued'
        from cairn.backend import revisions
        db, _, _ = client.app.state.storage.open()
        try:
            assert revisions.current(db, 'report-prepared', job['id']) == 1
            assert db.read_one('SELECT COUNT(*) FROM report_builds')[0] == 1
        finally:
            db.close()
        worker=Worker(repo)
        worker.start()
        try:
            result=wait(client,job['id'])
            assert result['status']=='completed', result
            restored = client.get(f"/api/report-workspaces/{workspace['id']}").json()['latest_build']
            assert restored['status'] == 'completed' and restored['result'] == result['result']
            publication=result['result']
            html=client.get(f"/api/reports/{publication['id']}/builds/{publication['version_id']}/").text
            assert 'PINNED 42' in html
            assert 'PINNED 99' not in html
        finally:
            worker.close()


def test_edit_publishes_next_artifact_revision_of_same_report(tmp_path):
    with TestClient(create_app(data_dir=tmp_path/'repo',auth_enabled=False)) as client:
        source='---\ntitle: Evolving report\n---\n```{python}\nprint("revision-one")\n```'
        workspace=client.post('/api/report-workspaces',json={'slug':'evolving','files':{'report.qmd':source}}).json()
        job=client.post(f"/api/report-workspaces/{workspace['id']}/build",json={'expected_revision':1}).json()
        first=wait(client,job['id'])
        assert first['status']=='completed',first
        report=first['result']
        original=f"/api/reports/{report['id']}/builds/{report['version_id']}/"
        original_html=client.get(original).text
        edit=client.post('/api/report-workspaces',json={'report_id':report['id']}).json()
        assert edit['slug']=='evolving'
        response=client.put('/api/report-workspaces/'+edit['id'],json={'expected_revision':1,'files':{'report.qmd':source.replace('revision-one','revision-two')}})
        assert response.status_code==200,response.text
        job=client.post(f"/api/report-workspaces/{edit['id']}/build",json={'expected_revision':2}).json()
        second=wait(client,job['id'])
        assert second['status']=='completed',second
        assert second['result']['id']==report['id']
        assert second['result']['version_id']!=report['version_id']
        assert 'revision-two' in client.get(f"/api/reports/{report['id']}/builds/{second['result']['version_id']}/").text
        assert client.get(original).text==original_html
        history=client.get('/api/reports/'+report['id']+'/history').json()
        assert history['total']==2
        assert {entry['version'] for entry in history['versions']}=={1,2}


def test_new_report_notebook_edit_run_first_publication(tmp_path):
    """Browser creation requires no existing report, document, or declared input."""
    import time
    with TestClient(create_app(data_dir=tmp_path/'repo', auth_enabled=False)) as client:
        source = '---\ntitle: "New browser report"\n---\n\n# Research\n\n```{python}\n# Start your analysis here.\n```\n'
        created = client.post('/api/report-workspaces', json={
            'project_id': 'browser', 'slug': 'new-study', 'files': {'report.qmd': source}})
        assert created.status_code == 201, created.text
        workspace = created.json()
        base = '/api/report-workspaces/' + workspace['id']
        notebook = client.get(base+'/notebook').json()
        cell = next(cell for cell in notebook['cells'] if cell['type'] == 'code')
        changed = client.put(base+'/cells/'+cell['id'], json={
            'source': "print('Browser result:', 6 * 7)", 'expected_hash': cell['hash']})
        assert changed.status_code == 200, changed.text
        execution = client.post(base+'/cells/'+cell['id']+'/run', json={})
        assert execution.status_code == 202, execution.text
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = client.get('/api/notebook-jobs/'+execution.json()['id']).json()
            if state['state'] in {'finished', 'failed'}:
                break
            time.sleep(.02)
        assert state['state'] == 'finished', state
        saved = client.get(base).json()
        assert '6 * 7' in next(file['text'] for file in saved['files'] if file['path']=='report.qmd')
        submitted = client.post(base+'/build', json={'expected_revision': saved['revision']})
        assert submitted.status_code == 202, submitted.text
        finished = wait(client, submitted.json()['id'])
        assert finished['status'] == 'completed', finished
        result = finished['result']
        html = client.get(f"/api/reports/{result['id']}/builds/{result['version_id']}/")
        assert 'Browser result: 42' in html.text
        listing = client.get('/api/projects/browser/reports').json()['reports']
        assert len(listing) == 1 and listing[0]['version'] == 1
