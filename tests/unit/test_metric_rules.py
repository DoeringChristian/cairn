"""Metric rules: ``run.track(..., summary=, x=)`` on every write path, the
send-only-on-change cache, scope prefixing, scalar-only validation, and the
read-time resolution order (explicit summary key > rule > last point)."""

from __future__ import annotations

import numpy as np
import pytest

import cairn
from cairn.server import ingest_ops
from cairn.server.query_resolver import _final_metric
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.summary_rules import resolve_summary_rules
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


def _rules(db, rid):
    return db.read_columns(
        "SELECT name, x, summary FROM metric_defs WHERE run_id = ? ORDER BY name",
        [rid],
    )


class Head:
    """A component that declares its own rule."""

    def __init__(self, acc):
        self.acc = acc

    def __cairn_track__(self, scope):
        scope.track(self.acc, "acc", summary="max", x="epoch")


def _spy(run):
    """Count the rules the run sends, still forwarding them."""
    sent = []
    real = run._transport.set_metric_rule

    def spy(run_id, name, x, summary):
        sent.append((name, x, summary))
        real(run_id, name, x, summary)

    run._transport.set_metric_rule = spy
    return sent


def _scenario(run):
    """Returns the rules the run sent."""
    sent = _spy(run)
    for step, v in enumerate([3.0, 1.0, 2.0]):
        run.track(step, "epoch", step)
        # The same rule on every call reaches the server once.
        run.track(v, "loss", step, summary="min", x="epoch")
        # The rule's name is prefixed ("model.acc"); x is not.
        run.track(Head(0.1 * step), "model", step)
    # A different rule re-sends and wins; no keywords leave it alone.
    run.track(0.3, "val.f1", 0, summary="mean")
    run.track(0.5, "val.f1", 1, summary="max")
    run.track(0.1, "val.f1", 2)
    return sent


SENT = [
    ("loss", "epoch", "min"),
    ("model.acc", "epoch", "max"),
    ("val.f1", None, "mean"),
    ("val.f1", None, "max"),
]
EXPECTED = [
    {"name": "loss", "x": "epoch", "summary": "min"},
    {"name": "model.acc", "x": "epoch", "summary": "max"},
    {"name": "val.f1", "x": None, "summary": "max"},
]


def test_sdk_over_http(client):
    t = Transport("http://testserver", client=client, max_retries=1)
    with cairn.Run(project="p", transport=t, **QUIET) as run:
        assert _scenario(run) == SENT
    db = client.app.state.db
    assert _rules(db, run.id) == EXPECTED
    values = client.get(f"/api/runs/{run.id}").json()["run"]["values"]
    assert values["loss"] == 1.0
    assert values["model.acc"] == pytest.approx(0.2)
    assert values["val.f1"] == 0.5


@pytest.mark.parametrize("local_wal", [False, True])
def test_sdk_local(tmp_path, local_wal):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="p", repo=repo, local_wal=local_wal, **QUIET) as run:
        assert _scenario(run) == SENT
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    try:
        ingest_all(dd, db, BlobStore(dd.artifacts_dir))  # replays the WAL
        assert _rules(db, run.id) == EXPECTED
    finally:
        db.close()


