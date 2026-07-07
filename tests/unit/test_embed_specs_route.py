"""Route-layer tests for the WS-EMBED spec store (/api/embed/specs).

POST stores a card spec and returns a short content-hash `sid`; GET fetches
it back. The store is in-memory and TTL'd (see cairn/server/embed_specs.py);
these tests cover the POST+GET round-trip, idempotency, the 404 for an
unknown sid, and (auth ON) the read-role gating that rejects unauthenticated
callers.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from cairn.server.app import create_app


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


@pytest.fixture
def auth_client(tmp_path):
    """An auth-ENABLED app + TestClient (mirrors test_auth.py's auth_env)."""
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as c:
        yield c


def test_embed_routes_reject_unauthenticated_when_auth_enabled(auth_client):
    # embed.router is registered in app.py's require("read") loop, so with
    # auth ON an unauthenticated caller (no cookie / no Bearer) must be
    # rejected on BOTH the POST and the GET. (--no-auth mode, exercised by
    # the `client` fixture above, is unaffected.)
    spec = {"type": "scalar", "series": [{"runId": "r1", "name": "loss", "context_hash": ""}]}
    assert auth_client.post("/api/embed/specs", json={"spec": spec}).status_code == 401
    assert auth_client.get("/api/embed/specs/deadbeefdeadbeef").status_code == 401
