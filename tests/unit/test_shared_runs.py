"""Shared runs: several processes log into one run (wandb's shared mode).

One primary creates the run; workers (``primary=False`` / ``cairn.attach``)
join it with a label. Everything they record lands in the run, but only the
primary sets its status and keeps it alive. Each process writes its own log
(``<run_id>[~<label>].wal.jsonl``); a worker's log waits at the ingester until
the run exists.
"""

from __future__ import annotations

import json
import os
import time

import pytest

import cairn
from cairn.sdk import run_ids
from cairn.sdk.local import LocalTransport
from cairn.sdk.run import _resolve_process
from cairn.server import ingest_ops, wal_ingest
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in (run_ids.RUN_ID_ENV, *run_ids.RANK_ENV_VARS, "CAIRN_SWEEP_ID"):
        monkeypatch.delenv(var, raising=False)
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


class _Repo:
    """The ingester's side of a repo (what the lease holder runs)."""

    def __init__(self, repo):
        self.dd = DataDir(repo)
        self.db = Database.open(self.dd.db_path)
        self.blobs = BlobStore(self.dd.artifacts_dir)

    def ingest(self) -> int:
        return wal_ingest.ingest_all(self.dd, self.db, self.blobs)

    def status(self, rid):
        return self.db.read_one("SELECT status FROM runs WHERE id = ?", [rid])[0]

    def points(self, rid, name):
        return self.db.read_columns(
            "SELECT step, scalar_value FROM sequences WHERE run_id = ? AND name = ? ORDER BY step",
            [rid, name],
        )

    def logs(self):
        return sorted(p.name for p in wal_ingest.wal_dir(self.dd).glob("*.wal.jsonl"))

    def close(self):
        self.db.close()


@pytest.fixture
def repo(tmp_path):
    return tmp_path / ".cairn"


@pytest.fixture
def ing(repo):
    r = _Repo(repo)
    yield r
    r.close()


def _primary(repo, **kw):
    return cairn.Run(repo=repo, **{"project": "p", **QUIET, **kw})


def _worker(repo, rid, label, **kw):
    return cairn.Run(repo=repo, run_id=rid, label=label, primary=False, **{**QUIET, **kw})


# ---- ids -------------------------------------------------------------------


def test_new_run_id_is_cairns_format():
    a, b = cairn.new_run_id(), cairn.new_run_id()
    assert a != b
    assert len(a) == 32 and int(a, 16) >= 0
    assert run_ids.check_run_id(a) == a


def test_run_id_argument_and_env(repo, monkeypatch, ing):
    rid = cairn.new_run_id()
    with _primary(repo, run_id=rid) as run:
        assert run.id == rid
    env_id = cairn.new_run_id()
    monkeypatch.setenv("CAIRN_RUN_ID", env_id)
    with _primary(repo) as run:
        assert run.id == env_id
    # run_id= wins over the environment.
    explicit = cairn.new_run_id()
    with _primary(repo, run_id=explicit) as run:
        assert run.id == explicit
    ing.ingest()
    assert ing.status(rid) == ing.status(env_id) == ing.status(explicit) == "completed"


@pytest.mark.parametrize("bad", ["", "a~b", "a.b", "a/b", "x" * 65])
def test_malformed_run_id_is_refused(repo, bad):
    with pytest.raises(ValueError, match="run id"):
        _primary(repo, run_id=bad)


def test_a_taken_id_is_refused_pending_or_ingested(repo, ing):
    rid = cairn.new_run_id()
    with _primary(repo, run_id=rid):
        pass
    with pytest.raises(ValueError, match="exists"):  # its log is not ingested yet
        _primary(repo, run_id=rid)
    ing.ingest()
    with pytest.raises(ValueError, match="exists"):
        _primary(repo, run_id=rid)


