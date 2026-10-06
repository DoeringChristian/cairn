"""``create_app(background_tasks=...)``: only one app per repo runs the
lifespan loops (``cairn server --ui`` builds a second app on the same DB),
and that app holds the repo's ingest lease."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from cairn.sdk.local import LocalTransport
from cairn.server.app import create_app
from cairn.server.storage import lease as lease_mod


def _finished_log(repo):
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "a" * 32})["run_id"]
    t.finish_run(rid, "completed")
    t.close()
    return next((repo / "wals").glob("*.wal.jsonl"))


def _ingested(log, timeout: float) -> bool:
    """A finished log is deleted once ingested."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not log.exists():
            return True
        time.sleep(0.05)
    return False


def test_background_tasks_ingest_logs_under_the_lease(tmp_path):
    repo = tmp_path / ".cairn"
    log = _finished_log(repo)
    with TestClient(create_app(data_dir=repo)):
        assert lease_mod.read_lease(repo.resolve())["mode"] == "server"
        assert _ingested(log, timeout=5)
    assert lease_mod.read_lease(repo.resolve()) is None  # released on shutdown


def test_no_background_tasks_leaves_logs_alone(tmp_path):
    repo = tmp_path / ".cairn"
    log = _finished_log(repo)
    with TestClient(create_app(data_dir=repo, background_tasks=False)):
        assert not _ingested(log, timeout=0.5)
    assert log.exists()
