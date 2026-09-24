"""Sweeps: sweep_ops, the routes, LocalTransport (direct; WAL refuses), the
SDK's env pickup, and cairn.sweep(...).run."""

from __future__ import annotations

import math

import pytest

import cairn
from cairn.sdk.local import LocalTransport
from cairn.server import sweep_ops
from cairn.server.storage.db import Database

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)


@pytest.fixture
def db(tmp_path):
    d = Database.open(tmp_path / "db.sqlite")
    yield d
    d.close()


# ---- sweep_ops ------------------------------------------------------------------


def test_space_validation():
    assert sweep_ops.normalize_space({"a": 3, "b": {"value": "x"}}) == {
        "a": {"distribution": "constant", "value": 3},
        "b": {"distribution": "constant", "value": "x"},
    }
    assert sweep_ops.normalize_space({"n": {"min": 1, "max": 4}})["n"]["distribution"] == "int_uniform"
    assert sweep_ops.normalize_space({"x": {"min": 0, "max": 1.0}})["x"]["distribution"] == "uniform"
    for bad in ({}, {"a": {"values": []}}, {"a": {"min": 2, "max": 1}},
                {"a": {"min": 0, "max": 1, "distribution": "log_uniform"}}, {"a": {"foo": 1}}):
        with pytest.raises(ValueError):
            sweep_ops.normalize_space(bad)


def test_create_rejects_bad_sweeps(db):
    with pytest.raises(ValueError, match="method"):
        sweep_ops.create_sweep(db, project="p", space={"a": 1}, method="nope")
    with pytest.raises(ValueError, match="grid"):
        sweep_ops.create_sweep(db, project="p", space={"a": {"min": 0, "max": 1}}, method="grid")
    with pytest.raises(ValueError, match="metric"):
        sweep_ops.create_sweep(db, project="p", space={"a": {"values": [1]}}, method="bayes")


def test_grid_walks_the_product_then_finishes(db):
    sw = sweep_ops.create_sweep(db, project="P", space={"a": {"values": [1, 2]}, "b": {"values": ["x", "y"]}, "c": 0},
                                method="grid")
    assert sw["project_id"] == "p" and sw["status"] == "running"
    seen = []
    for _ in range(4):
        claim = sweep_ops.next_trial(db, sw["id"])
        assert claim["status"] == "running"
        seen.append(claim["trial"]["params"])
    assert seen == [{"a": 1, "b": "x", "c": 0}, {"a": 1, "b": "y", "c": 0},
                    {"a": 2, "b": "x", "c": 0}, {"a": 2, "b": "y", "c": 0}]
    assert sweep_ops.next_trial(db, sw["id"]) == {"status": "finished", "trial": None}
    assert sweep_ops.get_sweep(db, sw["id"])["status"] == "finished"


def test_random_samples_inside_the_space(db):
    sw = sweep_ops.create_sweep(db, project="p", space={
        "lr": {"min": 1e-4, "max": 1e-1, "distribution": "log_uniform"},
        "n": {"min": 1, "max": 3}, "opt": {"values": ["a", "b"]},
    })
    for _ in range(20):
        p = sweep_ops.next_trial(db, sw["id"])["trial"]["params"]
        assert 1e-4 <= p["lr"] <= 1e-1 and p["n"] in (1, 2, 3) and p["opt"] in ("a", "b")


def test_bayes_learns_from_completed_trials(db):
    pytest.importorskip("optuna")
    sw = sweep_ops.create_sweep(db, project="p", space={"x": {"min": -5.0, "max": 5.0}, "k": 1},
                                method="bayes", metric="loss", goal="minimize")
    for _ in range(15):
        t = sweep_ops.next_trial(db, sw["id"])["trial"]
        assert -5 <= t["params"]["x"] <= 5 and t["params"]["k"] == 1
        sweep_ops.report_trial(db, sw["id"], t["id"], status="completed", value=(t["params"]["x"] - 2) ** 2)
    best = sweep_ops.get_sweep(db, sw["id"])["best"]
    assert best["value"] == min(t["value"] for t in sweep_ops.get_sweep(db, sw["id"])["trials"])