def test_resume_keeps_its_semantics_with_the_env_id(repo, monkeypatch, ing):
    with _primary(repo) as first:
        rid = first.id
    ing.ingest()
    monkeypatch.setenv("CAIRN_RUN_ID", rid)
    with _primary(repo, resume=rid) as again:
        assert again.id == rid
    ing.ingest()
    assert ing.status(rid) == "completed"
    with pytest.raises(ValueError, match="CAIRN_RUN_ID"):
        _primary(repo, resume=cairn.new_run_id())
    with pytest.raises(ValueError, match="resume or run_id"):
        _primary(repo, resume=rid, run_id=rid)


# ---- workers: arguments ----------------------------------------------------


def test_worker_needs_an_id_and_a_label(repo):
    with pytest.raises(ValueError, match="needs the run's id"):
        cairn.Run(project="p", repo=repo, label="w", primary=False, **QUIET)
    with pytest.raises(ValueError, match="needs a label"):
        cairn.Run(project="p", repo=repo, run_id=cairn.new_run_id(), primary=False, **QUIET)
    with pytest.raises(ValueError, match="label"):
        _worker(repo, cairn.new_run_id(), "rank.1")
    with pytest.raises(ValueError, match="cannot resume or fork"):
        cairn.Run(project="p", repo=repo, label="w", primary=False, run_id="a",
                  fork_from=(cairn.new_run_id(), 1), **QUIET)


def test_primary_needs_a_project(repo):
    with pytest.raises(TypeError, match="project"):
        cairn.Run(repo=repo, **QUIET)


def test_attach_is_run_with_primary_false(repo, ing):
    with _primary(repo) as run:
        w = cairn.attach(run.id, "eval", repo=repo, system_metrics=False, capture_output=False)
        assert (w.id, w.project, w._primary, w._label) == (run.id, "p", False, "eval")
        w.finish()


# ---- workers: what they record, what they never change -----------------------


def test_worker_data_lands_in_the_run_and_its_log_is_deleted(repo, ing):
    with _primary(repo, name="shared") as run:
        rid = run.id
        with _worker(repo, rid, "rank1") as w:
            w.track(1.5, "rank1.loss", step=0)
            w.config(rank1={"batch": 8})
            w.summary(rank1_best=0.5)
        run.track(0.5, "loss", step=0)
    assert ing.logs() == [f"{rid}.wal.jsonl", f"{rid}~rank1.wal.jsonl"]
    ing.ingest()
    assert ing.logs() == []
    assert ing.status(rid) == "completed"
    assert ing.points(rid, "rank1.loss") == [{"step": 0, "scalar_value": 1.5}]
    docs = ingest_ops.run_docs(ing.db, rid)
    assert docs == {"config": {"rank1": {"batch": 8}}, "summary": {"rank1_best": 0.5}}
    assert ing.db.read_one("SELECT COUNT(*) FROM wal_progress") == (0,)


def test_worker_exception_and_finish_never_change_the_status(repo, ing):
    run = _primary(repo)
    rid = run.id
    with pytest.raises(RuntimeError), _worker(repo, rid, "rank1") as w:
        w.track(1.0, "x", step=0)
        raise RuntimeError("worker died")
    w2 = _worker(repo, rid, "rank2")
    w2.finish(status="killed")
    ing.ingest()
    assert ing.status(rid) == "running"
    run.finish()
    ing.ingest()
    assert ing.status(rid) == "completed"


def test_primary_failure_stands_when_workers_detach_later(repo, ing):
    run = _primary(repo)
    rid = run.id
    w = _worker(repo, rid, "rank1")
    run.finish(status="failed", exit_code=1)
    ing.ingest()
    assert ing.status(rid) == "failed"
    w.track(2.0, "late", step=0)
    w.finish()
    ing.ingest()
    assert ing.status(rid) == "failed"
    assert ing.points(rid, "late") == [{"step": 0, "scalar_value": 2.0}]
    assert ing.logs() == []


def test_attach_to_a_finished_run_keeps_its_status(repo, ing):
    with _primary(repo) as run:
        run.track(0.1, "loss", step=9)
    ing.ingest()
    with cairn.attach(run.id, "eval", repo=repo, system_metrics=False,
                      capture_output=False) as ev:
        assert ev.project == "p"  # looked up: the run is ingested
        ev.track(0.9, "eval.acc", step=9)
    ing.ingest()
    assert ing.status(run.id) == "completed"
    assert ing.points(run.id, "eval.acc") == [{"step": 9, "scalar_value": 0.9}]


