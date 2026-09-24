"""Stopping a run from the UI: ``POST /api/runs/{id}/stop`` sets
``stop_requested``; the heartbeat hands it back on every write path (HTTP,
LocalTransport direct, LocalTransport WAL) and the SDK run ends "stopped"."""

from __future__ import annotations

import signal
import time

import pytest

import cairn
from cairn.sdk.local import LocalTransport
from cairn.sdk.transport import Transport
from cairn.server import ingest_ops
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all


def test_http_stop_route_and_heartbeat(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    assert client.post(f"/api/runs/{rid}/heartbeat").json() == {"run_id": rid, "stop_requested": None}

    r = client.post(f"/api/runs/{rid}/stop")
    assert r.status_code == 200, r.text
    ts = r.json()["stop_requested"]
    assert ts
    # Asking twice keeps the first request.
    assert client.post(f"/api/runs/{rid}/stop").json()["stop_requested"] == ts
    assert client.post(f"/api/runs/{rid}/heartbeat").json()["stop_requested"] == ts
    assert client.get(f"/api/runs/{rid}").json()["run"]["stop_requested"] == ts

    client.post(f"/api/runs/{rid}/finish", json={"status": "stopped"})
    assert client.post(f"/api/runs/{rid}/stop").status_code == 409
    assert client.post("/api/runs/nope/stop").status_code == 404


def test_http_transport_heartbeat_returns_flag(live_server):
    t = Transport(live_server)
    try:
        rid = t.create_run({"project": "p"})["run_id"]
        assert t.heartbeat(rid) is None
        t.post_json(f"/api/runs/{rid}/stop", {})
        assert t.heartbeat(rid)
    finally:
        t.close()


def test_local_direct_heartbeat_returns_flag(tmp_path):
    t = LocalTransport(tmp_path / ".cairn")
    try:
        rid = t.create_run({"project": "p"})["run_id"]
        assert t.heartbeat(rid) is None
        ts = ingest_ops.request_stop(t.db, rid)
        assert t.heartbeat(rid) == ts
    finally:
        t.close()


def test_local_wal_heartbeat_reads_flag(tmp_path):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo, use_wal=True)
    rid = t.create_run({"project": "p", "run_id": "a" * 32})["run_id"]
    try:
        dd = DataDir(repo)
        db = Database.open(dd.db_path)
        ingest_all(dd, db, BlobStore(dd.artifacts_dir))  # incremental drain: run is live
        assert t.heartbeat(rid) is None
        ts = ingest_ops.request_stop(db, rid)
        assert t.heartbeat(rid) == ts
        t.finish_run(rid, "stopped")
    finally:
        t.close()
    ingest_all(dd, db, BlobStore(dd.artifacts_dir))  # full drain replays the heartbeats
    row = db.read_columns("SELECT status, stop_requested FROM runs WHERE id = ?", [rid])[0]
    db.close()
    assert row == {"status": "stopped", "stop_requested": ts}


def _run(repo, **kw) -> cairn.Run:
    return cairn.Run(
        project="p", repo=repo, capture_source=False, capture_stdout=False,
        capture_env=False, capture_system_metrics=False, **kw,
    )


def _wait(pred, timeout=5.0):
    deadline = time.time() + timeout
    while not pred():
        assert time.time() < deadline, "timed out"
        time.sleep(0.01)


def _status(repo, rid):
    reader = cairn.Reader(repo=repo)
    try:
        return reader.run(rid).status
    finally:
        reader.close()


def test_sdk_flag_mode_calls_on_stop_and_finishes_stopped(tmp_path, monkeypatch):
    monkeypatch.setattr(cairn.Run, "_HEARTBEAT_INTERVAL", 0.02)
    repo = tmp_path / ".cairn"
    seen = []
    with _run(repo, stop_mode="flag", on_stop=lambda r: seen.append("ctor")) as run:
        run.on_stop(lambda r: seen.append("method"))
        assert not run.should_stop
        ingest_ops.request_stop(run._transport.db, run.id)
        _wait(lambda: run.should_stop)
        rid = run.id
    assert seen == ["ctor", "method"]
    assert _status(repo, rid) == "stopped"


def test_sdk_interrupt_mode_raises_keyboard_interrupt(tmp_path, monkeypatch):
    monkeypatch.setattr(cairn.Run, "_HEARTBEAT_INTERVAL", 0.02)
    # Other tests (the `cairn ui` CLI ones) leave their own SIGINT handler behind.
    prev = signal.signal(signal.SIGINT, signal.default_int_handler)
    try:
        _interrupt_mode(tmp_path)
    finally:
        signal.signal(signal.SIGINT, prev)


def _interrupt_mode(tmp_path):
    repo = tmp_path / ".cairn"
    with pytest.raises(KeyboardInterrupt):
        with _run(repo) as run:
            rid = run.id
            ingest_ops.request_stop(run._transport.db, run.id)
            deadline = time.time() + 5
            while time.time() < deadline:
                time.sleep(0.01)
    assert _status(repo, rid) == "stopped"


def test_sdk_rejects_unknown_stop_mode(tmp_path):
    with pytest.raises(ValueError):
        _run(tmp_path / ".cairn", stop_mode="kill")
