"""Alerts: ``run.alert()`` and automatic alerts (failed/killed transitions,
stale-run reaping) on every write path, the read route, the webhook payload
per host, and delivery to a local HTTP server."""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from fastapi.testclient import TestClient

import cairn
from cairn.sdk.local import LocalTransport
from cairn.server import alerts as alerts_core
from cairn.server import ingest_ops
from cairn.server.app import create_app
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all


def _alerts(db, run_id=None):
    sql = "SELECT * FROM alerts" + (" WHERE run_id = ?" if run_id else "") + " ORDER BY created_at"
    return db.read_columns(sql, [run_id] if run_id else [])


# ---- HTTP -----------------------------------------------------------------


def test_http_alert_and_list(client):
    created = client.post("/api/runs", json={"project": "p", "name": "r1"}).json()
    rid, pid = created["run_id"], created["project_id"]
    other = client.post("/api/runs", json={"project": "p"}).json()["run_id"]

    r = client.post(f"/api/runs/{rid}/alerts", json={
        "title": "loss spiked", "text": "loss=9.1", "level": "warn",
        "created_at": "2024-01-01T00:00:00+00:00",
    })
    assert r.status_code == 200, r.text
    client.post(f"/api/runs/{other}/alerts", json={"title": "hello"})

    alerts = client.get(f"/api/projects/{pid}/alerts").json()["alerts"]
    assert [a["title"] for a in alerts] == ["hello", "loss spiked"]  # newest first
    spike = alerts[1]
    assert spike["run_id"] == rid and spike["run_name"] == "r1"
    assert spike["level"] == "warn" and spike["text"] == "loss=9.1"
    assert spike["delivered_at"] is None

    since = client.get(f"/api/projects/{pid}/alerts", params={"since": "2024-06-01T00:00:00Z"})
    assert [a["title"] for a in since.json()["alerts"]] == ["hello"]
    by_run = client.get(f"/api/projects/{pid}/alerts", params={"run_id": rid})
    assert [a["title"] for a in by_run.json()["alerts"]] == ["loss spiked"]

    assert client.post(f"/api/runs/{rid}/alerts", json={"title": "x", "level": "fatal"}).status_code == 400
    assert client.post("/api/runs/nope/alerts", json={"title": "x"}).status_code == 404
    assert client.get(f"/api/projects/{pid}/alerts", params={"since": "soon"}).status_code == 400


