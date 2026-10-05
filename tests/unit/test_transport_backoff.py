"""WAL-backed delivery: send once, back off, replay in order, dead-letter
rejections; a bounded buffer; a finish() that never hangs."""

from __future__ import annotations

import json
import threading
import time

import httpx
import pytest

from cairn.sdk.buffer import MetricBuffer
from cairn.sdk.transport import Transport
from cairn.sdk.wal import WriteAheadLog


class Server:
    """A MockTransport backend whose behaviour a test switches."""

    def __init__(self) -> None:
        self.mode = "ok"  # ok | timeout | 503 | 404
        self.calls: list[tuple[str, str, dict]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body: dict = {}
        if request.content and request.headers.get("content-type") == "application/json":
            body = json.loads(request.content)
        self.calls.append((request.method, request.url.path, body))
        if self.mode == "timeout":
            raise httpx.ReadTimeout("timed out", request=request)
        if self.mode == "503":
            return httpx.Response(503)
        if self.mode == "404" and request.url.path.endswith("/batch"):
            return httpx.Response(404, json={"detail": "run not found"})
        if request.method == "HEAD":
            return httpx.Response(404)
        return httpx.Response(200, json={})

    def posts(self, suffix: str) -> list[dict]:
        return [b for m, p, b in self.calls if m == "POST" and p.endswith(suffix)]


@pytest.fixture
def setup(tmp_path):
    server = Server()
    wal = WriteAheadLog("r", wal_dir=tmp_path / "wal")
    t = Transport(
        "http://test.local", spill_dir=tmp_path / "spill", wal=wal,
        client=httpx.Client(base_url="http://test.local", transport=httpx.MockTransport(server)),
        backoff_base=0.05, backoff_cap=0.2,
    )
    yield t, wal, server
    t.close()
    wal.close()


def test_a_timed_out_batch_is_not_resent_in_place(setup):
    t, wal, server = setup
    server.mode = "timeout"
    assert t.post_batch("r", [{"step": 1}]) is False
    assert len(server.posts("/batch")) == 1  # once: no retry storm
    assert wal.has_pending


def test_while_backing_off_ops_only_go_to_the_wal(setup):
    t, wal, server = setup
    server.mode = "503"
    t.post_batch("r", [{"step": 1}])
    n = len(server.calls)
    t.post_batch("r", [{"step": 2}])
    t.post_params("r", {"lr": 1})
    t.upload_artifact(b"img", "image/png")
    assert len(server.calls) == n  # nothing sent during the backoff
    assert len(list(wal.pending())) == 4


def test_after_the_backoff_the_backlog_replays_in_order(setup):
    t, wal, server = setup
    server.mode = "503"
    t.post_batch("r", [{"step": 1}])
    t.post_params("r", {"lr": 1})
    server.mode = "ok"
    time.sleep(0.1)  # backoff over
    assert t.post_batch("r", [{"step": 2}]) is True
    sent = [(p.rsplit("/", 1)[-1], b) for m, p, b in server.calls if m == "POST"][1:]
    assert sent == [("batch", {"points": [{"step": 1}]}), ("params", {"params": {"lr": 1}}),
                    ("batch", {"points": [{"step": 2}]})]
    assert not wal.has_pending


def test_a_rejected_batch_is_dead_lettered_not_blocking(setup):
    t, wal, server = setup
    server.mode = "404"
    assert t.post_batch("r", [{"step": 1}]) is False
    server.mode = "ok"
    assert t.post_batch("r", [{"step": 2}]) is True  # not blocked behind it
    assert not wal.has_pending
    dead = [json.loads(line) for line in wal.dead_letter_path.read_text().splitlines()]
    assert [d["payload"]["points"] for d in dead] == [[{"step": 1}]]
    assert "404" in dead[0]["reason"]
    wal.cleanup()
    assert wal.dead_letter_path.exists()  # kept: set aside, not lost


def test_finish_returns_by_its_deadline_against_a_dead_server(setup):
    t, wal, server = setup
    server.mode = "timeout"
    t.post_batch("r", [{"step": 1}])
    t0 = time.monotonic()
    assert t.finish_run("r", "completed", deadline=t0 + 0.5) is False
    assert time.monotonic() - t0 < 1.5
    assert [e.op for e in wal.pending()] == ["batch", "finish"]  # for `cairn sync`


def test_finish_waits_out_a_short_outage(setup):
    t, wal, server = setup
    server.mode = "503"
    t.post_batch("r", [{"step": 1}])

    def recover() -> None:
        time.sleep(0.15)
        server.mode = "ok"

    threading.Thread(target=recover).start()
    assert t.finish_run("r", "completed", deadline=time.monotonic() + 3) is True
    assert not wal.has_pending
    assert server.posts("/finish")


def test_buffer_sends_bounded_batches():
    sent: list[int] = []
    buf = MetricBuffer(lambda b: sent.append(len(b)), flush_interval=60, max_rows=10**9, max_batch=100)
    for i in range(1050):
        buf.append({"i": i})
    buf.stop(timeout=5)
    assert max(sent) == 100 and sum(sent) == 1050


def test_buffer_spills_instead_of_growing_or_blocking():
    gate = threading.Event()
    sent: list[int] = []
    spilled: list[int] = []

    def slow_send(batch):  # a server that does not answer
        gate.wait(10)
        sent.append(len(batch))

    buf = MetricBuffer(slow_send, flush_interval=0.01, max_rows=10, max_batch=50,
                       max_pending=500, spill_fn=lambda b: spilled.append(len(b)))
    t0 = time.perf_counter()
    for i in range(5000):
        buf.append({"i": i})
    assert time.perf_counter() - t0 < 1.0  # track() never waited on the send
    assert len(buf._buf) < 500
    assert max(spilled) <= 50
    gate.set()
    buf.stop(timeout=5)
    assert sum(sent) + sum(spilled) == 5000


def test_buffer_stop_spills_what_it_cannot_send_in_time():
    spilled: list[int] = []
    buf = MetricBuffer(lambda b: time.sleep(10), flush_interval=60, max_rows=10**9,
                       max_batch=10, spill_fn=lambda b: spilled.append(len(b)))
    for i in range(100):
        buf.append({"i": i})
    t0 = time.perf_counter()
    buf.stop(timeout=0.2)
    assert time.perf_counter() - t0 < 2.0
    assert sum(spilled) >= 80  # all but what the stuck send took


def test_run_finish_is_bounded_when_the_server_hangs(tmp_path, monkeypatch):
    """End to end: a server that stops answering mid-run costs finish()
    about ``timeout``, and the data waits in the WAL."""
    import cairn
    from cairn.sdk import transport as transport_mod

    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    server = Server()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/runs":
            return httpx.Response(200, json={"run_id": "r1", "project_id": "p"})
        return server(request)

    real_init = transport_mod.Transport.__init__

    def init(self, url, **kw):
        kw["client"] = httpx.Client(base_url=url, transport=httpx.MockTransport(handler))
        real_init(self, url, **kw)

    monkeypatch.setattr(transport_mod.Transport, "__init__", init)
    monkeypatch.setattr("cairn.sdk.connect._probe_server", lambda url: None)
    run = cairn.Run(project="p", repo="http://test.local", timeout=1.0,
                    capture_source=False, capture_stdout=False, capture_env=False,
                    capture_system_metrics=False)
    server.mode = "timeout"
    for s in range(200):
        run.track(float(s), "loss", step=s)
    t0 = time.monotonic()
    run.finish()
    assert time.monotonic() - t0 < 5.0
    wal = WriteAheadLog("r1", wal_dir=tmp_path / "wal")
    ops = [e.op for e in wal.pending()]
    wal.close()
    assert ops[-1] == "finish" and "batch" in ops
