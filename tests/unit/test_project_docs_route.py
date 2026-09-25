"""Route-layer tests for /api/projects/{project_id}/workspace and /views.

The workspace is one revisioned document per project; views are a CRUD
collection of the same shape. A write against a stale ``base_rev`` gets 409
carrying the server's document.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from cairn.server import auth as auth_core
from cairn.server.app import create_app


def _make_project(client) -> str:
    return client.post("/api/runs", json={"project": "p"}).json()["project_id"]


def test_workspace_starts_empty(client):
    pid = _make_project(client)
    r = client.get(f"/api/projects/{pid}/workspace")
    assert r.status_code == 200
    assert r.json() == {"rev": 0, "updated_at": None, "payload": None}


def test_workspace_put_roundtrip_bumps_rev(client):
    pid = _make_project(client)
    r = client.put(f"/api/projects/{pid}/workspace",
                   json={"base_rev": 0, "payload": {"sections": [1]}})
    assert r.status_code == 200
    assert r.json()["rev"] == 1

    r = client.put(f"/api/projects/{pid}/workspace",
                   json={"base_rev": 1, "payload": {"sections": [1, 2]}})
    assert r.status_code == 200
    assert r.json()["rev"] == 2

    got = client.get(f"/api/projects/{pid}/workspace").json()
    assert got["rev"] == 2
    assert got["payload"] == {"sections": [1, 2]}
    assert got["updated_at"] == r.json()["updated_at"]


def test_workspace_stale_rev_409_carries_server_doc(client):
    pid = _make_project(client)
    client.put(f"/api/projects/{pid}/workspace", json={"base_rev": 0, "payload": {"a": 1}})
    client.put(f"/api/projects/{pid}/workspace", json={"base_rev": 1, "payload": {"a": 2}})

    r = client.put(f"/api/projects/{pid}/workspace", json={"base_rev": 1, "payload": {"a": 99}})
    assert r.status_code == 409
    body = r.json()
    assert body["rev"] == 2
    assert body["payload"] == {"a": 2}
    # Nothing was written.
    assert client.get(f"/api/projects/{pid}/workspace").json()["payload"] == {"a": 2}


def test_workspace_first_put_must_be_base_rev_zero(client):
    pid = _make_project(client)
    r = client.put(f"/api/projects/{pid}/workspace", json={"base_rev": 3, "payload": {}})
    assert r.status_code == 409
    assert r.json()["rev"] == 0
    assert r.json()["payload"] is None


def test_workspace_is_per_project(client):
    a = client.post("/api/runs", json={"project": "a"}).json()["project_id"]
    b = client.post("/api/runs", json={"project": "b"}).json()["project_id"]
    client.put(f"/api/projects/{a}/workspace", json={"base_rev": 0, "payload": {"x": "a"}})
    assert client.get(f"/api/projects/{b}/workspace").json()["rev"] == 0


def test_unknown_project_404(client):
    assert client.get("/api/projects/nope/workspace").status_code == 404
    assert client.put("/api/projects/nope/workspace",
                      json={"base_rev": 0, "payload": {}}).status_code == 404
    assert client.get("/api/projects/nope/views").status_code == 404
    assert client.post("/api/projects/nope/views",
                       json={"name": "v", "payload": {}}).status_code == 404


def test_views_crud(client):
    pid = _make_project(client)
    created = client.post(f"/api/projects/{pid}/views",
                          json={"name": "Best runs", "payload": {"filter": "acc > 0.9"}})
    assert created.status_code == 200
    vid = created.json()["id"]
    assert created.json()["rev"] == 1

    listed = client.get(f"/api/projects/{pid}/views").json()["views"]
    assert [v["id"] for v in listed] == [vid]
    assert listed[0]["name"] == "Best runs"
    assert "payload" not in listed[0]

    got = client.get(f"/api/projects/{pid}/views/{vid}").json()
    assert got["payload"] == {"filter": "acc > 0.9"}
    assert got["rev"] == 1

    r = client.put(f"/api/projects/{pid}/views/{vid}", json={"name": "Renamed"})
    assert r.status_code == 200
    assert r.json()["rev"] == 2
    got = client.get(f"/api/projects/{pid}/views/{vid}").json()
    assert got["name"] == "Renamed"
    assert got["payload"] == {"filter": "acc > 0.9"}

    r = client.put(f"/api/projects/{pid}/views/{vid}",
                   json={"payload": {"filter": "x"}, "base_rev": 2})
    assert r.status_code == 200
    assert client.get(f"/api/projects/{pid}/views/{vid}").json()["payload"] == {"filter": "x"}

    assert client.delete(f"/api/projects/{pid}/views/{vid}").status_code == 200
    assert client.get(f"/api/projects/{pid}/views/{vid}").status_code == 404
    assert client.delete(f"/api/projects/{pid}/views/{vid}").status_code == 404


def test_view_stale_rev_409(client):
    pid = _make_project(client)
    vid = client.post(f"/api/projects/{pid}/views",
                      json={"name": "v", "payload": {"n": 1}}).json()["id"]
    client.put(f"/api/projects/{pid}/views/{vid}", json={"payload": {"n": 2}})
    r = client.put(f"/api/projects/{pid}/views/{vid}",
                   json={"payload": {"n": 3}, "base_rev": 1})
    assert r.status_code == 409
    assert r.json()["rev"] == 2
    assert r.json()["payload"] == {"n": 2}


def test_view_missing_404(client):
    pid = _make_project(client)
    assert client.get(f"/api/projects/{pid}/views/nope").status_code == 404
    assert client.put(f"/api/projects/{pid}/views/nope", json={"name": "x"}).status_code == 404


def test_workspace_is_not_a_view(client):
    pid = _make_project(client)
    client.put(f"/api/projects/{pid}/workspace", json={"base_rev": 0, "payload": {}})
    assert client.get(f"/api/projects/{pid}/views").json()["views"] == []


@pytest.fixture
def auth_env(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as c:
        tokens = {}
        for role in ("write", "read"):
            _id, plain = auth_core.create_token(app.state.db, name=f"{role}-t", role=role)
            tokens[role] = {"Authorization": f"Bearer {plain}"}
        yield c, tokens


def test_reads_need_read_and_writes_need_write(auth_env):
    c, tokens = auth_env
    pid = c.post("/api/runs", json={"project": "p"}, headers=tokens["write"]).json()["project_id"]
    assert c.get(f"/api/projects/{pid}/workspace").status_code == 401
    assert c.get(f"/api/projects/{pid}/workspace", headers=tokens["read"]).status_code == 200
    assert c.get(f"/api/projects/{pid}/views", headers=tokens["read"]).status_code == 200

    body = {"base_rev": 0, "payload": {}}
    assert c.put(f"/api/projects/{pid}/workspace", json=body,
                 headers=tokens["read"]).status_code == 403
    assert c.post(f"/api/projects/{pid}/views", json={"name": "v", "payload": {}},
                  headers=tokens["read"]).status_code == 403
    assert c.put(f"/api/projects/{pid}/workspace", json=body,
                 headers=tokens["write"]).status_code == 200