def test_worker_without_project_reads_it_from_the_primarys_log(repo, ing):
    run = _primary(repo, project="My Proj")
    w = cairn.attach(run.id, "rank1", repo=repo, system_metrics=False, capture_output=False)
    assert w.project == "my-proj"
    w.finish()
    run.finish()


def test_worker_project_must_match_the_run(repo, ing):
    with _primary(repo) as run:
        pass
    ing.ingest()
    with pytest.raises(ValueError, match="project"):
        _worker(repo, run.id, "rank1", project="other")


def test_join_waits_for_a_run_it_cannot_find(repo, monkeypatch):
    monkeypatch.setattr(LocalTransport, "JOIN_WAIT", 0.3)
    t0 = time.monotonic()
    with pytest.raises(LookupError):
        cairn.attach(cairn.new_run_id(), "rank1", repo=repo)
    assert time.monotonic() - t0 >= 0.3


def test_labels_are_unique_among_live_processes(repo, ing):
    run = _primary(repo)
    w = _worker(repo, run.id, "rank1")
    with pytest.raises(ValueError, match="in use"):
        _worker(repo, run.id, "rank1")
    w.finish()
    # Detached: the label is free again (the old log is ingested first).
    again = _worker(repo, run.id, "rank1")
    again.track(3.0, "x", step=1)
    again.finish()
    run.finish()
    ing.ingest()
    assert ing.logs() == []
    assert ing.points(run.id, "x") == [{"step": 1, "scalar_value": 3.0}]


def test_duplicate_points_first_ingested_wins(repo, ing):
    run = _primary(repo)
    w = _worker(repo, run.id, "rank1")
    run.track(1.0, "loss", step=0)
    w.track(2.0, "loss", step=0)
    w.finish()
    run.finish()
    ing.ingest()  # the primary's log sorts (and is ingested) first
    assert ing.points(run.id, "loss") == [{"step": 0, "scalar_value": 1.0}]


# ---- system metrics and console lines -----------------------------------------


def test_system_metrics_are_named_by_label(repo, ing):
    sysm = {"capture_system_metrics": True, "system_metrics_interval": 60.0}
    run = _primary(repo, **sysm)
    w = _worker(repo, run.id, "rank1", **sysm)
    w.finish()
    run.finish()
    labelled = _primary(repo, label="rank0", **sysm)
    labelled.finish()
    ing.ingest()

    def names(rid):
        return {r["name"] for r in ing.db.read_columns(
            "SELECT DISTINCT name FROM sequences WHERE run_id = ?", [rid])}

    shared = names(run.id)
    assert "system.cpu.util_percent" in shared
    assert "system.rank1.cpu.util_percent" in shared
    assert all(n.startswith("system.") for n in shared)
    assert "system.rank0.cpu.util_percent" in names(labelled.id)


def test_console_lines_carry_their_label(repo, ing, capsys):
    run = cairn.Run(project="p", repo=repo, capture_source=False, capture_env=False,
                    capture_system_metrics=False)
    print("from the primary")
    run.finish()
    w = cairn.Run(repo=repo, run_id=run.id, label="rank1", primary=False,
                  capture_system_metrics=False)
    print("from rank1")
    w.finish()
    ing.ingest()
    rows = ing.db.read_columns(
        "SELECT label, line_no, content FROM log_lines WHERE run_id = ? ORDER BY wall_time",
        [run.id],
    )
    assert [(r["label"], r["content"]) for r in rows] == [
        (None, "from the primary"), ("rank1", "from rank1"),
    ]
    assert [r["line_no"] for r in rows] == [1, 1]  # counted per process
    lines = cairn.Reader(repo=repo).run(run.id).logs()
    assert [(ln.label, ln.content) for ln in lines] == [
        (None, "from the primary"), ("rank1", "from rank1"),
    ]


