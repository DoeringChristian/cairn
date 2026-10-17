"""A base server reads published reports without the optional notebook runtime."""
import builtins

from fastapi.testclient import TestClient
import pytest

from cairn.backend.repository import Repository
from cairn.backend.storage.db import Database
from cairn.server.app import create_app
from cairn.server.report_execution import UNAVAILABLE
from tests.unit.test_report_domain import publication


def missing_notebook_import(monkeypatch, dependency='jupyter_client'):
    original = builtins.__import__
    def unavailable(name, *args, **kwargs):
        if name == 'cairn.reports.notebook':
            raise ModuleNotFoundError('missing optional dependency', name=dependency)
        if name == 'cairn.reports.worker':
            pytest.fail('A base server must not load or start the report worker')
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, '__import__', unavailable)


@pytest.mark.parametrize('background_tasks', [False, True])
@pytest.mark.parametrize('dependency', ['jupyter_client', 'nbformat'])
def test_base_lifespan_serves_viewer_reports_and_source_without_execution(tmp_path, monkeypatch, background_tasks, dependency):
    root = tmp_path/'repo'
    repository = Repository(root)
    try:
        published = publication(repository, tmp_path, '<html>Published result</html>')
    finally:
        repository.close()
    missing_notebook_import(monkeypatch, dependency)
    app = create_app(root, mount_ui=True, auth_enabled=False, background_tasks=background_tasks)
    closed = []
    original_close = Database.close
    def close(db):
        closed.append(db)
        original_close(db)
    monkeypatch.setattr(Database, 'close', close)
    with TestClient(app) as client:
        assert app.state.notebooks is None
        assert client.get('/').status_code == 200
        assert client.get('/api/health').status_code == 200
        assert client.get('/api/reports').json()['total'] == 1
        report = client.get('/api/reports/'+published['id'])
        assert report.status_code == 200 and report.json()['version_id'] == published['version_id']
        page = client.get(f"/api/reports/{published['id']}/render/study/index.html")
        assert page.status_code == 200 and page.text == '<html>Published result</html>'
        source = client.post('/api/report-workspaces', json={
            'project_id': 'study', 'slug': 'draft', 'files': {'report.qmd': '# Draft\n'},
        })
        assert source.status_code == 201, source.text
        draft = source.json()
        edited = client.put('/api/report-workspaces/'+draft['id'], json={
            'expected_revision': draft['revision'], 'files': {'report.qmd': '# Updated draft\n'},
        })
        assert edited.status_code == 200, edited.text
        assert app.state.db.read_one('SELECT COUNT(*) FROM report_builds')[0] == 0
    assert app.state.db in closed


@pytest.mark.parametrize('method,path,body', [
    ('GET', '/api/report-workspaces/none/notebook', None),
    ('PUT', '/api/report-workspaces/none/cells/cell', {'source': 'print(1)', 'expected_hash': 'old'}),
    ('POST', '/api/report-workspaces/none/notebook/cells', {'type': 'code', 'source': '', 'expected_hash': 'old'}),
    ('DELETE', '/api/report-workspaces/none/cells/cell?expected_hash=old', None),
    ('POST', '/api/report-workspaces/none/cells/cell/run', {}),
    ('GET', '/api/notebook-jobs/none', None),
    ('POST', '/api/report-workspaces/none/build', {'expected_revision': 1}),
])
def test_missing_execution_dependencies_return_service_unavailable(tmp_path, monkeypatch, method, path, body):
    missing_notebook_import(monkeypatch)
    with TestClient(create_app(tmp_path/'repo', auth_enabled=False)) as client:
        response = client.request(method, path, json=body)
        assert response.status_code == 503, response.text
        assert response.json() == {'detail': UNAVAILABLE}
        assert client.app.state.db.read_one('SELECT COUNT(*) FROM report_builds')[0] == 0


def test_broken_internal_import_is_not_hidden_and_closes_owned_database(tmp_path, monkeypatch):
    missing_notebook_import(monkeypatch, 'cairn.reports.missing_internal_module')
    app = create_app(tmp_path/'repo', auth_enabled=False)
    closed = []
    original_close = Database.close
    def close(db):
        closed.append(db)
        original_close(db)
    monkeypatch.setattr(Database, 'close', close)
    with pytest.raises(ModuleNotFoundError) as error:
        with TestClient(app):
            pass
    assert error.value.name == 'cairn.reports.missing_internal_module'
    assert app.state.db in closed
