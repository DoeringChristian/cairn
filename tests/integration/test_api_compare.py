"""Compare endpoint."""

from __future__ import annotations

from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc).isoformat()


def test_compare_two_runs(client):
    rid1 = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    rid2 = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    for rid, scale in [(rid1, 1.0), (rid2, 2.0)]:
        client.post(
            f"/api/runs/{rid}/batch",
            json={
                "points": [
                    {
                        "name": "loss",
                        "step": i,
                        "wall_time": _now(),
                        "object_type": "scalar",
                        "scalar_value": float(i) * scale,
                    }
                    for i in range(5)
                ]
            },
        )
    r = client.post(
        "/api/compare", json={"run_ids": [rid1, rid2], "metrics": ["loss"]}
    )
    series = r.json()["series"]
    assert len(series) == 2
    by_run = {s["run_id"]: s["points"] for s in series}
    assert by_run[rid1][-1]["value"] == 4.0
    assert by_run[rid2][-1]["value"] == 8.0


def test_compare_empty_inputs(client):
    r = client.post("/api/compare", json={"run_ids": [], "metrics": []})
    assert r.json() == {"series": []}
