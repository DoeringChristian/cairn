"""Reads never wait for writes; ingest stays bounded and fast.

Regression tests for a server whose reads (runs table, projects page, auth
lookups) queued behind every write transaction on one shared connection,
and whose large batches stalled the event loop.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from datetime import datetime, timezone

import httpx
import pytest

from cairn.server import ingest_ops
from cairn.server.storage.db import Database


def _hold_write(db: Database, entered: threading.Event, release: threading.Event) -> threading.Thread:
    """A thread inside a write transaction (holding the write lock, with an
    uncommitted row) until ``release`` is set."""

    def hold() -> None:
        with db.transaction(immediate=True) as con:
            con.execute(
                "INSERT INTO projects (id, name, created_at) VALUES ('held', 'held', 'now')"
            )
            entered.set()
            release.wait(30)

    t = threading.Thread(target=hold, daemon=True)
    t.start()
    assert entered.wait(5)
    return t


def test_read_returns_during_a_write_transaction(tmp_path):
    db = Database.open(tmp_path / "c.db")
    db.write("INSERT INTO projects (id, name, created_at) VALUES ('p', 'p', 'now')")
    entered, release = threading.Event(), threading.Event()
    t = _hold_write(db, entered, release)
    try:
        t0 = time.perf_counter()
        rows = db.read("SELECT id FROM projects ORDER BY id")
        assert time.perf_counter() - t0 < 1.0
        assert rows == [("p",)]  # the last committed state, not the held row
    finally:
        release.set()
        t.join(5)
    assert db.read("SELECT id FROM projects ORDER BY id") == [("held",), ("p",)]
    db.close()


def test_read_inside_a_transaction_sees_its_own_rows(tmp_path):
    db = Database.open(tmp_path / "c.db")
    with db.transaction(immediate=True) as con:
        con.execute("INSERT INTO projects (id, name, created_at) VALUES ('p', 'p', 'now')")
        assert db.read_one("SELECT id FROM projects") == ("p",)
    db.close()


def test_read_connections_refuse_writes(tmp_path):
    db = Database.open(tmp_path / "c.db")
    with pytest.raises(sqlite3.OperationalError):
        db.read("INSERT INTO projects (id, name, created_at) VALUES ('p', 'p', 'now')")
    assert db.read("SELECT COUNT(*) FROM projects") == [(0,)]
    db.close()


def test_api_reads_return_during_a_write_transaction(app, live_server):
    """Page-load endpoints answer while the writer is busy."""
    with httpx.Client(base_url=live_server, timeout=10) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
        db = app.state.db
        entered, release = threading.Event(), threading.Event()
        t = _hold_write(db, entered, release)
        try:
            for path in ("/api/projects", "/api/runs?project=p&include=params,stats",
                         f"/api/runs/{rid}", "/api/projects/p/workspace", "/api/health"):
                t0 = time.perf_counter()
                assert c.get(path).status_code == 200, path
                assert time.perf_counter() - t0 < 1.0, path
        finally:
            release.set()
            t.join(5)


def _points(n: int, start: int = 0, metrics: int = 50) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    return [
        {"name": f"m{i % metrics}", "step": start + i // metrics, "wall_time": now,
         "object_type": "scalar", "scalar_value": float(i)}
        for i in range(n)
    ]


def test_large_batch_commits_in_bounded_transactions(tmp_path, monkeypatch):
    db = Database.open(tmp_path / "c.db")
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    sizes: list[int] = []
    real = ingest_ops.insert_points

    def spy(con, run_id, rows):
        sizes.append(len(rows))
        real(con, run_id, rows)

    monkeypatch.setattr(ingest_ops, "insert_points", spy)
    n = 2 * ingest_ops.INGEST_CHUNK + 7
    assert ingest_ops.insert_batch(db, rid, _points(n)) == n
    assert max(sizes) == ingest_ops.INGEST_CHUNK and sum(sizes) == n
    assert db.read_one("SELECT SUM(count) FROM metric_stats WHERE run_id = ?", [rid]) == (n,)
    db.close()


def test_ingest_throughput_smoke(tmp_path):
    """Generous floor (dev machines do ~250k points/s): catches a per-point
    regression (a query per row, say), not noise."""
    db = Database.open(tmp_path / "c.db")
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    pts = _points(50_000)
    t0 = time.perf_counter()
    ingest_ops.insert_batch(db, rid, pts)
    rate = len(pts) / (time.perf_counter() - t0)
    assert rate > 25_000, f"{rate:.0f} points/s"
    db.close()


def test_batch_route_parses_off_the_event_loop(app, live_server):
    """A big batch does not stall other requests (its parse used to run on
    the event loop)."""
    with httpx.Client(base_url=live_server, timeout=30) as c:
        rid = c.post("/api/runs", json={"project": "p"}).json()["run_id"]
        body = {"points": _points(200_000)}
        done = threading.Event()

        def post() -> None:
            with httpx.Client(base_url=live_server, timeout=60) as c2:
                assert c2.post(f"/api/runs/{rid}/batch", json=body).status_code == 200
            done.set()

        t = threading.Thread(target=post, daemon=True)
        t.start()
        worst = 0.0
        while not done.is_set():
            t0 = time.perf_counter()
            assert c.get("/api/health").status_code == 200
            worst = max(worst, time.perf_counter() - t0)
            time.sleep(0.01)
        t.join(60)
        assert worst < 0.5, worst
        n = c.get(f"/api/runs/{rid}/sequences").json()["sequences"]
        assert sum(s["count"] for s in n) == 200_000


def test_rejected_batch_is_409_but_a_server_error_is_5xx(client, monkeypatch):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]

    def locked(*_a, **_k):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(ingest_ops, "insert_points", locked)
    with pytest.raises(sqlite3.OperationalError):  # TestClient re-raises server errors
        client.post(f"/api/runs/{rid}/batch", json={"points": _points(3)})
