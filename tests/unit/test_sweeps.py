"""Sweeps: sweep_ops, the routes, LocalTransport (direct; WAL refuses), the
SDK's env pickup, and cairn.sweep(...).run."""

from __future__ import annotations

import json
import math
import sys
import threading
import time

import pytest

import cairn
from cairn.sdk import sweep as sweep_mod
from cairn.sdk.local import LocalTransport
from cairn.sdk.sweep import expand_command
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


def test_trials_are_numbered_and_named_in_creation_order(db):
    sw = sweep_ops.create_sweep(db, project="p", space={"a": {"min": 0.0, "max": 1.0}}, name="lr scan")
    claimed = [sweep_ops.next_trial(db, sw["id"])["trial"] for _ in range(3)]
    assert [(t["index"], t["name"]) for t in claimed] == [
        (1, "lr scan-1"), (2, "lr scan-2"), (3, "lr scan-3"),
    ]
    reported = sweep_ops.report_trial(db, sw["id"], claimed[1]["id"], status="completed", value=0.5)
    assert (reported["index"], reported["name"]) == (2, "lr scan-2")
    info = sweep_ops.get_sweep(db, sw["id"])
    assert [t["index"] for t in info["trials"]] == [1, 2, 3]
    assert info["best"]["name"] == "lr scan-2"
    assert sweep_ops.list_sweeps(db)[0]["best"]["index"] == 2

    # No sweep name: the first six characters of its id.
    anon = sweep_ops.create_sweep(db, project="p", space={"a": {"values": [1]}})
    assert sweep_ops.next_trial(db, anon["id"])["trial"]["name"] == f"{anon['id'][:6]}-1"


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


#: The actions each status allows (wandb's lifecycle); the rest are errors.
ALLOWED = {
    "running": {"pause": "paused", "stop": "stopped", "cancel": "cancelled"},
    "paused": {"resume": "running", "stop": "stopped", "cancel": "cancelled"},
    "stopped": {"cancel": "cancelled"},
    "cancelled": {},
    "finished": {},
}


def _sweep_in(db, status):
    sw = sweep_ops.create_sweep(db, project="p", space={"a": {"values": [1]}}, method="grid")
    if status == "finished":
        sweep_ops.next_trial(db, sw["id"])
        sweep_ops.next_trial(db, sw["id"])
    action = {"paused": "pause", "stopped": "stop", "cancelled": "cancel"}.get(status)
    if action:
        sweep_ops.set_status(db, sw["id"], action)
    assert sweep_ops.get_sweep(db, sw["id"])["status"] == status
    return sw["id"]


@pytest.mark.parametrize("status", list(ALLOWED))
@pytest.mark.parametrize("action", ["pause", "resume", "stop", "cancel"])
def test_lifecycle_transitions(db, status, action):
    sid = _sweep_in(db, status)
    if action in ALLOWED[status]:
        assert sweep_ops.set_status(db, sid, action)["status"] == ALLOWED[status][action]
    else:
        with pytest.raises(ValueError, match=f"cannot {action} a {status} sweep"):
            sweep_ops.set_status(db, sid, action)
        assert sweep_ops.get_sweep(db, sid)["status"] == status


def test_stop_lets_running_trials_finish(db):
    from cairn.server import ingest_ops

    sw = sweep_ops.create_sweep(db, project="p", space={"a": {"min": 0.0, "max": 1.0}})
    t = sweep_ops.next_trial(db, sw["id"])["trial"]
    rid = ingest_ops.create_run(db, project="p", sweep_id=sw["id"])["run_id"]
    sweep_ops.report_trial(db, sw["id"], t["id"], run_id=rid, status="running")
    assert sweep_ops.set_status(db, sw["id"], "stop")["status"] == "stopped"
    assert sweep_ops.next_trial(db, sw["id"]) == {"status": "stopped", "trial": None}
    assert ingest_ops.heartbeat(db, rid) is None  # nobody asked the run to stop
    assert sweep_ops.report_trial(db, sw["id"], t["id"], status="completed")["status"] == "completed"


