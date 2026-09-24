"""define_metric (C2): the op on every write path, the read-time summary
rules, and the metric definitions on the run detail."""

from __future__ import annotations

import pytest

import cairn
from cairn.server import ingest_ops
from cairn.server.query_resolver import _final_metric
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.summary_rules import resolve_summary_rules, rule_for
from cairn.server.wal_ingest import ingest_all
from cairn.sdk.transport import Transport

QUIET = dict(
    capture_source=False, capture_stdout=False, capture_env=False,
    capture_system_metrics=False,
)


@pytest.fixture(autouse=True)
def _reset_active_run():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _pts(name, values):
    return [
        {"name": name, "step": i, "wall_time": "2024-01-01T00:00:00+00:00",
         "object_type": "scalar", "scalar_value": v}
        for i, v in enumerate(values)
    ]


def test_rule_for_prefers_exact_then_the_longest_glob():
    defs = {"val/*": "max", "val/loss*": "min", "acc": "mean"}
    assert rule_for("acc", defs) == "mean"
    assert rule_for("val/acc", defs) == "max"
    assert rule_for("val/loss_x", defs) == "min"
    assert rule_for("train/loss", defs) is None
    assert rule_for("val/loss_x", {**defs, "val/loss_x": "last"}) == "last"


def test_rules_resolve_at_read_time(fresh_db):
    db = fresh_db
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    other = ingest_ops.create_run(db, project="p")["run_id"]
    ingest_ops.insert_batch(db, rid, _pts("loss", [3.0, 1.0, 2.0]))
    ingest_ops.insert_batch(db, rid, _pts("val/acc", [0.5, 0.9, 0.7]))
    ingest_ops.insert_batch(db, rid, _pts("val/f1", [0.2, 0.4]))
    ingest_ops.insert_batch(db, rid, _pts("lr", [1.0, 0.5]))
    ingest_ops.insert_batch(db, other, _pts("loss", [3.0, 1.0, 2.0]))
    ingest_ops.define_metric(db, rid, "loss", summary="min")
    ingest_ops.define_metric(db, rid, "val/*", step_metric="epoch", summary="max")
    ingest_ops.define_metric(db, rid, "val/f1", summary="mean")
    ingest_ops.define_metric(db, rid, "lr", step_metric="epoch")  # no summary rule

    assert resolve_summary_rules(db, [rid, other]) == {
        rid: {"loss": 1.0, "val/acc": 0.9, "val/f1": pytest.approx(0.3)},
    }
    assert _final_metric(db, rid, "loss") == 1.0
    assert _final_metric(db, other, "loss") == 2.0  # no rule: the last point

    # Redefining replaces; a bad kind is refused.
    ingest_ops.define_metric(db, rid, "loss", summary="last")
    assert resolve_summary_rules(db, [rid])[rid]["loss"] == 2.0
    with pytest.raises(ValueError):
        ingest_ops.define_metric(db, rid, "loss", summary="median")
    with pytest.raises(ingest_ops.RunNotFound):
        ingest_ops.define_metric(db, "nope", "loss")


def test_http_route_list_values_and_run_detail(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/batch", json={"points": _pts("loss", [3.0, 1.0, 2.0])})
    client.post(f"/api/runs/{rid}/batch", json={"points": _pts("acc", [0.1, 0.9, 0.5])})

    r = client.post(f"/api/runs/{rid}/metric-defs",
                    json={"name": "loss", "step_metric": "epoch", "summary": "min"})
    assert r.status_code == 200, r.text
    client.post(f"/api/runs/{rid}/metric-defs", json={"name": "acc", "summary": "max"})
    client.post(f"/api/runs/{rid}/summary", json={"summary": {"acc": 0.42}})
    assert client.post(f"/api/runs/{rid}/metric-defs",
                       json={"name": "x", "summary": "median"}).status_code == 400
    assert client.post("/api/runs/nope/metric-defs", json={"name": "x"}).status_code == 404

    listed = client.get("/api/runs").json()["runs"][0]
    # The rule replaces the last point; an explicit summary key beats the rule.
    assert listed["values"] == {"loss": 1.0, "acc": 0.42}

    detail = client.get(f"/api/runs/{rid}").json()
    assert detail["metric_defs"] == [
        {"name": "acc", "step_metric": None, "summary": "max"},
        {"name": "loss", "step_metric": "epoch", "summary": "min"},
    ]
    assert detail["run"]["values"] == {"loss": 1.0, "acc": 0.42}


def _defs(db, rid):
    return db.read_columns(
        "SELECT name, step_metric, summary FROM metric_defs WHERE run_id = ? ORDER BY name",
        [rid],
    )


EXPECTED = [
    {"name": "loss", "step_metric": None, "summary": "min"},
    {"name": "val/*", "step_metric": "epoch", "summary": None},
]


def _define(run):
    run.define_metric("val/*", step_metric="epoch")
    run.define_metric("loss", summary="min")


def test_sdk_over_http(client):
    t = Transport("http://testserver", client=client, max_retries=1)
    with cairn.Run(project="p", transport=t, **QUIET) as run:
        _define(run)
        with pytest.raises(ValueError):
            run.define_metric("loss", summary="median")
    assert _defs(client.app.state.db, run.id) == EXPECTED


@pytest.mark.parametrize("local_wal", [False, True])
def test_sdk_local(tmp_path, local_wal):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="p", repo=repo, local_wal=local_wal, **QUIET) as run:
        _define(run)
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    try:
        ingest_all(dd, db, BlobStore(dd.artifacts_dir))
        assert _defs(db, run.id) == EXPECTED
    finally:
        db.close()


def test_fork_copies_metric_defs(fresh_db):
    db = fresh_db
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    ingest_ops.define_metric(db, rid, "val/*", step_metric="epoch")
    kid = ingest_ops.fork_run(db, parent_id=rid, step=0)["run_id"]
    assert _defs(db, kid) == [{"name": "val/*", "step_metric": "epoch", "summary": None}]