def test_pause_resume_cancel(db):
    sw = sweep_ops.create_sweep(db, project="p", space={"a": {"values": [1, 2, 3]}})
    assert sweep_ops.set_status(db, sw["id"], "pause")["status"] == "paused"
    assert sweep_ops.next_trial(db, sw["id"]) == {"status": "paused", "trial": None}
    assert sweep_ops.set_status(db, sw["id"], "resume")["status"] == "running"
    assert sweep_ops.next_trial(db, sw["id"])["trial"] is not None
    assert sweep_ops.set_status(db, sw["id"], "cancel")["status"] == "cancelled"
    with pytest.raises(ValueError):
        sweep_ops.set_status(db, sw["id"], "resume")
    with pytest.raises(ValueError):
        sweep_ops.set_status(db, sw["id"], "explode")
    with pytest.raises(LookupError):
        sweep_ops.next_trial(db, "missing")


def test_report_links_the_first_run_and_reads_the_metric(db):
    from cairn.server import ingest_ops

    sw = sweep_ops.create_sweep(db, project="p", space={"a": 1}, metric="loss", goal="minimize")
    t = sweep_ops.next_trial(db, sw["id"])["trial"]
    rid = ingest_ops.create_run(db, project="p", sweep_id=sw["id"])["run_id"]
    other = ingest_ops.create_run(db, project="p")["run_id"]
    ingest_ops.insert_batch(db, rid, [
        {"name": "loss", "step": s, "wall_time": "2024-01-01T00:00:00+00:00", "scalar_value": v,
         "object_type": "scalar"}
        for s, v in enumerate([3.0, 2.0, 1.5])
    ])
    assert sweep_ops.report_trial(db, sw["id"], t["id"], run_id=rid, status="running")["run_id"] == rid
    # A second run can't steal the trial; the value comes from the run's last point.
    done = sweep_ops.report_trial(db, sw["id"], t["id"], run_id=other, status="completed")
    assert (done["run_id"], done["status"], done["value"]) == (rid, "completed", 1.5)
    # A summary outranks the last point.
    ingest_ops.set_summary(db, rid, {"loss": 0.5})
    t2 = sweep_ops.next_trial(db, sw["id"])["trial"]
    assert sweep_ops.report_trial(db, sw["id"], t2["id"], run_id=rid, status="completed")["value"] == 0.5
    with pytest.raises(LookupError):
        sweep_ops.report_trial(db, sw["id"], "nope", status="failed")


# ---- HTTP -------------------------------------------------------------------------


def test_routes(client):
    body = {"project": "p", "parameters": {"a": {"values": [1, 2]}}, "method": "grid",
            "metric": "loss", "command": ["python", "train.py"], "name": "first"}
    sw = client.post("/api/sweeps", json=body).json()
    assert sw["command"] == "python train.py" and sw["space"] == body["parameters"]
    sid = sw["id"]
    assert [s["id"] for s in client.get("/api/sweeps", params={"project": "p"}).json()["sweeps"]] == [sid]
    assert client.get("/api/sweeps", params={"project": "other"}).json()["sweeps"] == []

    t = client.post(f"/api/sweeps/{sid}/next").json()["trial"]
    assert t["params"] == {"a": 1}
    r = client.post(f"/api/sweeps/{sid}/trials/{t['id']}/report", json={"status": "completed", "value": 0.25})
    assert r.json()["value"] == 0.25
    detail = client.get(f"/api/sweeps/{sid}").json()
    assert detail["counts"] == {"completed": 1} and detail["best"]["id"] == t["id"]
    assert detail["trials"][0]["params"] == {"a": 1}

    assert client.post(f"/api/sweeps/{sid}/pause").json()["status"] == "paused"
    assert client.post(f"/api/sweeps/{sid}/next").json() == {"status": "paused", "trial": None}
    assert client.post(f"/api/sweeps/{sid}/resume").json()["status"] == "running"
    assert client.post(f"/api/sweeps/{sid}/cancel").json()["status"] == "cancelled"

    assert client.post(f"/api/sweeps/{sid}/explode").status_code == 404
    assert client.get("/api/sweeps/missing").status_code == 404
    assert client.post("/api/sweeps", json={**body, "method": "nope"}).status_code == 400
    assert client.post(f"/api/sweeps/{sid}/trials/nope/report", json={}).status_code == 404