def test_cancel_kills_running_trials_and_stops_their_runs(db):
    from cairn.server import ingest_ops

    sw = sweep_ops.create_sweep(db, project="p", space={"a": {"min": 0.0, "max": 1.0}})
    done, running, unjoined = (sweep_ops.next_trial(db, sw["id"])["trial"] for _ in range(3))
    done_run = ingest_ops.create_run(db, project="p", sweep_id=sw["id"])["run_id"]
    run = ingest_ops.create_run(db, project="p", sweep_id=sw["id"])["run_id"]
    sweep_ops.report_trial(db, sw["id"], done["id"], run_id=done_run, status="completed")
    sweep_ops.report_trial(db, sw["id"], running["id"], run_id=run, status="running")
    # A stopped sweep can still be cancelled to end its running trials.
    sweep_ops.set_status(db, sw["id"], "stop")
    info = sweep_ops.set_status(db, sw["id"], "cancel")
    assert info["status"] == "cancelled"
    assert [t["status"] for t in info["trials"]] == ["completed", "killed", "killed"]
    assert ingest_ops.heartbeat(db, run) is not None
    assert ingest_ops.heartbeat(db, done_run) is None
    # The trial stays killed however its process ends.
    assert sweep_ops.report_trial(db, sw["id"], running["id"], status="failed")["status"] == "killed"
    # A run joining a killed trial is asked to stop at once.
    late = ingest_ops.create_run(db, project="p", sweep_id=sw["id"])["run_id"]
    joined = sweep_ops.report_trial(db, sw["id"], unjoined["id"], run_id=late, status="running")
    assert (joined["status"], joined["run_id"]) == ("killed", late)
    assert ingest_ops.heartbeat(db, late) is not None


def test_run_cap_finishes_the_sweep(db):
    sw = sweep_ops.create_sweep(db, project="p", space={"a": {"min": 0.0, "max": 1.0}}, run_cap=2)
    assert sw["run_cap"] == 2
    trials = [sweep_ops.next_trial(db, sw["id"])["trial"] for _ in range(2)]
    sweep_ops.report_trial(db, sw["id"], trials[0]["id"], status="failed")
    assert sweep_ops.next_trial(db, sw["id"]) == {"status": "finished", "trial": None}
    assert sweep_ops.get_sweep(db, sw["id"])["trial_count"] == 2
    # A cap above a grid's size: the grid runs out first.
    grid = sweep_ops.create_sweep(db, project="p", space={"a": {"values": [1, 2]}}, method="grid",
                                  run_cap=5)
    assert [sweep_ops.next_trial(db, grid["id"])["status"] for _ in range(3)] == [
        "running", "running", "finished",
    ]
    for bad in (0, -1, 1.5, True, "3"):
        with pytest.raises(ValueError, match="run_cap"):
            sweep_ops.create_sweep(db, project="p", space={"a": 1}, run_cap=bad)


def test_command_program_and_description(db):
    sw = sweep_ops.create_sweep(db, project="p", space={"a": 1}, program="train.py",
                                description="lr scan")
    assert sw["command"] == ["${env}", "${interpreter}", "${program}", "${args}"]
    assert (sw["program"], sw["description"]) == ("train.py", "lr scan")
    as_string = sweep_ops.create_sweep(db, project="p", space={"a": 1},
                                       command="python 'my train.py' ${args_no_hyphens}")
    assert as_string["command"] == ["python", "my train.py", "${args_no_hyphens}"]
    assert as_string["program"] is None
    # A Python-only sweep needs neither.
    assert sweep_ops.create_sweep(db, project="p", space={"a": 1})["command"] is None
    with pytest.raises(ValueError, match="no program"):
        sweep_ops.create_sweep(db, project="p", space={"a": 1}, command=["python", "${program}"])


