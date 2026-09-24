"""``create_app(background_tasks=...)``: only one app per repo runs the
lifespan loops (``cairn server --ui`` builds a second app on the same DB)."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from cairn.sdk.local import LocalTransport
from cairn.server.app import create_app


def _finished_wal(repo):
    t = LocalTransport(repo, use_wal=True)
    rid = t.create_run({"project": "p", "run_id": "a" * 32})["run_id"]
    t.finish_run(rid, "completed")
    t.close()
    return next((repo / "wals").glob("*.wal.jsonl"))


def _drained(wal, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if wal.with_suffix(".done").exists():
            return True
        time.sleep(0.05)
    return False


def test_background_tasks_drain_wals(tmp_path):
    repo = tmp_path / ".cairn"
    wal = _finished_wal(repo)
    with TestClient(create_app(data_dir=repo)):
        assert _drained(wal, timeout=5)


def test_no_background_tasks_leaves_wals_alone(tmp_path):
    repo = tmp_path / ".cairn"
    wal = _finished_wal(repo)
    with TestClient(create_app(data_dir=repo, background_tasks=False)):
        assert not _drained(wal, timeout=0.5)
    assert wal.exists()
