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
    payload = {"source": "# hi\n"}
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
    payloads = {
        "Prose": {"source": "Just prose.\n\nTwo paragraphs, one block.\n"},
        # prose + ```cairn fence + prose = 3 blocks.
        "Mixed": {
            "source": "Some intro prose.\n\n```cairn\nruns:\n  ids: []\ncards: []\n```\n\nMore prose after.\n",
        },
        # Any other fence stays embedded in its prose block.
        "Code": {"source": "Intro.\n\n```python\nx = 1\n```\n"},
        "Empty": {"source": "   \n"},
    }
    for name, payload in payloads.items():
        client.post(f"/api/projects/{project_id}/reports", json={"name": name, "payload": payload})

    body = client.get(f"/api/projects/{project_id}/reports").json()
    by_name = {r["name"]: r for r in body["reports"]}
    assert by_name["Prose"]["block_count"] == 1
    assert by_name["Mixed"]["block_count"] == 3
    assert by_name["Code"]["block_count"] == 1
    assert by_name["Empty"]["block_count"] == 0
    # Summary rows never leak the full payload.
    assert "payload" not in by_name["Prose"]
    assert set(by_name["Prose"].keys()) == {"id", "name", "updated_at", "block_count"}


def test_report_payload_requires_source(client):
    project_id = _make_project(client)
    r = client.post(
        f"/api/projects/{project_id}/reports",
        json={"name": "NoSource", "payload": {"blocks": []}},
    )
    assert r.status_code == 422

    report_id = client.post(
        f"/api/projects/{project_id}/reports",
        json={"name": "R", "payload": {"source": ""}},
    ).json()["id"]
    r = client.put(
        f"/api/projects/{project_id}/reports/{report_id}",
        json={"payload": {"blocks": []}},
    )
    assert r.status_code == 422


def test_list_reports_pagination_bounded(client):
    project_id = _make_project(client)
    for i in range(5):
        client.post(
            f"/api/projects/{project_id}/reports",
            json={"name": f"R{i}", "payload": {"source": ""}},
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
        json={"name": "Orig", "payload": {"source": ""}},
    ).json()
    report_id = created["id"]

    r = client.put(
        f"/api/projects/{project_id}/reports/{report_id}",
        json={"name": "Renamed"},
    )
    assert r.status_code == 200
    assert client.get(f"/api/projects/{project_id}/reports/{report_id}").json()["name"] == "Renamed"

    new_payload = {"source": "x\n"}
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
        json={"name": "ToDelete", "payload": {"source": ""}},
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
        json={"name": "A-only", "payload": {"source": ""}},
    ).json()
    report_id = created["id"]

    # Not visible from another project.
    assert client.get(f"/api/projects/{project_b}/reports/{report_id}").status_code == 404
    assert client.get(f"/api/projects/{project_b}/reports").json()["reports"] == []


def test_update_with_expected_updated_at(client):
    project_id = _make_project(client)
    rid = client.post(f"/api/projects/{project_id}/reports",
                      json={"name": "R", "payload": {"source": "a"}}).json()["id"]
    seen = client.get(f"/api/projects/{project_id}/reports/{rid}").json()["updated_at"]

    ok = client.put(f"/api/projects/{project_id}/reports/{rid}",
                    json={"payload": {"source": "b"}, "expected_updated_at": seen})
    assert ok.status_code == 200
    assert ok.json()["updated_at"] != seen

    # A second writer still holding the old timestamp is refused, and gets
    # the current report back.
    stale = client.put(f"/api/projects/{project_id}/reports/{rid}",
                       json={"payload": {"source": "c"}, "expected_updated_at": seen})
    assert stale.status_code == 409
    body = stale.json()
    assert body["payload"] == {"source": "b"}
    assert body["updated_at"] == ok.json()["updated_at"]
    assert body["name"] == "R"
    got = client.get(f"/api/projects/{project_id}/reports/{rid}").json()
    assert got["payload"] == {"source": "b"}

    # Without the field the write is unconditional.
    assert client.put(f"/api/projects/{project_id}/reports/{rid}",
                      json={"name": "R2"}).status_code == 200


def test_update_with_no_fields_keeps_updated_at(client):
    project_id = _make_project(client)
    rid = client.post(f"/api/projects/{project_id}/reports",
                      json={"name": "R", "payload": {"source": "a"}}).json()["id"]
    seen = client.get(f"/api/projects/{project_id}/reports/{rid}").json()["updated_at"]
    r = client.put(f"/api/projects/{project_id}/reports/{rid}", json={})
    assert r.json()["updated_at"] == seen


def test_delete_report_deletes_share_rows(app, client):
    project_id = _make_project(client)
    rid = client.post(f"/api/projects/{project_id}/reports",
                      json={"name": "R", "payload": {"source": ""}}).json()["id"]
    app.state.db.write(
        """INSERT INTO report_shares (id, report_id, secret_hash, created_at, expires_at)
           VALUES ('s1', ?, 'h', '2026-01-01', '2026-02-01')""",
        [rid],
    )
    assert client.delete(f"/api/projects/{project_id}/reports/{rid}").status_code == 200
    assert app.state.db.read("SELECT * FROM report_shares") == []
