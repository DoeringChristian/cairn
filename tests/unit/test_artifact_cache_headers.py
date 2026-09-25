"""GET /api/artifacts/{digest}: content-addressed bytes are cacheable forever.

The viewer steps through media by requesting the same URL for the same bytes
in every card; these headers are what let the browser serve every revisit
from its cache (and revalidate with a bodiless 304 when it does ask).
"""

from __future__ import annotations

import hashlib
import io

IMMUTABLE = "public, max-age=31536000, immutable"


def _artifact(client, payload: bytes = b"\x89PNG\r\n\x1a\n" + b"\x01" * 64) -> str:
    client.post(
        "/api/artifacts",
        files={"file": ("x.png", io.BytesIO(payload), "image/png")},
        data={"mime_type": "image/png"},
    )
    return hashlib.sha256(payload).hexdigest()


def test_full_body_is_immutable_with_strong_etag(client):
    digest = _artifact(client)
    r = client.get(f"/api/artifacts/{digest}")
    assert r.status_code == 200
    assert r.headers["cache-control"] == IMMUTABLE
    assert r.headers["etag"] == f'"{digest}"'
    # No cache-busting variance: the same URL always answers the same bytes.
    assert client.get(f"/api/artifacts/{digest}").content == r.content


def test_range_response_carries_the_same_cache_headers(client):
    digest = _artifact(client)
    r = client.get(f"/api/artifacts/{digest}", headers={"Range": "bytes=0-3"})
    assert r.status_code == 206
    assert r.headers["cache-control"] == IMMUTABLE
    assert r.headers["etag"] == f'"{digest}"'


def test_if_none_match_revalidates_without_a_body(client):
    digest = _artifact(client)
    for validator in (f'"{digest}"', f'W/"{digest}"', f'"other", "{digest}"', "*"):
        r = client.get(f"/api/artifacts/{digest}", headers={"If-None-Match": validator})
        assert r.status_code == 304, validator
        assert r.content == b""
        assert r.headers["etag"] == f'"{digest}"'
        assert r.headers["cache-control"] == IMMUTABLE


def test_stale_validator_gets_the_bytes(client):
    digest = _artifact(client)
    r = client.get(f"/api/artifacts/{digest}", headers={"If-None-Match": '"not-it"'})
    assert r.status_code == 200
    assert r.content.startswith(b"\x89PNG")


def test_unknown_digest_is_404_not_cached(client):
    r = client.get("/api/artifacts/" + "0" * 64, headers={"If-None-Match": "*"})
    assert r.status_code == 404
    assert "immutable" not in r.headers.get("cache-control", "")
