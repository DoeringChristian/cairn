"""The revived architecture: direct local storage, buffered remote batches, reports."""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap
import pytest
from fastapi.testclient import TestClient
import cairn
from cairn.sdk.reader import Reader
from cairn.sdk.runlog.rundir import RunDir
from cairn.server.app import create_app
from cairn.uploader.client import IngestClient
from cairn.uploader.sync import sync_paths

STANDIN = False
QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)

def test_local_has_no_network_or_subprocess(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('local tracking must not start a process or use HTTP')
    monkeypatch.setattr(subprocess, 'Popen', forbidden)
    import httpx
    monkeypatch.setattr(httpx.Client, 'request', forbidden)
    repo = tmp_path/'repo'
    with cairn.Run('demo', name='fit', repo=repo, **QUIET) as run:
        run.config(lr=0.1)
        run.track(0.4, 'loss', 0)
        run.track(0.2, 'loss', 1)
        run.summary(best=0.2)
        assert run.version == 1
    with Reader(repo) as reader:
        got = reader.run(run.id)
        assert got.status == 'completed'
        assert got.final['loss'] == 0.2
        assert got.config == {'lr': 0.1}
        with got.edit() as edit:
            edit.set_notes('reviewed')
        assert reader.run(run.id).notes == 'reviewed'
    assert (repo/'runs'/run.id/'run.json').is_file()
    assert not (repo/'server.json').exists()
    assert not (repo/'auth').exists()

def test_concurrent_direct_local_writers(tmp_path):
    repo = tmp_path/'repo'
    code = textwrap.dedent('''
        import cairn,sys
        with cairn.Run('parallel', name='fit', repo=sys.argv[1], capture_source=False,
                       capture_stdout=False,capture_env=False,capture_system_metrics=False) as r:
            for step in range(60): r.track(step, 'loss', step)
    ''')
    children = [subprocess.Popen([sys.executable, '-c', code, str(repo)], stdout=subprocess.PIPE, stderr=subprocess.PIPE) for _ in range(4)]
    for child in children:
        out, err = child.communicate(timeout=30)
        assert child.returncode == 0, err.decode()
    with Reader(repo) as reader:
        runs = list(reader.runs('parallel'))
        assert len(runs) == 4
        assert {r.version for r in runs} == {1, 2, 3, 4}
        assert all(len(r.sequence('loss').values) == 60 for r in runs)
        assert all(r.status == 'completed' for r in runs)

def test_local_recovers_after_process_exit(tmp_path):
    repo = tmp_path/'repo'
    code = textwrap.dedent('''
        import os,sys,cairn
        r=cairn.Run('recovery',repo=sys.argv[1],capture_source=False,capture_stdout=False,
                    capture_env=False,capture_system_metrics=False)
        for step in range(10): r.track(step, 'loss', step)
        print(r.id,flush=True)
        os._exit(0)
    ''')
    p = subprocess.run([sys.executable, '-c', code, str(repo)], env={**os.environ, 'CAIRN_SYNC_INTERVAL_MS':'60000'}, capture_output=True, text=True, timeout=20)
    assert p.returncode == 0, p.stderr
    with Reader(repo) as reader:
        run = reader.run(p.stdout.strip())
        assert list(run.sequence('loss').values) == list(range(10))
        assert run.status == 'crashed'

def test_one_token_for_http_and_browser(tmp_path):
    app = create_app(data_dir=tmp_path/'remote', auth_enabled=True, token='shared-secret')
    with TestClient(app) as client:
        assert client.get('/api/projects').status_code == 401
        assert client.get('/api/projects', headers={'Authorization':'Bearer wrong'}).status_code == 401
        assert client.get('/api/projects', headers={'Authorization':'Bearer shared-secret'}).status_code == 200
        assert client.post('/api/auth/login', json={'token':'wrong'}).status_code == 401
        assert client.post('/api/auth/login', json={'token':'shared-secret'}).status_code == 200
        assert client.get('/api/projects').status_code == 200
        assert app.state.db.read_one("SELECT name FROM sqlite_master WHERE type='table' AND name='tokens'") is None
        assert client.post('/api/auth/otp',json={'otp':'x'}).status_code == 404
        app.state.token = 'rotated'
        assert client.get('/api/projects').status_code == 401
        assert client.get('/api/projects', headers={'Authorization':'Bearer rotated'}).status_code == 200

def test_remote_buffers_and_retries_batches(tmp_path, monkeypatch):
    buffer = tmp_path/'buffer'
    monkeypatch.setenv('CAIRN_DIR', str(buffer))
    monkeypatch.setenv('CAIRN_UPLOADER', 'off')
    monkeypatch.setenv('CAIRN_TOKEN','shared-secret')
    with cairn.Run('demo', name='remote', repo='http://127.0.0.1:1', **QUIET) as run:
        for step in range(100): run.track(step/100,'loss',step)
    assert not list(buffer.rglob('*.db'))
    assert not (buffer/'version').exists()
    app = create_app(data_dir=tmp_path/'server', auth_enabled=True, token='shared-secret')
    with TestClient(app) as http:
        ingest = IngestClient('http://testserver', 'shared-secret', client=http)
        rd = RunDir.for_run(run.id)
        assert sync_paths([rd], client_for=lambda _: ingest)[rd.path] is None
        assert sync_paths([rd], client_for=lambda _: ingest)[rd.path] is None
        assert app.state.db.read_one("SELECT COUNT(*) FROM sequences WHERE name='loss'")[0] == 100
        assert app.state.db.read_one('SELECT status FROM runs WHERE id=?',[run.id])[0] == 'completed'
        assert not rd.pending()

def make_report(root, run_id):
    folder = root/'reports'/'study'
    folder.mkdir(parents=True)
    (folder/'report.md').write_text('---\ntitle: Fit study\ninputs:\n  fit: "run:'+run_id+'"\n---\n\n# Evidence\n\n```{python}\n#| echo: false\nimport json\nimport matplotlib.pyplot as plt\nfrom IPython.display import display, Markdown\nloss=json.loads((inputs["fit"] / "metrics.jsonl").read_text().splitlines()[-1])["value"]\nplt.plot([1,2], [loss, loss/2])\nplt.title("Loss trend")\ndisplay(plt.gcf())\nplt.close()\ndisplay(Markdown(f"Loss is {loss}."))\n```\n')
    return folder

def test_report_build_publish_and_pinned_evidence(tmp_path):
    from cairn.reports import build_all
    from cairn.reports.publishing import publish_report
    repo = tmp_path/'repo'
    with cairn.Run('demo', name='fit', repo=repo, **QUIET) as run:
        run.track(0.2,'loss',0)
    make_report(tmp_path, run.id)
    result = publish_report('study', project=tmp_path, repo=repo, namespace='demo')
    output = tmp_path/'.cairn/build/study'
    narrative = (output/'index.html').read_text()
    assert 'Loss is 0.2.' in narrative
    assert 'data:image/png;base64,' in narrative
    manifest = json.loads((output/'manifest.json').read_text())
    assert len(manifest['inputs']['fit']['snapshot']) == 64
    with TestClient(create_app(data_dir=repo, auth_enabled=False)) as client:
        entry=f"/api/reports/{result['id']}/render/study/index.html"
        assert client.get(entry).status_code == 200
        assert 'Fit study' in client.get(f"/api/reports/{result['id']}/render/study/document.json").text
        assert client.get(f"/api/reports/{result['id']}/render/evidence/fit/metrics.jsonl").status_code == 200
        assert client.get(f"/api/reports/{result['id']}/render/not-in-the-manifest").status_code == 404
    with Reader(repo) as reader:
        report = reader.report(result['id'])
        assert report.name == 'Fit study'
        artifact = reader.artifact('demo/report-study:v1')
        assert 'evidence/fit/metrics.jsonl' in [entry.path for entry in artifact.files()]
    # Rebuilding after a later edit must not alter the captured first publication.
    with Reader(repo) as reader:
        with reader.run(run.id).edit() as edit:
            edit.set_summary({'reviewed': True})
    builds = build_all(project=tmp_path, repo=repo, namespace='demo')
    new_manifest = json.loads((builds[0].generated/'manifest.json').read_text())
    assert new_manifest['inputs']['fit']['snapshot'] != manifest['inputs']['fit']['snapshot']
    with Reader(repo) as reader:
        artifact = reader.artifact('demo/report-study:v1')
        assert b'reviewed' not in artifact._read_entry(artifact.get_entry('evidence/fit/summary.json'))


def test_report_publishes_to_remote_without_local_database(tmp_path, live_server, monkeypatch):
    from cairn.reports.publishing import publish_report
    monkeypatch.setenv('CAIRN_DIR', str(tmp_path/'buffer'))
    monkeypatch.setenv('CAIRN_UPLOADER', 'off')
    with cairn.Run('demo', name='remote-fit', repo=live_server, **QUIET) as run:
        run.track(0.3, 'loss', 0)
    rd = RunDir.for_run(run.id)
    assert sync_paths([rd])[rd.path] is None
    make_report(tmp_path, run.id)
    result = publish_report('study', project=tmp_path, repo=live_server, namespace='demo')
    import httpx
    with httpx.Client(base_url=live_server) as client:
        response=client.get(f"/api/reports/{result['id']}/render/study/document.json")
        assert response.status_code == 200
        assert 'Fit study' in response.text
    assert not list((tmp_path/'.cairn').rglob('*.db'))


def test_report_rejects_mutated_captured_evidence(tmp_path):
    from cairn.reports import build_all
    repo=tmp_path/'repo'
    with cairn.Run('demo',repo=repo,**QUIET) as run:
        run.track(0.2,'loss',0)
    folder=make_report(tmp_path,run.id)
    source=folder/'report.md'
    source.write_text(source.read_text().replace('loss=json.loads', '(inputs["fit"] / "summary.json").write_text("{}modified")\nloss=json.loads'))
    with pytest.raises(ValueError,match='modified captured evidence'):
        build_all(project=tmp_path,repo=repo)


def test_report_publication_protects_its_artifact_and_keeps_source(tmp_path):
    from cairn.reports.publishing import publish_report
    from cairn.sdk.connect import open_writer
    repo=tmp_path/'repo'
    with cairn.Run('demo',repo=repo,**QUIET) as run:
        run.track(0.2,'loss',0)
    make_report(tmp_path,run.id)
    result=publish_report('study',project=tmp_path,repo=repo,namespace='demo')
    with Reader(repo) as reader:
        artifact=reader.artifact('demo/report-study:v1')
        assert 'sources/report.md' in [entry.path for entry in artifact.files()]
        with pytest.raises(ValueError,match='published report'):
            artifact.delete(force=True)
    writer,_=open_writer(repo)
    try:
        writer.remove_report(result['id'], expected_version=result['version_id'])
    finally:
        writer.close()
    with Reader(repo) as reader:
        assert reader.reports('demo') == []
        assert reader.artifact('demo/report-study:v1').id == result['version_id']


def test_published_build_urls_stay_pinned_after_republish(tmp_path):
    from cairn.reports.publishing import publish_report
    repo=tmp_path/'repo'
    folder=tmp_path/'reports'/'study'
    folder.mkdir(parents=True)
    source=folder/'report.md'
    source.write_text('---\ntitle: Original\n---\nFirst publication.\n')
    first=publish_report('study',project=tmp_path,repo=repo,namespace='demo')
    source.write_text('---\ntitle: Revised\n---\nSecond publication.\n')
    second=publish_report('study',project=tmp_path,repo=repo,namespace='demo')
    assert first['id'] == second['id'] and first['version_id'] != second['version_id']
    with TestClient(create_app(data_dir=repo, auth_enabled=False)) as client:
        base=f"/api/reports/{first['id']}/builds/{first['version_id']}/"
        assert 'First publication.' in client.get(base+'study/index.html').text
        assert 'immutable' in client.get(base+'study/index.html').headers['cache-control']
        assert 'Second publication.' in client.get(f"/api/reports/{second['id']}/render/study/index.html").text
        assert client.get(base).status_code == 200


def test_report_export_embeds_plotly_runtime_and_provenance(tmp_path):
    from cairn.reports.config import load_config
    from cairn.reports.share import share
    folder = tmp_path/'reports'/'study'
    folder.mkdir(parents=True)
    (folder/'report.md').write_text("""---
title: Interactive study
---
```{python}
import plotly.graph_objects as go
from IPython.display import display, HTML
figure = go.Figure(go.Scatter(x=[1, 2], y=[2, 3]))
display(HTML(figure.to_html(full_html=False, include_plotlyjs=True)))
```
""")
    target = share(load_config(tmp_path), report='study')
    html = target.read_text()
    assert 'plotly.js' in html
    assert 'Plotly.newPlot' in html
    assert 'report:' in html and 'data-source-file=' in html
    assert html.lower().startswith('<!doctype html>')


def test_worker_can_finish_before_primary_and_reader_recovers(tmp_path):
    repo = tmp_path/'repo'
    run_id = cairn.new_run_id()
    worker = cairn.attach(run_id, label='early', project='demo', repo=repo,
                          system_metrics=False, capture_output=False)
    worker.log({'worker_loss': 0.25})
    worker.finish()
    pending = RunDir.for_run(run_id, base=repo)
    assert pending.pending()
    with cairn.Run('demo', repo=repo, run_id=run_id, **QUIET) as primary:
        primary.log({'loss': 0.5})
    with Reader(repo) as reader:
        saved = reader.run(run_id)
        assert saved.status == 'completed'
        assert saved.sequence('worker_loss').values == [0.25]
        assert saved.sequence('loss').values == [0.5]
    assert not pending.pending()
