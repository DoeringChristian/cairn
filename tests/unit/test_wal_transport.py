"""Integration tests: WAL + Transport — simulates server disconnects."""

from __future__ import annotations

import json

import httpx
import pytest

from cairn.sdk.transport import Transport
from cairn.sdk.wal import WriteAheadLog


@pytest.fixture
def setup(tmp_path, monkeypatch):
    """Transport with WAL, wired to a mock HTTP backend."""
    monkeypatch.setattr("cairn.sdk.transport.time.sleep", lambda s: None)

    call_log: list[dict] = []
    fail_next: dict[str, bool] = {"fail": False}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if fail_next["fail"]:
            return httpx.Response(503, text="Server unavailable")
        if request.method == "HEAD":
            return httpx.Response(404)  # artifact not found → upload
        body = {}
        if request.content:
            try:
                body = json.loads(request.content)
            except (json.JSONDecodeError, UnicodeDecodeError):
                body = {"_multipart": True}
        call_log.append({"method": str(request.method), "path": path, "body": body})
        return httpx.Response(200, json={"ok": True})

    client = httpx.Client(
        base_url="http://test.local",
        transport=httpx.MockTransport(handler),
    )
    wal = WriteAheadLog("test-run", wal_dir=tmp_path / "wal")
    t = Transport(
        "http://test.local",
        spill_dir=tmp_path / "spill",
        client=client,
        wal=wal,
        max_retries=1,
        backoff_base=0.001,
        backoff_cap=0.001,
    )
    yield t, wal, call_log, fail_next
    t.close()
    wal.close()


class TestWALTransportIntegration:
    def test_happy_path_checkpoints_immediately(self, setup):
        t, wal, call_log, _ = setup
        t.post_batch("run1", [{"name": "loss", "scalar_value": 0.5}])
        assert wal.read_checkpoint() == 1
        assert not wal.has_pending
        assert len(call_log) == 1
        assert call_log[0]["path"] == "/api/runs/run1/batch"

    def test_server_down_data_in_wal(self, setup):
        t, wal, call_log, fail_next = setup
        fail_next["fail"] = True
        result = t.post_batch("run1", [{"name": "loss", "scalar_value": 0.5}])
        assert result is False  # send failed
        assert wal.has_pending  # but data is in WAL
        assert wal.read_checkpoint() == 0  # not checkpointed
        pending = list(wal.pending())
        assert len(pending) == 1
        assert pending[0].op == "batch"

    def test_drain_replays_after_reconnect(self, setup):
        t, wal, call_log, fail_next = setup
        # Simulate 3 operations while server is down
        fail_next["fail"] = True
        t.post_batch("run1", [{"name": "loss", "scalar_value": 0.1}])
        t.post_batch("run1", [{"name": "loss", "scalar_value": 0.2}])
        t.post_params("run1", {"lr": 0.01})
        assert wal._seq == 3
        assert wal.read_checkpoint() == 0
        assert len(call_log) == 0  # nothing reached server

        # Server comes back
        fail_next["fail"] = False
        replayed = t.drain_wal()
        assert replayed == 3
        assert wal.read_checkpoint() == 3
        assert not wal.has_pending
        # Verify the replayed calls
        assert len(call_log) == 3
        assert call_log[0]["path"] == "/api/runs/run1/batch"
        assert call_log[1]["path"] == "/api/runs/run1/batch"
        assert call_log[2]["path"] == "/api/runs/run1/params"

    def test_partial_drain_stops_on_error(self, setup):
        t, wal, call_log, fail_next = setup
        # Log 3 batches while down
        fail_next["fail"] = True
        t.post_batch("run1", [{"x": 1}])
        t.post_batch("run1", [{"x": 2}])
        t.post_batch("run1", [{"x": 3}])

        # Server comes back but fails again after 1st replay
        fail_count = {"n": 0}
        orig_fail = fail_next["fail"]

        def handler_fail_after_one(request: httpx.Request) -> httpx.Response:
            fail_count["n"] += 1
            if fail_count["n"] > 1:
                return httpx.Response(503)
            call_log.append({"method": str(request.method), "path": str(request.url.path), "body": {}})
            return httpx.Response(200, json={})

        # Swap the transport's client handler
        t._client = httpx.Client(
            base_url="http://test.local",
            transport=httpx.MockTransport(handler_fail_after_one),
        )
        fail_next["fail"] = False

        replayed = t.drain_wal()
        assert replayed == 1  # only first succeeded
        assert wal.read_checkpoint() == 1
        # 2 entries still pending
        assert len(list(wal.pending())) == 2

    def test_artifact_wal_and_replay(self, setup):
        t, wal, call_log, fail_next = setup
        fail_next["fail"] = True
        digest = t.upload_artifact(b"image-data", "image/png", {"w": 64})
        assert wal.has_pending
        pending = list(wal.pending())
        assert len(pending) == 1
        assert pending[0].op == "artifact"

        # Replay
        fail_next["fail"] = False
        replayed = t.drain_wal()
        assert replayed == 1
        # Should have done HEAD + POST
        assert any("artifacts" in c["path"] for c in call_log)

    def test_logs_wal(self, setup):
        t, wal, call_log, fail_next = setup
        fail_next["fail"] = True
        t.post_logs("run1", [{"stream": "stdout", "content": "hello"}])
        assert wal.has_pending

        fail_next["fail"] = False
        t.drain_wal()
        assert not wal.has_pending
        assert any("logs" in c["path"] for c in call_log)