def test_scope_prefixes_the_name_but_not_x(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        sent = _spy(run)
        scope = run.scope(step=0).scope("enc")
        scope.track(1.0, "loss", summary="min", x="train.epoch")
    assert sent == [("enc.loss", "train.epoch", "min")]


def test_rules_are_scalar_only(tmp_path):
    repo = tmp_path / ".cairn"
    img = cairn.Image(np.zeros((4, 4, 3), dtype=np.uint8))
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        sent = _spy(run)
        with pytest.raises(ValueError, match="scalar"):
            run.track(cairn.Text("hi"), "note", 0, summary="last")
        with pytest.raises(ValueError, match="scalar"):
            run.track(img, "pred", 0, x="epoch")
        with pytest.raises(ValueError, match="scalar"):
            run.track([img, img], "gallery", 0, summary="max")
        with pytest.raises(ValueError, match="scalar"):
            run.track(Head(0.5), "model", 0, summary="max")  # a component
        with pytest.raises(ValueError, match="summary"):
            run.track(1.0, "loss", 0, summary="median")
        # Wrapped media without rules still logs.
        run.track(cairn.Text("hi"), "note", 0)
    assert sent == []


def test_disabled_run_swallows_rules():
    run = cairn.Run(project="p", mode="disabled")
    run.track(1.0, "loss", 0, summary="min", x="epoch")
    assert not hasattr(run, "define_metric")
    assert not hasattr(cairn.Run, "define_metric")


def test_resolution_order_and_exact_names(fresh_db):
    db = fresh_db
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    other = ingest_ops.create_run(db, project="p")["run_id"]
    ingest_ops.insert_batch(db, rid, _pts("loss", [3.0, 1.0, 2.0]))
    ingest_ops.insert_batch(db, rid, _pts("val.acc", [0.5, 0.9, 0.7]))
    ingest_ops.insert_batch(db, rid, _pts("val.f1", [0.2, 0.4]))
    ingest_ops.insert_batch(db, rid, _pts("lr", [1.0, 0.5]))
    ingest_ops.insert_batch(db, other, _pts("loss", [3.0, 1.0, 2.0]))
    ingest_ops.set_metric_rule(db, rid, "loss", summary="min")
    ingest_ops.set_metric_rule(db, rid, "val.f1", summary="mean")
    ingest_ops.set_metric_rule(db, rid, "val.*", summary="max")  # not a glob
    ingest_ops.set_metric_rule(db, rid, "lr", x="epoch")  # no summary rule

    assert resolve_summary_rules(db, [rid, other]) == {
        rid: {"loss": 1.0, "val.f1": pytest.approx(0.3)},
    }
    assert _final_metric(db, rid, "loss") == 1.0
    assert _final_metric(db, rid, "val.acc") == 0.7  # no exact rule: last
    assert _final_metric(db, other, "loss") == 2.0

    ingest_ops.set_metric_rule(db, rid, "loss", summary="last")
    assert resolve_summary_rules(db, [rid])[rid]["loss"] == 2.0
    with pytest.raises(ValueError):
        ingest_ops.set_metric_rule(db, rid, "loss", summary="median")
    with pytest.raises(ingest_ops.RunNotFound):
        ingest_ops.set_metric_rule(db, "nope", "loss")


def test_http_route_and_explicit_summary_wins(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/batch", json={"points": _pts("loss", [3.0, 1.0, 2.0])})
    client.post(f"/api/runs/{rid}/batch", json={"points": _pts("acc", [0.1, 0.9, 0.5])})

    r = client.post(f"/api/runs/{rid}/metric-rules",
                    json={"name": "loss", "x": "epoch", "summary": "min"})
    assert r.status_code == 200, r.text
    client.post(f"/api/runs/{rid}/metric-rules", json={"name": "acc", "summary": "max"})
    client.post(f"/api/runs/{rid}/summary", json={"summary": {"acc": 0.42}})
    assert client.post(f"/api/runs/{rid}/metric-rules",
                       json={"name": "x", "summary": "median"}).status_code == 400
    assert client.post("/api/runs/nope/metric-rules", json={"name": "x"}).status_code == 404

    listed = client.get("/api/runs").json()["runs"][0]
    # The rule replaces the last point; an explicit summary key beats the rule.
    assert listed["values"] == {"loss": 1.0, "acc": 0.42}

    detail = client.get(f"/api/runs/{rid}").json()
    assert detail["metric_defs"] == [
        {"name": "acc", "x": None, "summary": "max"},
        {"name": "loss", "x": "epoch", "summary": "min"},
    ]


def test_fork_copies_rules(fresh_db):
    db = fresh_db
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    ingest_ops.set_metric_rule(db, rid, "val.loss", x="epoch")
    kid = ingest_ops.fork_run(db, parent_id=rid, step=0)["run_id"]
    assert _rules(db, kid) == [{"name": "val.loss", "x": "epoch", "summary": None}]
