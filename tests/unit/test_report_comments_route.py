"""Report comment threads: CRUD + resolve, anchors, author-or-admin edits."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from cairn.server import auth as auth_core
from cairn.server.app import create_app


def _report(client, headers=None) -> tuple[str, str]:
    h = headers or {}
    pid = client.post("/api/runs", json={"project": "p"}, headers=h).json()["project_id"]
    rid = client.post(f"/api/projects/{pid}/reports",
                      json={"name": "r", "payload": {"source": ""}}, headers=h).json()["id"]
    return pid, rid


def _base(pid, rid):
    return f"/api/projects/{pid}/reports/{rid}/comments"


def test_create_list_roundtrip(client):
    pid, rid = _report(client)
    r = client.post(_base(pid, rid), json={
        "body": "nice curve", "anchor_kind": "card", "anchor_id": "card-1",
    })
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["anchor_kind"] == "card"
    assert c["anchor_id"] == "card-1"
    assert c["quote"] is None
    assert c["parent_id"] is None
    assert c["author"] == "local"
    assert c["resolved_at"] is None
    assert c["can_edit"] is True

    listed = client.get(_base(pid, rid)).json()["comments"]
    assert [x["id"] for x in listed] == [c["id"]]


@pytest.mark.parametrize(("body", "status"), [
    ({"body": "x", "anchor_kind": "report"}, 200),
    ({"body": "x", "anchor_kind": "block", "anchor_id": "b1"}, 200),
    ({"body": "x", "anchor_kind": "quote", "anchor_id": "b1", "quote": "the text"}, 200),
    ({"body": "x", "anchor_kind": "quote", "anchor_id": "b1"}, 400),
    ({"body": "x", "anchor_kind": "block"}, 400),
    ({"body": "x", "anchor_kind": "card"}, 400),
    ({"body": "x"}, 400),
    ({"body": "x", "anchor_kind": "cell", "anchor_id": "c"}, 422),
    ({"body": "   ", "anchor_kind": "report"}, 400),
])
def test_anchor_validation(client, body, status):
    pid, rid = _report(client)
    assert client.post(_base(pid, rid), json=body).status_code == status


def test_report_anchor_drops_id_and_quote(client):
    pid, rid = _report(client)
    c = client.post(_base(pid, rid), json={
        "body": "x", "anchor_kind": "report", "anchor_id": "ignored", "quote": "ignored",
    }).json()
    assert (c["anchor_id"], c["quote"]) == (None, None)


def test_replies_inherit_anchor_and_delete_with_root(client):
    pid, rid = _report(client)
    root = client.post(_base(pid, rid), json={
        "body": "q", "anchor_kind": "quote", "anchor_id": "b2", "quote": "loss",
    }).json()
    reply = client.post(_base(pid, rid), json={"body": "a", "parent_id": root["id"]}).json()
    assert reply["parent_id"] == root["id"]
    assert (reply["anchor_kind"], reply["anchor_id"], reply["quote"]) == ("quote", "b2", "loss")
    # One level deep.
    r = client.post(_base(pid, rid), json={"body": "b", "parent_id": reply["id"]})
    assert r.status_code == 400
    assert client.post(_base(pid, rid), json={"body": "b", "parent_id": "nope"}).status_code == 404

    d = client.delete(f"{_base(pid, rid)}/{root['id']}")
    assert d.status_code == 200
    assert set(d.json()["deleted"]) == {root["id"], reply["id"]}
    assert client.get(_base(pid, rid)).json()["comments"] == []


def test_edit_and_delete(client):
    pid, rid = _report(client)
    c = client.post(_base(pid, rid), json={"body": "v1", "anchor_kind": "report"}).json()
    r = client.put(f"{_base(pid, rid)}/{c['id']}", json={"body": "v2"})
    assert r.status_code == 200
    assert r.json()["body"] == "v2"
    assert client.put(f"{_base(pid, rid)}/{c['id']}", json={"body": ""}).status_code == 400
    assert client.put(f"{_base(pid, rid)}/nope", json={"body": "x"}).status_code == 404
    assert client.delete(f"{_base(pid, rid)}/{c['id']}").status_code == 200
    assert client.delete(f"{_base(pid, rid)}/{c['id']}").status_code == 404


def test_resolve_and_reopen(client):
    pid, rid = _report(client)
    root = client.post(_base(pid, rid), json={"body": "x", "anchor_kind": "report"}).json()
    reply = client.post(_base(pid, rid), json={"body": "y", "parent_id": root["id"]}).json()

    r = client.post(f"{_base(pid, rid)}/{root['id']}/resolve", json={})
    assert r.status_code == 200
    assert r.json()["resolved_at"] is not None
    assert r.json()["resolved_by"] == "local"

    r = client.post(f"{_base(pid, rid)}/{root['id']}/resolve", json={"resolved": False})
    assert r.json()["resolved_at"] is None
    assert client.post(f"{_base(pid, rid)}/{reply['id']}/resolve", json={}).status_code == 400


def test_comments_are_scoped_to_report(client):
    pid, rid = _report(client)
    other = client.post(f"/api/projects/{pid}/reports",
                        json={"name": "o", "payload": {"source": ""}}).json()["id"]
    c = client.post(_base(pid, rid), json={"body": "x", "anchor_kind": "report"}).json()
    assert client.get(_base(pid, other)).json()["comments"] == []
    assert client.put(f"{_base(pid, other)}/{c['id']}", json={"body": "y"}).status_code == 404
    assert client.get(_base(pid, "nope")).status_code == 404


def test_delete_report_deletes_comments(app, client):
    pid, rid = _report(client)
    client.post(_base(pid, rid), json={"body": "x", "anchor_kind": "report"})
    assert client.delete(f"/api/projects/{pid}/reports/{rid}").status_code == 200
    assert app.state.db.read("SELECT * FROM comments WHERE report_id = ?", [rid]) == []


# ── With auth: roles and authorship ──────────────────────────────────────


@pytest.fixture
def auth_env(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as c:
        db = app.state.db
        tok = {}
        for name, role in (("alice", "write"), ("bob", "write"), ("root", "admin"),
                           ("viewer", "read")):
            _id, plain = auth_core.create_token(db, name=name, role=role)
            tok[name] = {"Authorization": f"Bearer {plain}"}
        # A browser token minted from alice's (as /api/auth/otp does).
        alice_id = auth_core.get_token(db, "alice")["id"]
        _id, plain = auth_core.create_token(
            db, name="alice-browser-1", role="write", parent_id=alice_id,
        )
        tok["alice_browser"] = {"Authorization": f"Bearer {plain}"}
        yield c, tok


def test_only_author_or_admin_may_edit(auth_env):
    c, tok = auth_env
    pid, rid = _report(c, tok["alice"])
    base = _base(pid, rid)
    com = c.post(base, json={"body": "mine", "anchor_kind": "report"}, headers=tok["alice"]).json()
    assert com["author"] == "alice"

    assert c.put(f"{base}/{com['id']}", json={"body": "x"}, headers=tok["bob"]).status_code == 403
    assert c.delete(f"{base}/{com['id']}", headers=tok["bob"]).status_code == 403
    # Alice's other browser is still alice.
    assert c.put(f"{base}/{com['id']}", json={"body": "v2"},
                 headers=tok["alice_browser"]).status_code == 200
    assert c.put(f"{base}/{com['id']}", json={"body": "v3"},
                 headers=tok["root"]).status_code == 200

    # can_edit is computed for the caller.
    by_bob = c.get(base, headers=tok["bob"]).json()["comments"][0]
    by_alice = c.get(base, headers=tok["alice_browser"]).json()["comments"][0]
    assert (by_bob["can_edit"], by_alice["can_edit"]) == (False, True)

    # Any writer may resolve.
    assert c.post(f"{base}/{com['id']}/resolve", json={}, headers=tok["bob"]).status_code == 200
    assert c.delete(f"{base}/{com['id']}", headers=tok["root"]).status_code == 200


def test_readers_read_but_cannot_comment(auth_env):
    c, tok = auth_env
    pid, rid = _report(c, tok["alice"])
    base = _base(pid, rid)
    c.post(base, json={"body": "x", "anchor_kind": "report"}, headers=tok["alice"])
    assert c.get(base).status_code == 401
    assert len(c.get(base, headers=tok["viewer"]).json()["comments"]) == 1
    assert c.post(base, json={"body": "y", "anchor_kind": "report"},
                  headers=tok["viewer"]).status_code == 403