def test_logs_route_label_filter_and_labels(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]

    def line(n, label):
        return {"stream": "stdout", "wall_time": f"2026-01-01T00:00:0{n}+00:00",
                "line_no": 1, "content": f"l{n}", "label": label}

    r = client.post(f"/api/runs/{rid}/logs", json={"lines": [
        line(1, None), line(2, "rank1"), line(3, "rank2"), line(4, "rank1"),
    ]})
    assert r.status_code == 200, r.text
    body = client.get(f"/api/runs/{rid}/logs").json()
    assert body["labels"] == [None, "rank1", "rank2"]
    assert [(ln["label"], ln["content"]) for ln in body["lines"]] == [
        (None, "l1"), ("rank1", "l2"), ("rank2", "l3"), ("rank1", "l4"),
    ]
    one = client.get(f"/api/runs/{rid}/logs", params={"label": "rank1"}).json()
    assert [ln["content"] for ln in one["lines"]] == ["l2", "l4"]
    assert one["total"] == 2 and one["labels"] == [None, "rank1", "rank2"]
    unlabelled = client.get(f"/api/runs/{rid}/logs", params={"label": ""}).json()
    assert [ln["content"] for ln in unlabelled["lines"]] == ["l1"]
    # Search matches the label too (as in wandb's console search).
    by_label = client.get(f"/api/runs/{rid}/logs", params={"search": "rank2"}).json()
    assert [ln["content"] for ln in by_label["lines"]] == ["l3"]


# ---- the ingester ----------------------------------------------------------


def test_worker_log_waits_for_its_run(repo, ing):
    rid = cairn.new_run_id()
    w = _worker(repo, rid, "rank1", project="p")  # before the primary exists
    w.track(1.0, "a", step=0)
    w.track(2.0, "a", step=1)
    w.finish()
    assert ing.ingest() == 0
    assert ing.db.read_one("SELECT COUNT(*) FROM runs") == (0,)
    assert ing.db.read_one("SELECT COUNT(*) FROM wal_progress") == (0,)
    assert not wal_ingest.has_pending(ing.dd, ing.db)  # nothing it can do yet
    assert ing.logs() == [f"{rid}~rank1.wal.jsonl"]

    run = _primary(repo, run_id=rid)
    assert wal_ingest.has_pending(ing.dd, ing.db)
    ing.ingest()
    assert ing.points(rid, "a") == [{"step": 0, "scalar_value": 1.0},
                                    {"step": 1, "scalar_value": 2.0}]
    assert ing.logs() == [f"{rid}.wal.jsonl"]  # the worker's: detached and deleted
    run.finish()
    ing.ingest()
    assert ing.status(rid) == "completed" and ing.logs() == []


def _write_log(path, records):
    with open(path, "a") as fh:
        fh.writelines(
            json.dumps({"seq": i, "op": op, "payload": payload}) + "\n"
            for i, (op, payload) in enumerate(records, 1)
        )


def test_worker_log_cannot_change_the_lifecycle(repo, ing):
    with _primary(repo) as run:
        pass
    ing.ingest()
    rid = run.id
    path = wal_ingest.log_path(ing.dd, rid, "rogue")
    _write_log(path, [
        ("join", {"run_id": rid, "label": "rogue"}),
        ("finish", {"run_id": rid, "status": "failed"}),
        ("resume_run", {"run_id": rid}),
        ("heartbeat", {"run_id": rid}),
        ("batch", {"run_id": rid, "points": [{"name": "y", "step": 0, "object_type": "scalar",
                                             "wall_time": "2026-01-01T00:00:00+00:00",
                                             "scalar_value": 4.0}]}),
        ("detach", {"run_id": rid}),
    ])
    ing.ingest()
    assert ing.status(rid) == "completed"
    assert ing.points(rid, "y") == [{"step": 0, "scalar_value": 4.0}]
    assert not path.exists()


