"""Route-layer tests for the WS-EMBED spec store (/api/embed/specs).

POST stores a card spec and returns a short content-hash `sid`; GET fetches
it back. The store is in-memory and TTL'd (see cairn/server/embed_specs.py);
these tests cover the POST+GET round-trip, idempotency, and the 404 for an
unknown sid.
"""

from __future__ import annotations


def test_post_get_roundtrip(client):
    spec = {
        "type": "scalar",
        "series": [{"runId": "run-abc", "name": "loss", "context_hash": ""}],
    }
    created = client.post("/api/embed/specs", json={"spec": spec})
    assert created.status_code == 200
    sid = created.json()["sid"]
    assert isinstance(sid, str) and sid

    got = client.get(f"/api/embed/specs/{sid}")
    assert got.status_code == 200
    body = got.json()
    assert body["sid"] == sid
    assert body["spec"] == spec


def test_post_is_content_hash_idempotent(client):
    spec = {"type": "image", "series": [{"runId": "r1", "name": "img", "context_hash": ""}]}
    sid1 = client.post("/api/embed/specs", json={"spec": spec}).json()["sid"]
    sid2 = client.post("/api/embed/specs", json={"spec": spec}).json()["sid"]
    assert sid1 == sid2


def test_get_unknown_sid_returns_404(client):
    r = client.get("/api/embed/specs/deadbeefdeadbeef")
    assert r.status_code == 404
