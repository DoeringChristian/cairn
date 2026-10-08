"""Route-layer tests for a project's workspace views and comparisons.

Views are revisioned layout documents, oldest first; one is the project's
current view (the run page's). A project always has one: until a view is
stored, the list holds a virtual "Default" at rev 0. A write against a stale
``base_rev`` gets 409 carrying the server's document.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from cairn.server import auth as auth_core
from cairn.server.app import create_app
from cairn.server.routes.project_docs import default_view_id


def _make_project(client) -> str:
    return client.post("/api/runs", json={"project": "p"}).json()["project_id"]


def _views(client, pid):
    return client.get(f"/api/projects/{pid}/views").json()


def _new_view(client, pid, name, payload=None):
    r = client.post(f"/api/projects/{pid}/views", json={"name": name, "payload": payload or {}})
    assert r.status_code == 200
    return r.json()["id"]


# ── First access ───────────────────────────────────────────────────────────


def test_first_access_lists_a_virtual_default(client):
    pid = _make_project(client)
    body = _views(client, pid)
    did = default_view_id(pid)
    assert body["current"] == did
    assert [(v["id"], v["name"], v["rev"], v["payload"]) for v in body["views"]] == [
        (did, "Default", 0, None),
    ]
    assert client.get(f"/api/projects/{pid}/views/{did}").json()["rev"] == 0
    assert client.get(f"/api/projects/{pid}/current-view").json() == {"view_id": did}


def test_first_write_stores_the_default(client):
    pid = _make_project(client)
    did = default_view_id(pid)
    assert client.put(f"/api/projects/{pid}/views/{did}",
                      json={"base_rev": 3, "payload": {}}).status_code == 409
    r = client.put(f"/api/projects/{pid}/views/{did}", json={"base_rev": 0, "payload": {"a": 1}})
    assert r.status_code == 200 and r.json()["rev"] == 1
    [v] = _views(client, pid)["views"]
    assert (v["id"], v["name"], v["rev"], v["payload"]) == (did, "Default", 1, {"a": 1})


def test_creating_a_view_stores_the_default_first(client):
    pid = _make_project(client)
    vid = _new_view(client, pid, "Media", {"autoPanels": False})
    body = _views(client, pid)
    assert [(v["id"], v["name"]) for v in body["views"]] == [(default_view_id(pid), "Default"), (vid, "Media")]
    assert body["views"][0]["payload"] == {} and body["views"][0]["rev"] == 1
    assert body["current"] == default_view_id(pid)


def test_migrated_workspace_is_the_default_view(tmp_path):
    """An existing project workspace (and its saved views) come up as views."""
    import sqlite3

    from cairn.server.storage.migrations import apply_migrations

    app = create_app(data_dir=tmp_path / "cairn", mount_ui=False)
    with TestClient(app) as c:
        pid = _make_project(c)
    db_path = tmp_path / "cairn" / "cairn.db"
    con = sqlite3.connect(db_path)
    # Rewind the table to its old shape: one workspace, one saved view.
    con.execute("DROP TABLE project_docs")
    con.execute("DROP TABLE project_view_state")
    con.execute(
        """CREATE TABLE project_docs (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
            kind TEXT NOT NULL CHECK(kind IN ('workspace','comparison','view')),
            name TEXT NOT NULL DEFAULT '', rev INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)"""
    )
    con.execute("INSERT INTO project_docs VALUES ('w', ?, 'workspace', '', 5, '2025-02', '2025-02', '{\"x\": 1}')", [pid])
    con.execute("INSERT INTO project_docs VALUES ('s', ?, 'view', 'Saved', 2, '2025-03', '2025-03', '{\"layout\": {\"y\": 2}}')", [pid])
    apply_migrations(con)
    con.close()

    app = create_app(data_dir=tmp_path / "cairn", mount_ui=False)
    with TestClient(app) as c:
        body = _views(c, pid)
        assert body["current"] == "w"
        assert [(v["id"], v["name"], v["rev"], v["payload"]) for v in body["views"]] == [
            ("w", "Default", 5, {"x": 1}),
            ("s", "Saved", 2, {"y": 2}),
        ]
        r = c.put(f"/api/projects/{pid}/views/w", json={"base_rev": 5, "payload": {"x": 2}})
        assert r.status_code == 200 and r.json()["rev"] == 6


# ── CRUD + revs ────────────────────────────────────────────────────────────


def test_views_crud_in_creation_order(client):
    pid = _make_project(client)
    a = _new_view(client, pid, "A", {"n": 1})
    b = _new_view(client, pid, "B", {"n": 2})
    names = [v["name"] for v in _views(client, pid)["views"]]
    assert names == ["Default", "A", "B"]

    got = client.get(f"/api/projects/{pid}/views/{a}").json()
    assert (got["name"], got["rev"], got["payload"]) == ("A", 1, {"n": 1})

    r = client.patch(f"/api/projects/{pid}/views/{a}", json={"name": "Renamed"})
    assert r.status_code == 200
    got = client.get(f"/api/projects/{pid}/views/{a}").json()
    assert (got["name"], got["rev"]) == ("Renamed", 1)  # renaming leaves the rev alone

    r = client.put(f"/api/projects/{pid}/views/{a}", json={"base_rev": 1, "payload": {"n": 10}})
    assert r.status_code == 200 and r.json()["rev"] == 2
    assert client.get(f"/api/projects/{pid}/views/{a}").json()["payload"] == {"n": 10}
    # Writing one view leaves the others alone.
    assert client.get(f"/api/projects/{pid}/views/{b}").json()["payload"] == {"n": 2}

    assert client.delete(f"/api/projects/{pid}/views/{b}").json() == {"deleted": b}
    assert client.get(f"/api/projects/{pid}/views/{b}").status_code == 404
    assert client.delete(f"/api/projects/{pid}/views/{b}").status_code == 404


def test_view_stale_rev_409_carries_server_doc(client):
    pid = _make_project(client)
    vid = _new_view(client, pid, "v", {"a": 1})
    client.put(f"/api/projects/{pid}/views/{vid}", json={"base_rev": 1, "payload": {"a": 2}})
    r = client.put(f"/api/projects/{pid}/views/{vid}", json={"base_rev": 1, "payload": {"a": 99}})
    assert r.status_code == 409
    assert r.json()["rev"] == 2 and r.json()["payload"] == {"a": 2}
    assert client.get(f"/api/projects/{pid}/views/{vid}").json()["payload"] == {"a": 2}


def test_view_missing_404(client):
    pid = _make_project(client)
    assert client.get(f"/api/projects/{pid}/views/nope").status_code == 404
    assert client.put(f"/api/projects/{pid}/views/nope", json={"base_rev": 0, "payload": {}}).status_code == 404
    assert client.patch(f"/api/projects/{pid}/views/nope", json={"name": "x"}).status_code == 404
    assert client.put(f"/api/projects/{pid}/current-view", json={"view_id": "nope"}).status_code == 404


def test_unknown_project_404(client):
    assert client.get("/api/projects/nope/views").status_code == 404
    assert client.post("/api/projects/nope/views", json={"name": "v", "payload": {}}).status_code == 404
    assert client.get("/api/projects/nope/current-view").status_code == 404


def test_views_are_per_project(client):
    a = client.post("/api/runs", json={"project": "a"}).json()["project_id"]
    b = client.post("/api/runs", json={"project": "b"}).json()["project_id"]
    _new_view(client, a, "only in a")
    assert [v["name"] for v in _views(client, b)["views"]] == ["Default"]
    assert default_view_id(a) != default_view_id(b)


# ── Current view, last view ────────────────────────────────────────────────


def test_current_view_get_and_set(client):
    pid = _make_project(client)
    vid = _new_view(client, pid, "Media")
    r = client.put(f"/api/projects/{pid}/current-view", json={"view_id": vid})
    assert r.status_code == 200 and r.json() == {"view_id": vid}
    assert client.get(f"/api/projects/{pid}/current-view").json() == {"view_id": vid}
    assert _views(client, pid)["current"] == vid


def test_last_view_cannot_be_deleted(client):
    pid = _make_project(client)
    did = default_view_id(pid)
    assert client.delete(f"/api/projects/{pid}/views/{did}").status_code == 409  # virtual
    vid = _new_view(client, pid, "Other")
    assert client.delete(f"/api/projects/{pid}/views/{did}").status_code == 200
    r = client.delete(f"/api/projects/{pid}/views/{vid}")
    assert r.status_code == 409
    assert [v["id"] for v in _views(client, pid)["views"]] == [vid]


def test_deleting_the_current_view_makes_the_first_remaining_current(client):
    pid = _make_project(client)
    a = _new_view(client, pid, "A")
    b = _new_view(client, pid, "B")
    client.put(f"/api/projects/{pid}/current-view", json={"view_id": b})
    client.delete(f"/api/projects/{pid}/views/{b}")
    assert _views(client, pid)["current"] == default_view_id(pid)
    client.put(f"/api/projects/{pid}/current-view", json={"view_id": a})
    client.delete(f"/api/projects/{pid}/views/{default_view_id(pid)}")  # not current: stays a
    assert _views(client, pid)["current"] == a


# ── Auth ───────────────────────────────────────────────────────────────────


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
    did = default_view_id(pid)
    assert c.get(f"/api/projects/{pid}/views").status_code == 401
    assert c.get(f"/api/projects/{pid}/views", headers=tokens["read"]).status_code == 200
    assert c.get(f"/api/projects/{pid}/current-view", headers=tokens["read"]).status_code == 200

    body = {"base_rev": 0, "payload": {}}
    assert c.put(f"/api/projects/{pid}/views/{did}", json=body, headers=tokens["read"]).status_code == 403
    assert c.post(f"/api/projects/{pid}/views", json={"name": "v", "payload": {}},
                  headers=tokens["read"]).status_code == 403
    assert c.put(f"/api/projects/{pid}/current-view", json={"view_id": did},
                 headers=tokens["read"]).status_code == 403
    assert c.put(f"/api/projects/{pid}/views/{did}", json=body, headers=tokens["write"]).status_code == 200


def test_project_workspace_endpoint_is_gone(client):
    pid = _make_project(client)
    assert client.get(f"/api/projects/{pid}/workspace").status_code == 404


# ── Comparisons ────────────────────────────────────────────────────────────



def test_comparison_crud_and_rev(client):
    pid = _make_project(client)
    payload = {"selection": {"entries": [
        {"kind": "run", "id": "r1"},
        {"kind": "group", "group": "exp-1", "latest": True},
        {"kind": "group", "group": "exp-2", "latest": False, "runs": ["r2", "r3"]},
    ]}, "view": None}
    r = client.post(f"/api/projects/{pid}/comparisons", json={"name": "c", "payload": payload})
    assert r.status_code == 200
    cid = r.json()["id"]
    assert r.json()["rev"] == 1

    listed = client.get(f"/api/projects/{pid}/comparisons").json()["comparisons"]
    assert [(c["id"], c["name"], c["entry_count"], c["rev"]) for c in listed] == [(cid, "c", 3, 1)]
    assert "run_count" not in listed[0]

    got = client.get(f"/api/projects/{pid}/comparisons/{cid}").json()
    assert got["rev"] == 1 and got["payload"] == payload

    r = client.put(f"/api/projects/{pid}/comparisons/{cid}",
                   json={"base_rev": 1, "payload": {"selection": {"entries": []}, "view": None}})
    assert r.status_code == 200 and r.json()["rev"] == 2
    listed = client.get(f"/api/projects/{pid}/comparisons").json()["comparisons"]
    assert listed[0]["entry_count"] == 0

    r = client.patch(f"/api/projects/{pid}/comparisons/{cid}", json={"name": "renamed"})
    assert r.status_code == 200
    got = client.get(f"/api/projects/{pid}/comparisons/{cid}").json()
    assert got["name"] == "renamed" and got["rev"] == 2

    assert client.delete(f"/api/projects/{pid}/comparisons/{cid}").json() == {"deleted": cid}
    assert client.get(f"/api/projects/{pid}/comparisons/{cid}").status_code == 404
    assert client.delete(f"/api/projects/{pid}/comparisons/{cid}").status_code == 404


def test_comparison_stale_rev_409_carries_server_doc(client):
    pid = _make_project(client)
    cid = client.post(f"/api/projects/{pid}/comparisons", json={"name": "c", "payload": {"a": 1}}).json()["id"]
    client.put(f"/api/projects/{pid}/comparisons/{cid}", json={"base_rev": 1, "payload": {"a": 2}})
    r = client.put(f"/api/projects/{pid}/comparisons/{cid}", json={"base_rev": 1, "payload": {"a": 3}})
    assert r.status_code == 409
    assert r.json()["rev"] == 2 and r.json()["payload"] == {"a": 2}


def test_comparisons_are_not_views(client):
    pid = _make_project(client)
    client.post(f"/api/projects/{pid}/comparisons", json={"name": "c", "payload": {}})
    assert [v["rev"] for v in client.get(f"/api/projects/{pid}/views").json()["views"]] == [0]
    assert client.put(f"/api/projects/{pid}/comparisons/nope", json={"base_rev": 1, "payload": {}}).status_code == 404