def test_crashed_only_from_the_primarys_liveness(repo, ing):
    run = _primary(repo)
    w = _worker(repo, run.id, "rank1")
    w.track(1.0, "x", step=0)
    ing.ingest()
    primary_log = wal_ingest.log_path(ing.dd, run.id)
    worker_log = wal_ingest.log_path(ing.dd, run.id, "rank1")
    old = time.time() - wal_ingest.STALE_SECONDS - 5

    os.utime(worker_log, (old, old))  # a silent worker: the run is alive
    assert wal_ingest.mark_crashed(ing.db, ing.dd) == []
    assert ing.status(run.id) == "running"

    os.utime(primary_log, (old, old))  # a silent primary: crashed, busy worker or not
    os.utime(worker_log, None)
    assert wal_ingest.mark_crashed(ing.db, ing.dd) == [run.id]
    assert ing.status(run.id) == "crashed"

    w.track(2.0, "x", step=1)  # a worker's records do not revive it
    ing.ingest()
    assert ing.status(run.id) == "crashed"
    w.finish()
    run.finish()  # its primary's do (a finish here)
    ing.ingest()
    assert ing.status(run.id) == "completed"


# ---- stop requests -----------------------------------------------------------


def test_stop_request_reaches_workers(repo, ing, monkeypatch):
    monkeypatch.setattr(cairn.Run, "_HEARTBEAT_INTERVAL", 0.05)
    run = _primary(repo, stop_mode="flag")
    w = _worker(repo, run.id, "rank1", stop_mode="flag")
    ing.ingest()
    ingest_ops.request_stop(ing.db, run.id)
    deadline = time.monotonic() + 5
    while not (run.should_stop and w.should_stop) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert run.should_stop and w.should_stop
    w.finish()
    run.finish("stopped")
    ing.ingest()
    assert ing.status(run.id) == "stopped"


def test_a_finished_runs_old_stop_request_is_not_for_a_late_worker(repo, ing, monkeypatch):
    monkeypatch.setattr(cairn.Run, "_HEARTBEAT_INTERVAL", 0.05)
    run = _primary(repo, stop_mode="flag")
    ing.ingest()
    ingest_ops.request_stop(ing.db, run.id)
    run.finish("stopped")
    ing.ingest()
    w = _worker(repo, run.id, "eval", stop_mode="flag")
    time.sleep(0.3)
    assert not w.should_stop
    w.finish()


# ---- label="auto" -------------------------------------------------------------


@pytest.mark.parametrize(("env", "expected"), [
    ({}, (None, True)),
    ({"RANK": "0"}, ("rank0", True)),
    ({"RANK": "3"}, ("rank3", False)),
    ({"SLURM_PROCID": "2"}, ("rank2", False)),
    ({"SKYPILOT_NODE_RANK": "0"}, ("rank0", True)),
    ({"OMPI_COMM_WORLD_RANK": "5"}, ("rank5", False)),
    ({"PMI_RANK": "1"}, ("rank1", False)),
    # First match wins, in the documented order.
    ({"RANK": "1", "SLURM_PROCID": "0"}, ("rank1", False)),
    ({"SLURM_PROCID": "0", "SKYPILOT_NODE_RANK": "4", "PMI_RANK": "7"}, ("rank0", True)),
    ({"OMPI_COMM_WORLD_RANK": "2", "PMI_RANK": "0"}, ("rank2", False)),
    # An empty variable is unset.
    ({"RANK": "", "SLURM_PROCID": "6"}, ("rank6", False)),
])
def test_auto_label_from_the_launchers_rank(monkeypatch, env, expected):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    assert run_ids.auto_label() == expected


@pytest.mark.parametrize("value", ["x", "-1", "1.5"])
def test_auto_label_refuses_a_bad_rank(monkeypatch, value):
    monkeypatch.setenv("SLURM_PROCID", value)
    with pytest.raises(ValueError, match="SLURM_PROCID"):
        run_ids.auto_label()


