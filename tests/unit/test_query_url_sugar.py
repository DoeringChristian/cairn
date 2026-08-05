"""Tests for the Python query-URL sugar (``cairn.query_url`` + reader helpers).

Covers the live URL string shape, one-shot baked resolution against a real
server, and the clear local-only error path.
"""

from __future__ import annotations

import hashlib
import io
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

import cairn
from cairn.sdk.query_urls import build_query_url, query_url
from cairn.sdk.reader import DataRef, Run, RunQuery


class _StubBackend:
    """Minimal backend exposing only what the URL sugar reads."""

    def __init__(self, server_url: str | None):
        if server_url is not None:
            self.server_url = server_url


# ---------------------------------------------------------------------------
# Live URL shape
# ---------------------------------------------------------------------------

def test_query_url_live_shape():
    url = cairn.query_url(
        "train/render", run="latest", project="demo", name="exp*",
        server="http://host:4300", lr__gt=1e-4,
    )
    parsed = urlparse(url)
    assert parsed.scheme == "http" and parsed.netloc == "host:4300"
    assert parsed.path == "/api/query"
    q = parse_qs(parsed.query)
    assert q["run"] == ["latest"]
    assert q["tag"] == ["train/render"]
    assert q["project"] == ["demo"]
    assert q["name"] == ["exp*"]
    assert q["lr__gt"] == ["0.0001"]


def test_query_url_accepts_cairn_scheme():
    url = cairn.query_url("render", server="cairn://box.local:4300")
    assert url.startswith("http://box.local:4300/api/query?")


def test_build_query_url_step():
    url = build_query_url("http://h:1", tag="ckpt", run="id:abc123", step=5)
    q = parse_qs(urlparse(url).query)
    assert q["run"] == ["id:abc123"] and q["step"] == ["5"]


def test_runquery_latest_url_encodes_filters():
    rq = RunQuery(_StubBackend("http://h:4300"), project="demo").filter(
        status="completed", lr__gt=1e-4,
    )
    url = rq.latest_url("render")
    q = parse_qs(urlparse(url).query)
    assert q["run"] == ["latest"]
    assert q["tag"] == ["render"]
    assert q["project"] == ["demo"]
    assert q["status"] == ["completed"]
    assert q["lr__gt"] == ["0.0001"]


def test_dataref_url_pins_run():
    run = Run({"id": "abcabcabcabc"}, _StubBackend("http://h:4300"))
    url = run["render"].url
    q = parse_qs(urlparse(url).query)
    assert q["run"] == ["id:abcabcabcabc"]
    assert q["tag"] == ["render"]


def test_dataref_url_step_narrowing():
    run = Run({"id": "abcabcabcabc"}, _StubBackend("http://h:4300"))
    ref = DataRef(run, "ckpt", step=7)
    q = parse_qs(urlparse(ref.url).query)
    assert q["step"] == ["7"]


# ---------------------------------------------------------------------------
# Local-only error
# ---------------------------------------------------------------------------

def test_query_url_local_target_errors(tmp_path):
    with pytest.raises(ValueError, match="server target"):
        cairn.query_url("render", server=str(tmp_path / ".cairn"))


def test_latest_url_local_backend_errors():
    rq = RunQuery(_StubBackend(None))
    with pytest.raises(ValueError, match="server target"):
        rq.latest_url("render")


def test_dataref_url_local_backend_errors():
    run = Run({"id": "abcabcabcabc"}, _StubBackend(None))
    with pytest.raises(ValueError, match="server target"):
        _ = run["render"].url


# ---------------------------------------------------------------------------
# Baked resolution against a real server.
# ---------------------------------------------------------------------------

def test_query_url_baked_resolves_digest(live_server):
    payload = b"baked-render-bytes"
    digest = hashlib.sha256(payload).hexdigest()
    with httpx.Client(base_url=live_server) as c:
        rid = c.post("/api/runs", json={"project": "demo", "name": "exp"}).json()["run_id"]
        c.post("/api/artifacts", files={"file": ("x.png", io.BytesIO(payload), "image/png")},
               data={"mime_type": "image/png"})
        c.post(f"/api/runs/{rid}/artifacts", json={"name": "render", "hash": digest})

    url = query_url("render", project="demo", live=False, server=live_server)
    assert url == f"{live_server}/api/artifacts/{digest}"
    # And the baked URL actually serves the bytes.
    assert httpx.get(url).content == payload