def test_http_alert_with_id_is_idempotent(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    for _ in range(2):
        client.post(f"/api/runs/{rid}/alerts", json={"title": "t", "alert_id": "a1"})
    assert len(_alerts(client.app.state.db, rid)) == 1


@pytest.mark.parametrize(("status", "level"), [("failed", "error"), ("killed", "warn")])
def test_failed_or_killed_transition_alerts_once(client, status, level):
    rid = client.post("/api/runs", json={"project": "p", "name": "train"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/finish", json={"status": status, "exit_code": 3})
    client.post(f"/api/runs/{rid}/finish", json={"status": status, "exit_code": 3})
    (alert,) = _alerts(client.app.state.db, rid)
    assert alert["level"] == level
    assert alert["title"] == f"Run train {status}"
    assert alert["text"] == "exit code 3"


@pytest.mark.parametrize("status", ["completed", "stopped"])
def test_other_finishes_do_not_alert(client, status):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/finish", json={"status": status})
    assert _alerts(client.app.state.db, rid) == []


# ---- LocalTransport ---------------------------------------------------------


def _alert(title, alert_id, level="info"):
    return {"alert_id": alert_id, "title": title, "text": "", "level": level,
            "created_at": "2024-01-01T00:00:00+00:00"}


def test_local_direct(tmp_path):
    t = LocalTransport(tmp_path / ".cairn")
    try:
        rid = t.create_run({"project": "p"})["run_id"]
        t.alert(rid, _alert("hi", "a1", "error"))
        t.finish_run(rid, "failed", exit_code=1)
        rows = _alerts(t.db, rid)
    finally:
        t.close()
    assert [(a["id"], a["level"]) for a in rows if a["id"] == "a1"] == [("a1", "error")]
    assert len(rows) == 2


def test_local_wal_replays_once_after_incremental_and_full_drain(tmp_path):
    repo = tmp_path / ".cairn"
    dd = DataDir(repo)
    t = LocalTransport(repo, use_wal=True)
    rid = t.create_run({"project": "p", "run_id": "b" * 32})["run_id"]
    t.alert(rid, _alert("hi", "a1"))
    t.finish_run(rid, "failed", exit_code=1)
    db = Database.open(dd.db_path)
    ingest_all(dd, db, BlobStore(dd.artifacts_dir))  # incremental (lock held)
    t.close()
    ingest_all(dd, db, BlobStore(dd.artifacts_dir))  # full drain replays everything
    rows = _alerts(db, rid)
    db.close()
    assert sorted(a["level"] for a in rows) == ["error", "info"]


# ---- SDK --------------------------------------------------------------------


def _run(repo, **kw):
    return cairn.Run(project="p", repo=repo, capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False, **kw)


def test_sdk_run_alert_and_failure(tmp_path):
    repo = tmp_path / ".cairn"
    with pytest.raises(RuntimeError):
        with _run(repo, name="boom") as run:
            run.alert("accuracy low", "acc=0.1", level="warn")
            with pytest.raises(ValueError):
                run.alert("x", level="critical")
            rid = run.id
            raise RuntimeError("boom")
    db = Database.open(DataDir(repo).db_path)
    try:
        rows = _alerts(db, rid)
    finally:
        db.close()
    assert sorted((a["level"], a["title"]) for a in rows) == [
        ("error", "Run boom failed"), ("warn", "accuracy low"),
    ]


def test_sdk_run_alert_over_http(live_server):
    run = cairn.Run(project="p", repo=live_server, capture_source=False, capture_stdout=False,
                    capture_env=False, capture_system_metrics=False)
    run.alert("over http", level="error")
    run.finish()


# ---- reaping ------------------------------------------------------------------


def test_reap_stale_runs_kills_and_alerts_once(tmp_path):
    dd = DataDir(tmp_path / ".cairn")
    db = Database.open(dd.db_path)
    try:
        ingest_ops.create_run(db, project="p", run_id="stale", name="old")
        ingest_ops.create_run(db, project="p", run_id="fresh")
        db.write("UPDATE runs SET last_heartbeat = '2000-01-01T00:00:00+00:00' WHERE id = 'stale'")
        (dd.root / "wals").mkdir(exist_ok=True)
        lock = dd.root / "wals" / "stale.lock"
        lock.write_text("x")

        assert alerts_core.reap_stale_runs(db, dd) == ["stale"]
        assert alerts_core.reap_stale_runs(db, dd) == []
        status = {r["id"]: r["status"] for r in db.read_columns("SELECT id, status FROM runs")}
        assert status == {"stale": "killed", "fresh": "running"}
        (alert,) = _alerts(db)
        assert (alert["run_id"], alert["level"], alert["title"]) == ("stale", "warn", "Run old killed")
        assert not lock.exists()
    finally:
        db.close()


# ---- webhook payloads -----------------------------------------------------------


ALERT = {
    "id": "a1", "run_id": "r1", "run_name": "train", "project_id": "p1",
    "project_name": "vision", "level": "error", "title": "Run train failed",
    "text": "exit code 1", "created_at": "2024-01-01T00:00:00+00:00",
}


def test_payload_ntfy():
    req = alerts_core.build_request("https://ntfy.sh/my-topic", ALERT)
    assert req.data == b"exit code 1"
    assert req.get_header("Title") == "[vision] Run train failed"
    assert req.get_header("Priority") == "urgent"
    # Non-latin-1 titles go RFC 2047-encoded (ntfy decodes them).
    req = alerts_core.build_request("https://ntfy.example.org/t", {**ALERT, "title": "Lauf ✗"})
    assert req.get_header("Title").startswith("=?UTF-8?B?")


def test_payload_slack_discord_generic():
    slack = json.loads(alerts_core.build_request("https://hooks.slack.com/services/X", ALERT).data)
    assert list(slack) == ["text"] and "[vision] Run train failed" in slack["text"]
    discord = json.loads(
        alerts_core.build_request("https://discord.com/api/webhooks/1/x", ALERT).data
    )
    assert list(discord) == ["content"] and "exit code 1" in discord["content"]
    generic = json.loads(alerts_core.build_request("https://example.com/hook", ALERT).data)
    assert generic == ALERT


# ---- delivery ---------------------------------------------------------------------


class _Sink:
    """A local HTTP server that records every POST."""

    def __init__(self):
        received = self.received = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                received.append((self.path, dict(self.headers), body))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/hook"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def sink():
    s = _Sink()
    yield s
    s.close()


def test_maintenance_cycle_delivers_each_alert_once(tmp_path, sink):
    dd = DataDir(tmp_path / ".cairn")
    db = Database.open(dd.db_path)
    try:
        ingest_ops.create_run(db, project="vision", run_id="r1", name="train")
        ingest_ops.finish_run(db, "r1", "failed", exit_code=1)
        # No webhook: nothing is claimed, the alert waits for one.
        assert alerts_core.maintenance_cycle(db, dd, None) == 0
        assert alerts_core.maintenance_cycle(db, dd, sink.url) == 1
        assert alerts_core.maintenance_cycle(db, dd, sink.url) == 0
        (alert,) = _alerts(db)
        assert alert["delivered_at"] is not None
    finally:
        db.close()
    ((path, headers, body),) = sink.received
    assert path == "/hook" and headers["Content-Type"] == "application/json"
    payload = json.loads(body)
    assert payload["title"] == "Run train failed" and payload["project_name"] == "vision"
    assert payload["run_name"] == "train" and payload["level"] == "error"


def test_unreachable_webhook_is_logged_not_raised(tmp_path):
    dd = DataDir(tmp_path / ".cairn")
    db = Database.open(dd.db_path)
    try:
        ingest_ops.create_run(db, project="p", run_id="r1")
        ingest_ops.insert_alert(db, "r1", "t")
        assert alerts_core.maintenance_cycle(db, dd, "http://127.0.0.1:9/nothing") == 1
    finally:
        db.close()


def test_server_lifespan_delivers_to_webhook(tmp_path, sink):
    app = create_app(data_dir=tmp_path / "cairn", alert_webhook=sink.url)
    with TestClient(app) as client:
        rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
        client.post(f"/api/runs/{rid}/alerts", json={"title": "from the server"})
        deadline = time.time() + 10
        while not sink.received and time.time() < deadline:
            time.sleep(0.05)
    assert [json.loads(b)["title"] for _, _, b in sink.received] == ["from the server"]


def test_background_tasks_off_does_not_deliver(tmp_path, sink):
    app = create_app(data_dir=tmp_path / "cairn", alert_webhook=sink.url, background_tasks=False)
    with TestClient(app) as client:
        rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
        client.post(f"/api/runs/{rid}/alerts", json={"title": "x"})
        time.sleep(0.2)
    assert sink.received == []


def test_imported_alerts_are_never_redelivered(client):
    import io

    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/alerts", json={"title": "old news"})
    exported = client.post("/api/export", json={"run_ids": [rid]})
    imported = client.post(
        "/api/import", files={"file": ("r.zip", io.BytesIO(exported.content), "application/zip")},
    ).json()["imported"]
    new_id = imported[0]["new_id"]
    (alert,) = _alerts(client.app.state.db, new_id)
    assert alert["delivered_at"] is not None