def test_check_keys():
    sweep_ops.check_keys({"name": 1, "project": 1, "method": 1, "metric": 1, "goal": 1,
                          "parameters": 1, "program": 1, "command": 1, "run_cap": 1,
                          "description": 1})
    with pytest.raises(ValueError, match="unknown sweep key 'entity'"):
        sweep_ops.check_keys({"project": "p", "entity": "me"})
    with pytest.raises(ValueError, match="'early_terminate' is not supported yet"):
        sweep_ops.check_keys({"early_terminate": {"type": "hyperband"}})


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
    assert sw["command"] == ["python", "train.py"] and sw["space"] == body["parameters"]
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
    assert client.post(f"/api/sweeps/{sid}/stop").json()["status"] == "stopped"
    assert client.post(f"/api/sweeps/{sid}/resume").status_code == 400
    assert client.post(f"/api/sweeps/{sid}/cancel").json()["status"] == "cancelled"

    assert client.post(f"/api/sweeps/{sid}/explode").status_code == 404
    assert client.get("/api/sweeps/missing").status_code == 404
    assert client.post("/api/sweeps", json={**body, "method": "nope"}).status_code == 400
    unknown = client.post("/api/sweeps", json={**body, "early_terminate": {"type": "hyperband"}})
    assert unknown.status_code == 400 and "not supported yet" in unknown.json()["detail"]
    unknown = client.post("/api/sweeps", json={**body, "entity": "me"})
    assert unknown.status_code == 400 and "'entity'" in unknown.json()["detail"]
    capped = client.post("/api/sweeps", json={**body, "program": "t.py", "run_cap": 3}).json()
    assert (capped["program"], capped["run_cap"]) == ("t.py", 3)
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
        with pytest.raises(ValueError, match="cannot cancel a finished sweep"):
            t.sweep_action(sw["id"], "cancel")
        with pytest.raises(ValueError, match="unknown sweep key 'entity'"):
            t.create_sweep({"project": "P", "parameters": {"a": 1}, "entity": "me"})
        assert t.get_sweep(sw["id"])["trial_count"] == 1
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
    # A later trial gets its own number; an explicit name wins over the trial's.
    t = LocalTransport(repo)
    sw_r = t.create_sweep({"project": "p", "parameters": {"lr": {"min": 0.1, "max": 0.2}}})
    t.next_trial(sw_r["id"])
    trial3 = t.next_trial(sw_r["id"])["trial"]
    t.close()
    monkeypatch.setenv("CAIRN_SWEEP_ID", sw_r["id"])
    monkeypatch.setenv("CAIRN_TRIAL_ID", trial3["id"])
    with cairn.Run(project="p", repo=repo, **QUIET) as unnamed:
        pass
    with cairn.Run(project="p", repo=repo, name="mine", **QUIET) as named:
        pass

    reader = cairn.Reader(repo=repo)
    try:
        r = reader.run(run.id)
        assert r._raw["sweep_id"] == sw["id"]
        assert r.config["lr"] == 0.5
        assert r.name == f"{sw['id'][:6]}-1"
        assert reader.run(unnamed.id).name == f"{sw_r['id'][:6]}-2"
        assert reader.run(named.id).name == "mine"
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
    reader = cairn.Reader(repo=repo)
    try:
        assert [reader.run(r).name for r in seen_runs] == [f"{sw.id[:6]}-1", f"{sw.id[:6]}-2"]
    finally:
        reader.close()
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

    named = cairn.sweep({"x": {"values": [0, 1]}}, project="p", method="grid", name="scan", repo=repo)
    a, b = named.run(lambda c: None, count=1, **QUIET) + named.run(lambda c: None, name="own", **QUIET)
    reader = cairn.Reader(repo=repo)
    try:
        assert reader.run(a["run_id"]).name == "scan-1"
        assert reader.run(b["run_id"]).name == "own"
    finally:
        reader.close()


def test_python_sweep_with_worker_processes(tmp_path):
    repo = tmp_path / ".cairn"
    sw = cairn.sweep({"x": {"values": [0, 1, 2, 3]}}, project="p", metric="loss", method="grid", repo=repo)
    trials = sw.run(_quadratic, count=4, workers=2, **QUIET)
    assert sorted(t["params"]["x"] for t in trials) == [0, 1, 2, 3]
    assert all(t["status"] == "completed" and t["run_id"] for t in trials)


def _run_in_thread(sw, fn, **kwargs):
    out: dict = {}
    thread = threading.Thread(target=lambda: out.setdefault("trials", sw.run(fn, **kwargs)))
    thread.start()
    return thread, out


