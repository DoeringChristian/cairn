"""Per-metric scalar stats on GET /api/runs?include=stats and GET /api/runs/{id}."""

from __future__ import annotations

import pytest

from cairn.server import ingest_ops

WALL = "2024-01-01T00:00:00+00:00"


def _run(client, project="p") -> str:
    return client.post("/api/runs", json={"project": project}).json()["run_id"]


def _points(app, rid, name, pts, object_type="scalar"):
    # Through the ingest path: it maintains the metric_stats index the stats
    # are read from.
    ingest_ops.insert_batch(app.state.db, rid, [
        {"name": name, "step": step, "wall_time": WALL,
         "object_type": object_type, "scalar_value": v}
        for step, v in pts
    ])


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
        "mean": pytest.approx(2.5), "first_step": 0, "last_step": 9,
    }}


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
    # The rule is the project's (metric-rules), not a per-run stat; b's "max"
    # makes it the project's summary, so a's value is its max too.
    assert "rule" not in by_id[a]["stats"]["loss"]
    assert by_id[a]["values"]["loss"] == 1.0
    assert "params" in by_id[a]


def test_run_without_metrics_has_empty_stats(client):
    rid = _run(client)
    assert client.get(f"/api/runs/{rid}").json()["run"]["stats"] == {}
    runs = client.get("/api/runs", params={"include": "stats"}).json()["runs"]
    assert runs[0]["stats"] == {}


def test_ids_filter(app, client):
    """The UI polls just its running runs: ``ids=`` narrows the list (and
    ``total``) to those runs, within the other filters."""
    a, b, c = _run(client), _run(client), _run(client, project="q")
    _points(app, a, "loss", [(0, 1.0)])
    body = client.get(
        "/api/runs", params={"project": "p", "ids": f"{a},{c}", "include": "stats"},
    ).json()
    assert [r["id"] for r in body["runs"]] == [a]
    assert body["total"] == 1
    assert body["runs"][0]["stats"]["loss"]["last"] == 1.0
    assert client.get("/api/runs", params={"ids": ""}).json()["total"] == 0
    both = client.get("/api/runs", params={"ids": f"{a}, {b}"}).json()
    assert {r["id"] for r in both["runs"]} == {a, b}