def test_runs_list_filters_by_sweep(client):
    sid = client.post("/api/sweeps", json={"project": "p", "parameters": {"a": 1}}).json()["id"]
    rid = client.post("/api/runs", json={"project": "p", "sweep_id": sid}).json()["run_id"]
    client.post("/api/runs", json={"project": "p"})
    assert [r["id"] for r in client.get("/api/runs", params={"sweep_id": sid}).json()["runs"]] == [rid]


# ---- LocalTransport ------------------------------------------------------------------


def test_local_direct_transport(tmp_path):
    t = LocalTransport(tmp_path / ".cairn")
    try:
        sw = t.create_sweep({"project": "P", "parameters": {"a": {"values": [1]}}, "method": "grid"})
        assert [s["id"] for s in t.list_sweeps("P")] == [sw["id"]]
        trial = t.next_trial(sw["id"])["trial"]
        assert t.report_trial(sw["id"], trial["id"], status="completed", value=1.0)["value"] == 1.0
        assert t.next_trial(sw["id"])["status"] == "finished"
        assert t.sweep_action(sw["id"], "cancel")["status"] == "finished"
        assert t.get_sweep(sw["id"])["trial_count"] == 1
    finally:
        t.close()


def test_local_wal_transport_refuses_with_a_hint(tmp_path):
    t = LocalTransport(tmp_path / ".cairn", use_wal=True)
    try:
        with pytest.raises(RuntimeError, match="server or a direct-mode repo"):
            t.next_trial("x")
    finally:
        t.close()


# ---- SDK --------------------------------------------------------------------------------


def test_run_joins_the_trial_from_env(tmp_path, monkeypatch):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    sw = t.create_sweep({"project": "p", "parameters": {"lr": {"values": [0.5]}}, "metric": "loss"})
    trial = t.next_trial(sw["id"])["trial"]
    t.close()

    monkeypatch.setenv("CAIRN_SWEEP_ID", sw["id"])
    monkeypatch.setenv("CAIRN_TRIAL_ID", trial["id"])
    with cairn.Run(project="p", repo=repo, **QUIET) as run:
        run.track(0.1, name="loss", step=0)

    reader = cairn.Reader(repo=repo)
    try:
        r = reader.run(run.id)
        assert r._raw["sweep_id"] == sw["id"]
        assert r.params["lr"] == 0.5
    finally:
        reader.close()
    t = LocalTransport(repo)
    try:
        assert t.get_sweep(sw["id"])["trials"][0]["run_id"] == run.id
    finally:
        t.close()


def _quadratic(config, run):
    for step in range(3):
        run.track((config["x"] - 1) ** 2 + step, name="loss", step=step)


def test_python_sweep_runs_trials_in_process(tmp_path):
    repo = tmp_path / ".cairn"
    sw = cairn.sweep({"x": {"values": [0, 1, 2]}}, project="p", metric="loss", method="grid", repo=repo)
    seen_runs = []

    def train(config, run):
        seen_runs.append(run.id)
        _quadratic(config, run)

    trials = sw.run(train, count=2, **QUIET)
    assert [t["params"]["x"] for t in trials] == [0, 1]
    # No return value: the value is the run's last "loss".
    assert [t["value"] for t in trials] == [3.0, 2.0]
    assert [t["run_id"] for t in trials] == seen_runs

    # A number returned is the value; a raising fn fails its trial and the sweep goes on.
    def boom(config):
        raise RuntimeError("bad trial")

    assert [t["status"] for t in sw.run(boom, **QUIET)] == ["failed"]
    assert sw.info()["status"] == "finished"
    assert sw.best["params"] == {"x": 1}

    sw2 = cairn.sweep({"x": {"min": 0.0, "max": 1.0}}, project="p", repo=repo)
    (t,) = sw2.run(lambda c: c["x"] * 10, count=1, **QUIET)
    assert math.isclose(t["value"], t["params"]["x"] * 10)


def test_python_sweep_with_worker_processes(tmp_path):
    repo = tmp_path / ".cairn"
    sw = cairn.sweep({"x": {"values": [0, 1, 2, 3]}}, project="p", metric="loss", method="grid", repo=repo)
    trials = sw.run(_quadratic, count=4, workers=2, **QUIET)
    assert sorted(t["params"]["x"] for t in trials) == [0, 1, 2, 3]
    assert all(t["status"] == "completed" and t["run_id"] for t in trials)