def test_python_sweep_waits_while_paused(tmp_path, monkeypatch):
    monkeypatch.setattr(sweep_mod, "_PAUSE_POLL", 0.02)
    repo = tmp_path / ".cairn"
    sw = cairn.sweep({"x": {"min": 0.0, "max": 1.0}}, project="p", repo=repo)
    sw.pause()
    thread, out = _run_in_thread(sw, lambda c: c["x"], count=2, **QUIET)
    time.sleep(0.3)
    assert thread.is_alive() and sw.info()["trial_count"] == 0
    sw.resume()
    thread.join(timeout=30)
    assert not thread.is_alive()
    assert [t["status"] for t in out["trials"]] == ["completed", "completed"]

    # Stopped while waiting: the worker returns without a trial.
    sw.pause()
    thread, out = _run_in_thread(sw, lambda c: c["x"], **QUIET)
    time.sleep(0.2)
    assert thread.is_alive()
    sw.stop()
    thread.join(timeout=30)
    assert not thread.is_alive() and out["trials"] == []
    assert sw.info()["status"] == "stopped"


def test_python_sweep_cancel_stops_the_running_trial(tmp_path, monkeypatch):
    monkeypatch.setattr(cairn.Run, "_HEARTBEAT_INTERVAL", 0.02)
    repo = tmp_path / ".cairn"
    sw = cairn.sweep({"x": {"min": 0.0, "max": 1.0}}, project="p", repo=repo)
    started = threading.Event()

    def train(config, run):
        started.set()
        while not run.should_stop:
            time.sleep(0.01)

    thread, out = _run_in_thread(sw, train, stop_mode="flag", **QUIET)
    assert started.wait(30)
    sw.cancel()
    thread.join(timeout=30)
    assert not thread.is_alive()
    (trial,) = out["trials"]
    assert trial["status"] == "killed"
    reader = cairn.Reader(repo=repo)
    try:
        assert reader.run(trial["run_id"]).status == "stopped"
    finally:
        reader.close()


# ---- the agent's command ------------------------------------------------------------------

PARAMS = {"lr": 0.1, "opt": "adam", "dims": [1, 2], "aug": True, "ema": False}
ENV = [] if sys.platform == "win32" else ["/usr/bin/env"]


@pytest.mark.parametrize(("command", "argv"), [
    # wandb's default command.
    (["${env}", "${interpreter}", "${program}", "${args}"],
     [*ENV, sys.executable, "train.py",
      "--lr=0.1", "--opt=adam", "--dims=[1, 2]", "--aug=True", "--ema=False"]),
    (["python", "${program}", "${args_no_hyphens}"],
     ["python", "train.py", "lr=0.1", "opt=adam", "dims=[1, 2]", "aug=True", "ema=False"]),
    (["python", "${program}", "${args_no_boolean_flags}"],
     ["python", "train.py", "--lr=0.1", "--opt=adam", "--dims=[1, 2]", "--aug"]),
    (["python", "${program}", "${args_json}"], ["python", "train.py", json.dumps(PARAMS)]),
    (["python", "${program}", "--params", "${args_json_file}"],
     ["python", "train.py", "--params", "/tmp/p.json"]),
    # Single-argument macros inside a longer item are substituted as text.
    (["python", "./${program}", "--config=${args_json_file}", "--x=${args}"],
     ["python", "./train.py", "--config=/tmp/p.json", "--x=${args}"]),
    # No args macro, no params.
    (["python", "train.py"], ["python", "train.py"]),
])
def test_expand_command(command, argv):
    assert expand_command(command, program="train.py", params=PARAMS, json_file="/tmp/p.json") == argv


def test_expand_command_drops_env_on_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    assert expand_command(["${env}", "python", "${program}"], program="t.py", params={}) == [
        "python", "t.py",
    ]


def test_dotted_params_keep_their_dotted_names():
    assert expand_command(["${args_no_hyphens}"], program=None, params={"optim.lr": 0.1}) == [
        "optim.lr=0.1",
    ]


# ---- Run.project ----------------------------------------------------------------------------


def test_run_project_is_the_normalised_id(tmp_path):
    with cairn.Run(project="My Project", repo=tmp_path / ".cairn", **QUIET) as run:
        assert run.project == "my-project"
