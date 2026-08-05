"""Integration tests for ``GET /api/query`` (live query URLs).

Seeds runs/artifacts through the public ingest API, then exercises the query
endpoint end-to-end: 302 → artifact bytes, the ``format=json`` envelope,
freshness headers (``no-store`` on query, ``immutable`` on the digest), and the
read-role auth gate when auth is enabled.
"""

from __future__ import annotations

import hashlib
import io

import pytest
from fastapi.testclient import TestClient

from cairn.server.app import create_app


def _upload(client, payload: bytes, mime="image/png") -> str:
    client.post(
        "/api/artifacts",
        files={"file": ("x.png", io.BytesIO(payload), mime)},
        data={"mime_type": mime},
    )
    return hashlib.sha256(payload).hexdigest()


def _make_run(client, project, name, payload, tag="render"):
    rid = client.post("/api/runs", json={"project": project, "name": name}).json()["run_id"]
    digest = _upload(client, payload)
    client.post(f"/api/runs/{rid}/artifacts", json={"name": tag, "hash": digest})
    return rid, digest


def test_query_redirects_to_digest_bytes(client):
    payload = b"latest-render-bytes"
    _make_run(client, "demo", "exp-a", payload)

    # Default: follow the redirect and land on the artifact bytes.
    r = client.get("/api/query", params={"tag": "render", "project": "demo"})
    assert r.status_code == 200
    assert r.content == payload

    # Without following: a 302 pointing at /api/artifacts/<digest>.
    r2 = client.get(
        "/api/query", params={"tag": "render", "project": "demo"},
        follow_redirects=False,
    )
    assert r2.status_code == 302
    assert r2.headers["location"] == f"/api/artifacts/{hashlib.sha256(payload).hexdigest()}"
    assert r2.headers["cache-control"] == "no-store"


def test_query_picks_latest_run(client):
    _make_run(client, "demo", "exp-a", b"older")
    _, newest = _make_run(client, "demo", "exp-b", b"newer")
    r = client.get(
        "/api/query", params={"tag": "render", "project": "demo"},
        follow_redirects=False,
    )
    assert r.headers["location"] == f"/api/artifacts/{newest}"


def test_query_format_json_envelope(client):
    payload = b"json-envelope-bytes"
    rid, digest = _make_run(client, "demo", "exp-a", payload)
    r = client.get(
        "/api/query", params={"tag": "render", "project": "demo", "format": "json"}
    )
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["run_id"] == rid
    assert body["digest"] == digest
    assert body["mime_type"] == "image/png"
    assert body["size"] == len(payload)
    assert body["url"] == f"/api/artifacts/{digest}"


def test_digest_endpoint_is_immutable(client):
    payload = b"immutable-check"
    _, digest = _make_run(client, "demo", "exp-a", payload)
    r = client.get(f"/api/artifacts/{digest}")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_query_no_match_404(client):
    _make_run(client, "demo", "exp-a", b"x")
    r = client.get("/api/query", params={"tag": "nope", "project": "demo"})
    assert r.status_code == 404


def test_query_missing_tag_400(client):
    r = client.get("/api/query", params={"project": "demo"})
    assert r.status_code == 400


def test_query_step_best_400(client):
    r = client.get("/api/query", params={"tag": "render", "step": "best:loss:min"})
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# Auth: read role required when auth is enabled.
# ---------------------------------------------------------------------------

@pytest.fixture
def auth_client(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as c:
        yield c


def test_query_requires_auth_when_enabled(auth_client):
    r = auth_client.get(
        "/api/query", params={"tag": "render"}, follow_redirects=False
    )
    assert r.status_code == 401
