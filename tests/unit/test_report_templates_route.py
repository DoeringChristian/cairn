"""Route-layer tests for /api/projects/{project_id}/report-templates.

Mirrors test_comparison_templates_route.py — same CRUD shape, same
deliberate DELETE-404 fix over comparisons.py.
"""

from __future__ import annotations


def _make_project(client) -> str:
    return client.post("/api/runs", json={"project": "p"}).json()["project_id"]


def test_create_list_get_roundtrip(client):
    project_id = _make_project(client)
    payload = {"cards": [{"type": "scalar", "metricName": "loss", "settings": {"version": 1}}]}

    created = client.post(
        f"/api/projects/{project_id}/report-templates",
        json={"name": "My report template", "payload": payload},
    )
    assert created.status_code == 200
    tid = created.json()["id"]

    listed = client.get(f"/api/projects/{project_id}/report-templates")
    assert listed.status_code == 200
    entries = listed.json()["report_templates"]
    assert len(entries) == 1
    assert entries[0]["id"] == tid
    assert entries[0]["name"] == "My report template"
    assert entries[0]["card_count"] == 1

    got = client.get(f"/api/projects/{project_id}/report-templates/{tid}")
    assert got.status_code == 200
    body = got.json()
    assert body["name"] == "My report template"
    assert body["payload"] == payload


def test_get_missing_returns_404(client):
    project_id = _make_project(client)
    r = client.get(f"/api/projects/{project_id}/report-templates/doesnotexist")
    assert r.status_code == 404


def test_update_name_and_payload(client):
    project_id = _make_project(client)
    tid = client.post(
        f"/api/projects/{project_id}/report-templates",
        json={"name": "Original", "payload": {"cards": []}},
    ).json()["id"]

    r = client.put(
        f"/api/projects/{project_id}/report-templates/{tid}",
        json={"name": "Renamed"},
    )
    assert r.status_code == 200

    got = client.get(f"/api/projects/{project_id}/report-templates/{tid}").json()
    assert got["name"] == "Renamed"
    assert got["payload"] == {"cards": []}

    new_payload = {"cards": [{"type": "parallel", "metricName": "parallel"}]}
    r = client.put(
        f"/api/projects/{project_id}/report-templates/{tid}",
        json={"payload": new_payload},
    )
    assert r.status_code == 200
    got = client.get(f"/api/projects/{project_id}/report-templates/{tid}").json()
    assert got["payload"] == new_payload


def test_update_missing_returns_404(client):
    project_id = _make_project(client)
    r = client.put(
        f"/api/projects/{project_id}/report-templates/doesnotexist",
        json={"name": "x"},
    )
    assert r.status_code == 404


def test_delete_roundtrip(client):
    project_id = _make_project(client)
    tid = client.post(
        f"/api/projects/{project_id}/report-templates",
        json={"name": "To delete", "payload": {"cards": []}},
    ).json()["id"]

    r = client.delete(f"/api/projects/{project_id}/report-templates/{tid}")
    assert r.status_code == 200
    assert r.json()["deleted"] == tid

    assert client.get(f"/api/projects/{project_id}/report-templates/{tid}").status_code == 404


def test_delete_missing_returns_404(client):
    project_id = _make_project(client)
    r = client.delete(f"/api/projects/{project_id}/report-templates/doesnotexist")
    assert r.status_code == 404


def test_templates_scoped_to_project(client):
    project_a = _make_project(client)
    project_b = client.post("/api/runs", json={"project": "q"}).json()["project_id"]

    client.post(
        f"/api/projects/{project_a}/report-templates",
        json={"name": "A's template", "payload": {"cards": []}},
    )

    b_list = client.get(f"/api/projects/{project_b}/report-templates").json()["report_templates"]
    assert b_list == []
