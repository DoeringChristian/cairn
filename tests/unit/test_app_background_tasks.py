"""``create_app(background_tasks=...)``: only one app per repo runs the
lifespan loops (``cairn server --ui`` builds a second app on the same DB):
crashed-run marking, stale-run reaping, alert delivery, a daemon's idle exit."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from cairn.backend import ingest_ops
from cairn.server.app import create_app
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.db import Database


def _silent_uploaded_run(repo):
    """A running run whose primary log got its last record long ago."""
    db = Database.open(DataDir(repo).db_path)
    try:
        ingest_ops.create_run(db, project="p", run_id="a" * 32)
        db.write(
            "INSERT INTO ingest_progress (run_id, log, applied_seq, updated_at) "
            "VALUES (?, 'main', 3, '2000-01-01T00:00:00+00:00')", ["a" * 32],
        )
    finally:
        db.close()


def _status(app) -> str:
    return app.state.db.read_one("SELECT status FROM runs")[0]


def _wait_for(pred, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        time.sleep(0.05)
    return False


def test_background_tasks_mark_silent_runs_crashed(tmp_path):
    repo = tmp_path / ".cairn"
    _silent_uploaded_run(repo)
    app = create_app(data_dir=repo, auth_enabled=False)
    with TestClient(app):
        assert _wait_for(lambda: _status(app) == "crashed", timeout=5)


def test_no_background_tasks_leaves_runs_alone(tmp_path):
    repo = tmp_path / ".cairn"
    _silent_uploaded_run(repo)
    app = create_app(data_dir=repo, background_tasks=False, auth_enabled=False)
    with TestClient(app):
        assert not _wait_for(lambda: _status(app) == "crashed", timeout=0.5)


def test_idle_daemon_requests_shutdown(tmp_path):
    app = create_app(data_dir=tmp_path / ".cairn", auth_enabled=False)
    stopped = []
    app.state.idle_timeout = 0.2
    app.state.request_shutdown = lambda: stopped.append(True)
    with TestClient(app) as client:
        client.get("/api/health")  # a probe is not activity
        assert _wait_for(lambda: stopped, timeout=5)


def test_requests_keep_a_daemon_alive(tmp_path):
    app = create_app(data_dir=tmp_path / ".cairn", auth_enabled=False)
    stopped = []
    app.state.idle_timeout = 0.6
    app.state.request_shutdown = lambda: stopped.append(True)
    with TestClient(app) as client:
        for _ in range(8):
            client.get("/api/projects")
            time.sleep(0.1)
        assert not stopped
