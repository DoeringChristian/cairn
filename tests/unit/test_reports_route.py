"""Route-layer tests for /api/projects/{project_id}/reports CRUD.

Mirrors the comparisons route's shape (list/get/create/update/delete) with
the two deliberate improvements this route makes over comparisons: a
paginated list endpoint and a 404 on DELETE for a missing report.
"""

from __future__ import annotations


def _make_project(client) -> str:
    return client.post("/api/runs", json={"project": "p"}).json()["project_id"]


def test_create_and_get_report(client):
    project_id = _make_project(client)
    payload = {"blocks": [{"id": "b1", "type": "markdown", "text": "# hi"}]}
    created = client.post(
        f"/api/projects/{project_id}/reports",
        json={"name": "My Report", "payload": payload},
    ).json()
    assert created["name"] == "My Report"
    report_id = created["id"]

    got = client.get(f"/api/projects/{project_id}/reports/{report_id}").json()
    assert got["id"] == report_id
    assert got["project_id"] == project_id
    assert got["name"] == "My Report"
    assert got["payload"] == payload


def test_get_report_404(client):
    project_id = _make_project(client)
    r = client.get(f"/api/projects/{project_id}/reports/does-not-exist")
    assert r.status_code == 404


def test_list_reports_summary_and_block_count(client):
    project_id = _make_project(client)
    payload_a = {"blocks": [{"id": "b1", "type": "markdown", "text": "a"}]}
    payload_b = {
        "blocks": [
            {"id": "b1", "type": "markdown", "text": "a"},
            {"id": "b2", "type": "cards", "runIds": [], "cards": []},
        ]
    }
    client.post(f"/api/projects/{project_id}/reports", json={"name": "A", "payload": payload_a})
    client.post(f"/api/projects/{project_id}/reports", json={"name": "B", "payload": payload_b})

    body = client.get(f"/api/projects/{project_id}/reports").json()
    by_name = {r["name"]: r for r in body["reports"]}
    assert by_name["A"]["block_count"] == 1
    assert by_name["B"]["block_count"] == 2
    # Summary rows never leak the full payload.
    assert "payload" not in by_name["A"]
    assert set(by_name["A"].keys()) == {"id", "name", "updated_at", "block_count"}


def test_list_reports_block_count_source_only(client):
    # B11: an SDK/`cairn.Report`-created report ships `{source}` with no
    # `blocks[]` cache (AR1 §6) — block_count must not misreport "0 blocks".
    project_id = _make_project(client)
    source_payload = {
        "source": "Some intro prose.\n\n```cairn\nruns:\n  ids: []\ncards: []\n```\n\nMore prose after.\n",
    }
    empty_source_payload = {"source": "   \n"}
    client.post(f"/api/projects/{project_id}/reports", json={"name": "S", "payload": source_payload})
    client.post(f"/api/projects/{project_id}/reports", json={"name": "Empty", "payload": empty_source_payload})

    body = client.get(f"/api/projects/{project_id}/reports").json()
    by_name = {r["name"]: r for r in body["reports"]}
    # prose + ```cairn fence + prose = 3 segments.
    assert by_name["S"]["block_count"] == 3
    assert by_name["Empty"]["block_count"] == 0


def test_list_reports_pagination_bounded(client):
    project_id = _make_project(client)
    for i in range(5):
        client.post(
            f"/api/projects/{project_id}/reports",
            json={"name": f"R{i}", "payload": {"blocks": []}},
        )

    page1 = client.get(f"/api/projects/{project_id}/reports?limit=2&offset=0").json()
    assert page1["limit"] == 2
    assert page1["offset"] == 0
    assert page1["total"] == 5
    assert len(page1["reports"]) == 2

    page2 = client.get(f"/api/projects/{project_id}/reports?limit=2&offset=2").json()
    assert len(page2["reports"]) == 2

    page3 = client.get(f"/api/projects/{project_id}/reports?limit=2&offset=4").json()
    assert len(page3["reports"]) == 1

    ids_seen = {r["id"] for r in page1["reports"] + page2["reports"] + page3["reports"]}
    assert len(ids_seen) == 5

    # Bounds enforced like runs.py.
    assert client.get(f"/api/projects/{project_id}/reports?limit=0").status_code == 422
    assert client.get(f"/api/projects/{project_id}/reports?limit=1001").status_code == 422
    assert client.get(f"/api/projects/{project_id}/reports?offset=-1").status_code == 422


def test_update_report_name_and_payload(client):
    project_id = _make_project(client)
    created = client.post(
        f"/api/projects/{project_id}/reports",
        json={"name": "Orig", "payload": {"blocks": []}},
    ).json()
    report_id = created["id"]

    r = client.put(
        f"/api/projects/{project_id}/reports/{report_id}",
        json={"name": "Renamed"},
    )
    assert r.status_code == 200
    assert client.get(f"/api/projects/{project_id}/reports/{report_id}").json()["name"] == "Renamed"

    new_payload = {"blocks": [{"id": "b1", "type": "markdown", "text": "x"}]}
    r = client.put(
        f"/api/projects/{project_id}/reports/{report_id}",
        json={"payload": new_payload},
    )
    assert r.status_code == 200
    got = client.get(f"/api/projects/{project_id}/reports/{report_id}").json()
    assert got["name"] == "Renamed"
    assert got["payload"] == new_payload


def test_update_report_404(client):
    project_id = _make_project(client)
    r = client.put(
        f"/api/projects/{project_id}/reports/does-not-exist",
        json={"name": "x"},
    )
    assert r.status_code == 404


def test_delete_report(client):
    project_id = _make_project(client)
    created = client.post(
        f"/api/projects/{project_id}/reports",
        json={"name": "ToDelete", "payload": {"blocks": []}},
    ).json()
    report_id = created["id"]

    r = client.delete(f"/api/projects/{project_id}/reports/{report_id}")
    assert r.status_code == 200
    assert r.json() == {"deleted": report_id}

    assert client.get(f"/api/projects/{project_id}/reports/{report_id}").status_code == 404


def test_delete_report_404(client):
    """Deliberate improvement over comparisons' DELETE, which never 404s."""
    project_id = _make_project(client)
    r = client.delete(f"/api/projects/{project_id}/reports/does-not-exist")
    assert r.status_code == 404


def test_reports_scoped_to_project(client):
    project_a = _make_project(client)
    project_b = client.post("/api/runs", json={"project": "other"}).json()["project_id"]

    created = client.post(
        f"/api/projects/{project_a}/reports",
        json={"name": "A-only", "payload": {"blocks": []}},
    ).json()
    report_id = created["id"]

    # Not visible from another project.
    assert client.get(f"/api/projects/{project_b}/reports/{report_id}").status_code == 404
    assert client.get(f"/api/projects/{project_b}/reports").json()["reports"] == []
