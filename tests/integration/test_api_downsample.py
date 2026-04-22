"""Server-side downsampling enforced on sequence GETs."""

from __future__ import annotations

import math
from datetime import datetime, timezone


def test_many_scalars_get_downsampled(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    now = datetime.now(timezone.utc).isoformat()
    points = [
        {
            "name": "loss",
            "step": i,
            "wall_time": now,
            "object_type": "scalar",
            "scalar_value": math.sin(i / 10.0),
        }
        for i in range(5000)
    ]
    # DuckDB prepared-statement limit — send in chunks.
    for start in range(0, len(points), 1000):
        client.post(
            f"/api/runs/{rid}/batch", json={"points": points[start : start + 1000]}
        )

    r = client.get(f"/api/runs/{rid}/sequences/loss?max_points=200")
    pts = r.json()["points"]
    assert 150 <= len(pts) <= 200


def test_max_points_greater_than_series_returns_all(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    now = datetime.now(timezone.utc).isoformat()
    client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                {
                    "name": "x",
                    "step": i,
                    "wall_time": now,
                    "object_type": "scalar",
                    "scalar_value": float(i),
                }
                for i in range(10)
            ]
        },
    )
    r = client.get(f"/api/runs/{rid}/sequences/x?max_points=1000")
    assert len(r.json()["points"]) == 10


def test_step_range_filter(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    now = datetime.now(timezone.utc).isoformat()
    client.post(
        f"/api/runs/{rid}/batch",
        json={
            "points": [
                {
                    "name": "x",
                    "step": i,
                    "wall_time": now,
                    "object_type": "scalar",
                    "scalar_value": float(i),
                }
                for i in range(20)
            ]
        },
    )
    r = client.get(f"/api/runs/{rid}/sequences/x?step_from=5&step_to=10")
    steps = [p["step"] for p in r.json()["points"]]
    assert steps == list(range(5, 11))
