"""HTTP Range request support on artifact GET."""

from __future__ import annotations

import hashlib
import io


def _upload(client, payload: bytes, mime="application/octet-stream"):
    client.post(
        "/api/artifacts",
        files={"file": ("x.bin", io.BytesIO(payload), mime)},
        data={"mime_type": mime},
    )
    return hashlib.sha256(payload).hexdigest()


def test_full_download(client):
    payload = b"0123456789" * 10
    digest = _upload(client, payload)
    r = client.get(f"/api/artifacts/{digest}")
    assert r.status_code == 200
    assert r.content == payload


def test_range_request_partial_content(client):
    payload = b"0123456789" * 10  # 100 bytes
    digest = _upload(client, payload)
    r = client.get(f"/api/artifacts/{digest}", headers={"Range": "bytes=10-19"})
    assert r.status_code == 206
    assert r.content == b"0123456789"
    assert r.headers["Content-Range"] == f"bytes 10-19/{len(payload)}"
    assert r.headers["Content-Length"] == "10"


def test_range_open_ended(client):
    payload = b"abcdefghij"
    digest = _upload(client, payload)
    r = client.get(f"/api/artifacts/{digest}", headers={"Range": "bytes=5-"})
    assert r.status_code == 206
    assert r.content == b"fghij"


def test_range_unsatisfiable(client):
    payload = b"hello"
    digest = _upload(client, payload)
    r = client.get(f"/api/artifacts/{digest}", headers={"Range": "bytes=100-200"})
    assert r.status_code == 416


def test_unknown_artifact_404s(client):
    r = client.get("/api/artifacts/" + "0" * 64)
    assert r.status_code == 404