def test_auto_label_roles_and_explicit_primary(monkeypatch):
    rid = cairn.new_run_id()
    monkeypatch.setenv("CAIRN_RUN_ID", rid)
    monkeypatch.setenv("RANK", "2")
    assert _resolve_process("auto", None, None, None) == ("rank2", False, rid)
    assert _resolve_process("auto", True, None, None) == ("rank2", True, rid)
    monkeypatch.setenv("RANK", "0")
    assert _resolve_process("auto", None, None, None) == ("rank0", True, rid)
    assert _resolve_process("auto", False, None, None) == ("rank0", False, rid)
    monkeypatch.delenv("RANK")
    assert _resolve_process("auto", None, None, None) == (None, True, rid)
    monkeypatch.delenv("CAIRN_RUN_ID")
    with pytest.raises(ValueError, match="needs a label"):
        _resolve_process("auto", False, "abc", None)


def test_auto_label_end_to_end(repo, ing, monkeypatch):
    rid = cairn.new_run_id()
    monkeypatch.setenv("CAIRN_RUN_ID", rid)
    monkeypatch.setenv("RANK", "0")
    run = _primary(repo, label="auto")
    assert (run._label, run._primary) == ("rank0", True)
    monkeypatch.setenv("RANK", "1")
    w = cairn.Run(repo=repo, label="auto", project="p", **QUIET)
    assert (w.id, w._label, w._primary) == (rid, "rank1", False)
    w.finish()
    run.finish()
    ing.ingest()
    assert ing.status(rid) == "completed" and ing.logs() == []


def test_disabled_mode_takes_the_id(monkeypatch):
    rid = cairn.new_run_id()
    monkeypatch.setenv("CAIRN_RUN_ID", rid)
    assert cairn.Run("p", mode="disabled").id == rid
    assert cairn.Run("p", mode="disabled", run_id="abc").id == "abc"


# ---- over HTTP ---------------------------------------------------------------


def test_http_join_finish_and_heartbeat_routes(client):
    assert client.post("/api/runs", json={
        "project": "", "run_id": "nope", "primary": False, "label": "w",
    }).status_code == 404
    rid = client.post("/api/runs", json={"project": "p", "run_id": "r1", "tags": ["a"]}).json()["run_id"]
    assert client.post("/api/runs", json={"project": "p", "run_id": rid}).status_code == 409
    joined = client.post("/api/runs", json={
        "project": "", "run_id": rid, "primary": False, "label": "w",
    }).json()
    assert joined["project_id"] == "p" and joined["tags"] == ["a"]
    assert joined["status"] == "running" and joined["stop_requested"] is None

    r = client.post(f"/api/runs/{rid}/finish", json={"status": "failed", "primary": False})
    assert r.json() == {"run_id": rid, "status": "running"}
    db = client.app.state.db
    db.write("UPDATE runs SET status = 'crashed' WHERE id = ?", [rid])
    assert client.post(f"/api/runs/{rid}/heartbeat", json={"primary": False}).status_code == 200
    assert db.read_one("SELECT status FROM runs WHERE id = ?", [rid]) == ("crashed",)
    client.post(f"/api/runs/{rid}/heartbeat")  # the primary's revives it
    assert db.read_one("SELECT status FROM runs WHERE id = ?", [rid]) == ("running",)
    client.post(f"/api/runs/{rid}/finish", json={"status": "completed"})
    assert db.read_one("SELECT status FROM runs WHERE id = ?", [rid]) == ("completed",)


def test_http_workers(live_server):
    url = live_server.replace("http://", "cairn://")
    rid = cairn.new_run_id()
    run = cairn.Run("p", repo=url, run_id=rid, **QUIET)
    with pytest.raises(ValueError, match="exists"):
        cairn.Run("p", repo=url, run_id=rid, **QUIET)
    w = cairn.attach(rid, "rank1", repo=url, system_metrics=False, capture_output=False)
    assert w.project == "p"
    w.track(1.0, "loss", step=0)
    w.track(5.0, "rank1.only", step=3)
    w.finish(status="failed")
    run.track(2.0, "loss", step=0)
    assert cairn.Reader(repo=url).run(rid).status == "running"
    run.finish(status="completed")
    r = cairn.Reader(repo=url).run(rid)
    assert r.status == "completed"
    assert [p.scalar_value for p in r.sequence("rank1.only").points] == [5.0]
    # First received wins (the worker's, flushed by its finish).
    assert [p.scalar_value for p in r.sequence("loss").points] == [1.0]
