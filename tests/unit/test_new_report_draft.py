"""The no-prompt starter opens an editable cell without published placeholder prose."""
from fastapi.testclient import TestClient
from cairn.server.app import create_app

def test_automatic_starter_can_be_written_immediately(tmp_path):
    source = "---\ntitle: NewReport\n---\n\n<!-- cairn:empty-report -->\n"
    with TestClient(create_app(tmp_path / 'repo', auth_enabled=False, background_tasks=False)) as client:
        created = client.post('/api/report-workspaces', json={
            'project_id': 'research', 'slug': 'new-report-unique',
            'files': {'report.qmd': source},
        })
        assert created.status_code == 201, created.text
        base = '/api/report-workspaces/' + created.json()['id']
        notebook = client.get(base + '/notebook').json()
        prose = next(cell for cell in notebook['cells'] if cell['type'] == 'markdown')
        assert prose['source'].strip() == '<!-- cairn:empty-report -->'
        updated = client.put(base + '/cells/' + prose['id'], json={
            'source': 'My first sentence.', 'expected_hash': prose['hash'],
        })
        assert updated.status_code == 200, updated.text
        assert any(cell['source'] == 'My first sentence.\n' for cell in updated.json()['cells'])
