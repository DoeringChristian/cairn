"""Concurrent batch POSTs must not lose data or error."""

from __future__ import annotations

import threading
from datetime import datetime, timezone


def test_concurrent_batch_posts(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    now = datetime.now(timezone.utc).isoformat()
    errors: list[Exception] = []

    def worker(tid: int) -> None:
        try:
            points = [
                {
                    "name": "loss",
                    "step": tid * 100 + i,
                    "wall_time": now,
                    "object_type": "scalar",
                    "scalar_value": float(i),
                }
                for i in range(50)
            ]
            r = client.post(f"/api/runs/{rid}/batch", json={"points": points})
            assert r.status_code == 200
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    r = client.get(f"/api/runs/{rid}/sequences/loss?max_points=100000")
    assert len(r.json()["points"]) == 20 * 50
