"""Per-metric scalar stats on GET /api/runs?include=stats and GET /api/runs/{id}."""

from __future__ import annotations

import pytest

WALL = "2024-01-01T00:00:00+00:00"


def _run(client, project="p") -> str:
    return client.post("/api/runs", json={"project": project}).json()["run_id"]


def _points(app, rid, name, pts, object_type="scalar"):
    app.state.db.executemany(
        """INSERT INTO sequences (run_id, name, step, wall_time, object_type, scalar_value)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [(rid, name, step, WALL, object_type, v) for step, v in pts],
    )


def _rule(app, rid, name, summary):
    app.state.db.write(
        "INSERT INTO metric_defs (run_id, name, x, summary) VALUES (?, ?, NULL, ?)",
        [rid, name, summary],
    )


def test_stats_on_run_detail(app, client):
    rid = _run(client)
    # Inserted out of step order: first/last follow the step, not insertion.
    _points(app, rid, "loss", [(5, 1.0), (0, 4.0), (2, 2.0), (9, 3.0)])
    _rule(app, rid, "loss", "min")

    stats = client.get(f"/api/runs/{rid}").json()["run"]["stats"]
    assert stats == {"loss": {
        "count": 4, "first": 4.0, "last": 3.0, "min": 1.0, "max": 4.0,
        "mean": pytest.approx(2.5), "first_step": 0, "last_step": 9, "rule": "min",
    }}


def test_rule_is_none_without_metric_def(app, client):
    rid = _run(client)
    _points(app, rid, "acc", [(0, 0.5)])
    assert client.get(f"/api/runs/{rid}").json()["run"]["stats"]["acc"]["rule"] is None


def test_non_scalar_sequences_are_excluded(app, client):
    rid = _run(client)
    _points(app, rid, "img", [(0, None), (1, None)], object_type="image")
    # A scalar series with a null (NaN) point: the point is skipped, and the
    # first/last come from the remaining steps.
    _points(app, rid, "loss", [(0, None), (1, 2.0), (2, 1.0), (3, None)])
    stats = client.get(f"/api/runs/{rid}").json()["run"]["stats"]
    assert set(stats) == {"loss"}
    assert stats["loss"]["count"] == 2
    assert (stats["loss"]["first_step"], stats["loss"]["last_step"]) == (1, 2)
    assert (stats["loss"]["first"], stats["loss"]["last"]) == (2.0, 1.0)


def test_list_includes_stats_only_when_asked(app, client):
    a, b = _run(client), _run(client)
    _points(app, a, "loss", [(0, 1.0), (1, 0.5)])
    _points(app, b, "loss", [(0, 3.0)])
    _rule(app, b, "loss", "max")

    plain = client.get("/api/runs", params={"project": "p"}).json()["runs"]
    assert all("stats" not in r for r in plain)

    runs = client.get("/api/runs", params={"project": "p", "include": "params,stats"}).json()["runs"]
    by_id = {r["id"]: r for r in runs}
    assert by_id[a]["stats"]["loss"]["last"] == 0.5
    assert by_id[a]["stats"]["loss"]["count"] == 2
    assert by_id[a]["stats"]["loss"]["rule"] is None
    assert by_id[b]["stats"]["loss"]["rule"] == "max"
    assert "params" in by_id[a]


def test_run_without_metrics_has_empty_stats(client):
    rid = _run(client)
    assert client.get(f"/api/runs/{rid}").json()["run"]["stats"] == {}
    runs = client.get("/api/runs", params={"include": "stats"}).json()["runs"]
    assert runs[0]["stats"] == {}
