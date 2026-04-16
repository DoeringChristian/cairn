"""Unit tests for the SDK transport: retries, backoff, dedup, spill."""

from __future__ import annotations

import httpx
import pytest

from cairn.sdk.transport import Transport


@pytest.fixture
def transport(tmp_path, monkeypatch):
    """Transport wired to an httpx.MockTransport so we can script responses."""

    # Replaced per-test via `responder`.
    responder = {"fn": lambda request: httpx.Response(200, json={})}

    def handler(request: httpx.Request) -> httpx.Response:
        return responder["fn"](request)

    client = httpx.Client(
        base_url="http://test.local",
        transport=httpx.MockTransport(handler),
    )
    # Kill real sleeps.
    monkeypatch.setattr("cairn.sdk.transport.time.sleep", lambda s: None)
    t = Transport(
        "http://test.local",
        spill_dir=tmp_path / "spill",
        client=client,
        max_retries=3,
        backoff_base=0.001,
        backoff_cap=0.001,
    )
    yield t, responder
    t.close()


def test_happy_path_post(transport):
    t, responder = transport
    calls = {"n": 0}

    def r(req):
        calls["n"] += 1
        return httpx.Response(200, json={"ok": True})

    responder["fn"] = r
    resp = t.post_json("/api/ping", {"hello": "world"})
    assert resp.status_code == 200
    assert calls["n"] == 1


def test_retries_on_503_then_succeeds(transport):
    t, responder = transport
    n = {"count": 0}

    def r(req):
        n["count"] += 1
        if n["count"] <= 2:
            return httpx.Response(503)
        return httpx.Response(200, json={})

    responder["fn"] = r
    t.post_json("/x", {})
    assert n["count"] == 3


def test_does_not_retry_on_400(transport):
    t, responder = transport
    n = {"count": 0}

    def r(req):
        n["count"] += 1
        return httpx.Response(400, json={"error": "bad"})

    responder["fn"] = r
    with pytest.raises(httpx.HTTPStatusError):
        t.post_json("/x", {})
    assert n["count"] == 1


def test_retries_exhausted_raises(transport):
    t, responder = transport
    n = {"count": 0}

    def r(req):
        n["count"] += 1
        return httpx.Response(500)

    responder["fn"] = r
    with pytest.raises(httpx.HTTPStatusError):
        t.post_json("/x", {})
    # max_retries=3 means 3 attempts
    assert n["count"] == 3


def test_post_batch_spills_on_failure(transport, tmp_path):
    t, responder = transport
    responder["fn"] = lambda req: httpx.Response(500)
    ok = t.post_batch("runA", [{"name": "loss", "step": 0}])
    assert ok is False
    spill_files = list((tmp_path / "spill" / "runA").glob("*.json"))
    assert len(spill_files) == 1


def test_upload_artifact_dedup_skips_post(transport):
    t, responder = transport
    calls: list[str] = []

    def r(req):
        calls.append(req.method)
        if req.method == "HEAD":
            return httpx.Response(200)
        return httpx.Response(200, json={})

    responder["fn"] = r
    digest = t.upload_artifact(b"hello", "text/plain")
    assert calls == ["HEAD"]
    # sha256("hello") known
    assert digest == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"


def test_upload_artifact_uploads_when_missing(transport):
    t, responder = transport
    calls: list[str] = []

    def r(req):
        calls.append(req.method)
        if req.method == "HEAD":
            return httpx.Response(404)
        return httpx.Response(200, json={"hash": "x", "size_bytes": 5})

    responder["fn"] = r
    t.upload_artifact(b"hello", "text/plain", {"w": 1})
    assert calls == ["HEAD", "POST"]


def test_drain_spill_replays(transport, tmp_path):
    t, responder = transport
    # Create a spill file directly.
    run_dir = tmp_path / "spill" / "runA"
    run_dir.mkdir(parents=True)
    spill = run_dir / "abc.json"
    import json

    spill.write_text(
        json.dumps(
            {"path": "/api/runs/runA/batch", "body": {"points": [{"x": 1}]}}
        )
    )
    responder["fn"] = lambda req: httpx.Response(200, json={})
    replayed = t.drain_spill()
    assert replayed == 1
    assert not spill.exists()
    # Dir is cleaned up when empty
    assert not run_dir.exists()


def test_drain_spill_keeps_file_on_server_failure(transport, tmp_path):
    t, responder = transport
    run_dir = tmp_path / "spill" / "runB"
    run_dir.mkdir(parents=True)
    import json

    (run_dir / "f.json").write_text(
        json.dumps({"path": "/x", "body": {}})
    )
    responder["fn"] = lambda req: httpx.Response(500)
    replayed = t.drain_spill()
    assert replayed == 0
    assert (run_dir / "f.json").exists()


def test_drain_spill_specific_run(transport, tmp_path):
    t, responder = transport
    import json

    for rid in ("a", "b"):
        d = tmp_path / "spill" / rid
        d.mkdir(parents=True)
        (d / "x.json").write_text(json.dumps({"path": "/x", "body": {}}))
    responder["fn"] = lambda req: httpx.Response(200, json={})
    assert t.drain_spill("a") == 1
    assert not (tmp_path / "spill" / "a").exists()
    assert (tmp_path / "spill" / "b" / "x.json").exists()
