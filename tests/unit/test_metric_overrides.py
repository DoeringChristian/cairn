"""Project overrides of metric rules (``cairn.server.metric_rules``): the one
effective-rule resolver (shared vectors with cairn-ui), the newest run's
logged rule, values under overrides, the routes and their roles, sweeps'
default goal and ``Reader.metric_rules``."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import cairn
from cairn.server import auth as auth_core
from cairn.server import ingest_ops, metric_rules, sweep_ops
from cairn.server.app import create_app
from cairn_ui.cards import spec as _cs

_VECTORS = Path(_cs.__file__).resolve().parents[2] / "docs" / "schemas" / "metric-rule-vectors.json"
_CASES = json.loads(_VECTORS.read_text())["cases"]


@pytest.mark.parametrize("case", _CASES, ids=lambda c: f"{c['override']}|{c['logged']}")
def test_effective_rule_vectors(case):
    assert metric_rules.effective_rule(case["override"], case["logged"]) == case["expected"]


def test_effective_rule_semantics():
    eff = metric_rules.effective_rule
    assert eff(None, None) == {"summary": None, "goal": "none"}
    assert eff(None, "min") == {"summary": "min", "goal": "lower"}
    assert eff(None, "mean") == {"summary": "mean", "goal": "none"}
    # Showing the last value keeps a logged min's direction.
    assert eff({"summary": "last"}, "min") == {"summary": "last", "goal": "lower"}
    # The effective summary's direction beats the logged one's.
    assert eff({"summary": "max"}, "min") == {"summary": "max", "goal": "higher"}
    assert eff({"goal": "none"}, "max") == {"summary": "max", "goal": "none"}
    assert eff({"goal": "higher"}, None) == {"summary": None, "goal": "higher"}


def _pts(name, values):
    return [
        {"name": name, "step": i, "wall_time": "2024-01-01T00:00:00+00:00",
         "object_type": "scalar", "scalar_value": v}
        for i, v in enumerate(values)
    ]


def test_newest_runs_rule_applies_to_every_run(fresh_db):
    db = fresh_db
    old = ingest_ops.create_run(db, project="p")["run_id"]
    new = ingest_ops.create_run(db, project="p")["run_id"]
    bare = ingest_ops.create_run(db, project="p")["run_id"]
    elsewhere = ingest_ops.create_run(db, project="q")["run_id"]
    for rid in (old, new, bare, elsewhere):
        ingest_ops.insert_batch(db, rid, _pts("loss", [3.0, 1.0, 2.0]))
    ingest_ops.set_metric_rule(db, old, "loss", summary="max")
    ingest_ops.set_metric_rule(db, new, "loss", summary="min")
    db.write("UPDATE runs SET created_at = '2020-01-01' WHERE id = ?", [old])

    assert metric_rules.project_rules(db, ["p"]) == {"p": {"loss": {"summary": "min", "goal": "lower"}}}
    values = metric_rules.resolved_values(db, [old, new, bare, elsewhere])
    assert [values[r]["loss"] for r in (old, new, bare)] == [1.0, 1.0, 1.0]
    assert values[elsewhere]["loss"] == 2.0  # another project: no rule

    metric_rules.set_override(db, "p", "loss", summary="mean", goal=None)
    values = metric_rules.resolved_values(db, [old, bare])
    assert values[old]["loss"] == pytest.approx(2.0) and values[bare]["loss"] == pytest.approx(2.0)
    assert metric_rules.project_rules(db, ["p"])["p"]["loss"] == {"summary": "mean", "goal": "lower"}

    # An explicit summary key still wins.
    ingest_ops.set_summary(db, bare, {"loss": 7.0})
    assert metric_rules.resolved_values(db, [bare])[bare]["loss"] == 7.0

    metric_rules.set_override(db, "p", "loss", summary=None, goal=None)
    assert metric_rules.overrides(db, ["p"]) == {"p": {}}
    with pytest.raises(ValueError):
        metric_rules.set_override(db, "p", "loss", summary="median", goal=None)
    with pytest.raises(ValueError):
        metric_rules.set_override(db, "p", "loss", summary=None, goal="up")


def test_routes(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/batch", json={"points": _pts("val/acc", [0.5, 0.9, 0.7])})
    client.post(f"/api/runs/{rid}/metric-rules", json={"name": "val/acc", "summary": "max"})
    url = "/api/projects/p/metric-rules"

    body = client.get(url).json()
    assert body["logged"] == {"val/acc": "max"}
    assert body["overrides"] == {}
    assert body["rules"] == {"val/acc": {"summary": "max", "goal": "higher"}}
    assert client.get(f"/api/runs/{rid}").json()["run"]["values"]["val/acc"] == 0.9

    r = client.put(f"{url}/val/acc", json={"summary": "last"})
    assert r.status_code == 200, r.text
    assert r.json()["rules"]["val/acc"] == {"summary": "last", "goal": "higher"}
    assert r.json()["overrides"] == {"val/acc": {"summary": "last", "goal": None}}
    assert client.get(f"/api/runs/{rid}").json()["run"]["values"]["val/acc"] == 0.7
    listed = client.get("/api/runs", params={"project": "p"}).json()["runs"]
    assert listed[0]["values"]["val/acc"] == 0.7

    # An override of a metric nobody logged a rule for.
    assert client.put(f"{url}/train.loss", json={"goal": "lower"}).json()["rules"]["train.loss"] == {
        "summary": None, "goal": "lower",
    }
    assert client.put(f"{url}/x", json={"summary": "median"}).status_code == 400
    assert client.get("/api/projects/nope/metric-rules").status_code == 404

    r = client.delete(f"{url}/val/acc")
    assert r.json()["rules"]["val/acc"] == {"summary": "max", "goal": "higher"}
    assert client.get(f"/api/runs/{rid}").json()["run"]["values"]["val/acc"] == 0.9


def test_writes_need_the_write_role(tmp_path):
    app = create_app(data_dir=tmp_path / "cairn", auth_enabled=True)
    with TestClient(app) as c:
        _i, write = auth_core.create_token(app.state.db, name="w", role="write")
        _i, read = auth_core.create_token(app.state.db, name="r", role="read")
        w = {"Authorization": f"Bearer {write}"}
        r = {"Authorization": f"Bearer {read}"}
        c.post("/api/runs", json={"project": "p"}, headers=w)
        assert c.get("/api/projects/p/metric-rules", headers=r).status_code == 200
        assert c.put("/api/projects/p/metric-rules/loss", json={"goal": "lower"}, headers=r).status_code == 403
        assert c.delete("/api/projects/p/metric-rules/loss", headers=r).status_code == 403
        assert c.put("/api/projects/p/metric-rules/loss", json={"goal": "lower"}, headers=w).status_code == 200
        assert c.delete("/api/projects/p/metric-rules/loss", headers=w).status_code == 200


def test_sweep_default_goal_reads_the_rule(fresh_db):
    db = fresh_db
    space = {"lr": {"values": [1, 2]}}
    assert sweep_ops.create_sweep(db, project="p", space=space, metric="acc")["goal"] == "minimize"
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    ingest_ops.set_metric_rule(db, rid, "acc", summary="max")
    assert sweep_ops.create_sweep(db, project="p", space=space, metric="acc")["goal"] == "maximize"
    metric_rules.set_override(db, "p", "acc", summary=None, goal="lower")
    assert sweep_ops.create_sweep(db, project="p", space=space, metric="acc")["goal"] == "minimize"
    # An explicit goal wins.
    metric_rules.set_override(db, "p", "acc", summary=None, goal=None)
    assert sweep_ops.create_sweep(db, project="p", space=space, metric="acc", goal="minimize")["goal"] == "minimize"


def test_reader_metric_rules_and_final(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run("p", repo=str(repo), capture_source=False, capture_stdout=False,
                   capture_env=False, capture_system_metrics=False) as run:
        for step, v in enumerate([3.0, 1.0, 2.0]):
            run.track(v, "loss", step, summary="min")
        rid = run.id
    with cairn.Reader(str(repo)) as reader:
        assert reader.metric_rules("p") == {"loss": {"summary": "min", "goal": "lower"}}
        assert reader.run(rid).final["loss"] == 1.0
