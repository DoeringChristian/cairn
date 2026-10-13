"""cairn.Run writes only its run directory: every SDK feature as records,
and those records applied by the existing ingest code end where 0.5 put them."""

from __future__ import annotations

#: Test the client alone, without the server stand-in (tests/standin_server.py).
STANDIN = False

import os
import signal
import time
from pathlib import Path

import numpy as np
import pytest

import cairn
from cairn.sdk.runlog.codec import RESERVED, record_blobs
from cairn.sdk.runlog.log import scan
from cairn.sdk.runlog.rundir import RunDir
from cairn.sdk.runlog.server import ServerReads, ServerUnavailable
from cairn.uploader import daemon as agent
from cairn.uploader.client import IngestClient
from cairn.uploader.sync import sync_paths

from .fake_ingest import FakeIngest

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


@pytest.fixture(autouse=True)
def env(tmp_path, monkeypatch):
    from cairn.sdk.capture import stdout as scap

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("CAIRN_DIR", str(tmp_path / "cd"))
    monkeypatch.setenv("CAIRN_AGENT_DIR", str(tmp_path / "agent"))
    monkeypatch.setenv("CAIRN_UPLOADER", "off")
    monkeypatch.setenv("CAIRN_REPO", str(tmp_path / "repo"))
    monkeypatch.delenv("CAIRN_SERVER", raising=False)
    monkeypatch.delenv("CAIRN_RUN_ID", raising=False)
    scap._active_run_id = None
    yield tmp_path
    scap._active_run_id = None


def records(run_id: str, label: str | None = None) -> list[dict]:
    rd = RunDir.for_run(run_id)
    return scan(rd.log(label).log_dir).records


def ops(run_id: str, label: str | None = None) -> list[str]:
    return [r["op"] for r in records(run_id, label)]


def ingest(repo: Path, run_dirs: list[RunDir]) -> FakeIngest:
    """Upload ``run_dirs`` to a fake server whose apply is 0.5's ingest code
    on the repo's database (what the 0.6 server reuses)."""
    from cairn.server.storage.blobs import BlobStore
    from cairn.server.storage.datadir import DataDir
    from cairn.server.storage.db import Database
    from cairn.server.record_apply import _apply_op

    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    fake = FakeIngest()

    def apply(run_id: str, log: str, rec: dict) -> None:
        for h in record_blobs(rec):
            blobs.put(fake.blobs[h])
        payload = {k: v for k, v in rec.items() if k not in RESERVED}
        with db.transaction():
            _apply_op(db, dd, blobs, rec["op"], payload, run_id, worker=log != "main")

    fake.apply_fn = apply
    try:
        out = sync_paths(run_dirs, client_for=lambda _rd: IngestClient("http://f", client=fake.client()))
    finally:
        db.close()
    assert all(v is None for v in out.values()), out
    return fake


def test_a_run_writes_only_its_directory(env) -> None:
    run = cairn.Run("p", name="n", **QUIET)
    run.track(1.0, "loss", 0)
    run.finish()
    assert not (env / "repo").exists()  # nothing in the repo: the server writes it
    rd = RunDir.for_run(run.id)
    meta = rd.meta()
    assert meta["endpoint"] == "local" and meta["repo"] == str((env / "repo").resolve())
    assert meta["project_id"] == "p"
    assert ops(run.id) == ["create_run", "batch", "finish"]
    assert rd.log().finished()["status"] == "completed"


def test_every_feature_is_a_record(env) -> None:
    other = cairn.Run("p", **QUIET)
    other.finish()
    run = cairn.Run("My Project", name="n", tags=["a"], notes="hi", group="g",
                    capture_source=True, capture_stdout=True, capture_env=True,
                    capture_system_metrics=False, total_steps=10, uses=[other.id])
    assert run.project == "my-project"
    run.config(lr=1e-3, opt={"b": 2})
    for i in range(3):
        run.track(float(i), "loss", i, summary="min", x="epoch")
        run.track(float(i), "epoch", i)
    run.track(cairn.Image(np.zeros((4, 4, 3), dtype=np.uint8), caption="c"), "img", 0)
    run.track([cairn.Image(np.ones((2, 2), dtype=np.uint8)), cairn.Image(np.zeros((2, 2), dtype=np.uint8))], "gal", 0)
    run.summary(best=0.5, fig=cairn.Image(np.zeros((2, 2), dtype=np.uint8)))
    run.set_tag("b")
    run.remove_tag("a")
    run.add_note("notes")
    run.alert("t", "x", level="warn")
    run.progress(1, total=4)
    av = run.log_artifact(b"weights", "ckpt", type="model", aliases=["best"], step=2)
    assert av.pending and av.version is None
    run.use_artifact(av)
    run.use_run(other, role="data")
    print("a line")
    run._track_sample("system.cpu", 3.0)
    run.finish()

    recs = records(run.id)
    got = [r["op"] for r in recs]
    for op in ("create_run", "total_steps", "record_run_use", "params", "set_metric_rule", "batch",
               "artifact_meta", "summary", "set_tags", "set_notes", "alert", "progress",
               "create_artifact_version", "record_artifact_input", "logs", "source", "finish"):
        assert op in got, op
    create = recs[0]
    assert create["name"] == "n" and create["group"] == "g" and create["notes"] == "hi"
    assert create["env"]["python_version"] and create["project"] == "My Project"
    assert [r["tags"] for r in recs if r["op"] == "set_tags"] == [["a", "b"], ["b"]]
    rule = next(r for r in recs if r["op"] == "set_metric_rule")
    assert (rule["name"], rule["summary"], rule["x"]) == ("loss", "min", "epoch")
    assert sum(1 for r in recs if r["op"] == "set_metric_rule") == 1  # once, not per track()
    points = [p for r in recs if r["op"] == "batch" for p in r["points"]]
    assert {p["name"] for p in points} == {"loss", "epoch", "img", "gal", "system.cpu"}
    # Every blob is on disk before the record naming it, and is complete.
    rd = RunDir.for_run(run.id)
    for r in recs:
        for h in record_blobs(r):
            assert (rd.blobs_dir / h).exists()
    seqs = [r["seq"] for r in recs]
    assert seqs == list(range(1, len(recs) + 1))
    assert recs[-1]["op"] == "finish"


def test_records_apply_with_the_ingest_code(env) -> None:
    """End to end against 0.5's apply code: what the Reader sees."""
    other = cairn.Run("p", **QUIET)
    other.finish()
    run = cairn.Run("p", name="n", tags=["a"], capture_source=True, capture_stdout=True,
                    capture_env=True, capture_system_metrics=False)
    run.config(lr=1e-3)
    for i in range(5):
        run.track(float(i), "loss", i, summary="min")
    run.track(cairn.Image(np.zeros((4, 4, 3), dtype=np.uint8)), "img", 1)
    run.summary(best=0.5)
    run.set_tag("b")
    run.add_note("hello")
    av = run.log_artifact(b"weights", "ckpt", type="model")
    run.use_run(other)
    print("console line")
    run.finish()

    ingest(env / "repo", [RunDir.for_run(other.id), RunDir.for_run(run.id)])
    reader = cairn.Reader(repo=env / "repo")
    r = reader.run(run.id)
    assert r.config == {"lr": 1e-3}
    assert r.summary == {"best": 0.5}
    assert set(r.tags) == {"a", "b"}
    assert r.status == "completed"
    assert [p.scalar_value for p in r.sequence("loss").points] == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert [p.step for p in r.sequence("img").points] == [1]
    assert [u.id for u in r.uses()] == [other.id]
    assert any("console line" in line.content for line in r.logs())
    assert r.source_tree()
    v = reader.artifact("ckpt", project="p")
    assert v.id == av.id and v.version == 1 and v.get() == b"weights"


def test_resume_continues_the_log_in_place(env) -> None:
    run = cairn.Run("p", tags=["t"], **QUIET)
    run.config(lr=1)
    run.track(1.0, "loss", 0)
    run._track_sample("system.cpu", 1.0)
    run.finish("killed")
    n = len(records(run.id))
    again = cairn.Run("p", resume=run.id, **QUIET)
    assert again.id == run.id and again._tags == ["t"]
    assert again._docs["config"] == {"lr": 1}
    assert again._step_counters["system.cpu"] == 1
    again.set_tag("u")
    again.finish()
    recs = records(run.id)
    assert recs[n]["op"] == "resume_run" and recs[n]["seq"] == n + 1
    assert recs[n + 1]["tags"] == ["t", "u"]


def test_rewind_and_resume_refuse_a_live_run(env) -> None:
    run = cairn.Run("p", **QUIET)
    with pytest.raises(ValueError, match="in use"):
        cairn.Run("p", resume=run.id, **QUIET)
    run.finish()
    rw = cairn.Run("p", resume=run.id, rewind_to=0, **QUIET)
    rw.finish()
    assert ops(run.id)[-2:] == ["rewind_run", "finish"]


def test_resume_elsewhere_asks_the_server(env, monkeypatch) -> None:
    monkeypatch.setattr(ServerReads, "run", lambda self, rid: {
        "run": {"project_id": "q", "tags": '["x"]', "version": 3, "status": "killed"},
        "config_doc": {"a": 1}, "summary_doc": {},
    })
    monkeypatch.setattr(ServerReads, "sequences", lambda self, rid: [{"name": "system.cpu", "max_step": 9}])
    run = cairn.Run("q", resume="abc", **QUIET)
    assert run.version == 3 and run.project == "q" and run._tags == ["x"]
    assert run._step_counters["system.cpu"] == 10
    run.finish()
    recs = records("abc")
    assert recs[0]["op"] == "resume_run" and recs[0]["seq"] == 1
    # A new log of a run whose "main" is elsewhere: its own name on the server.
    name = RunDir.for_run("abc").log().name
    assert name.startswith("main.") and name != "main"


def test_a_worker_away_from_its_primary_gets_its_own_log_name(env) -> None:
    w = cairn.attach("feed", label="rank3", project="p", system_metrics=False, capture_output=False)
    w.finish()
    ref = RunDir.for_run("feed").log("rank3")
    assert ref.name.startswith("rank3.")
    run = cairn.Run("p", run_id="beef", **QUIET)
    w2 = cairn.attach("beef", label="rank3", system_metrics=False, capture_output=False)
    w2.finish()
    run.finish()
    assert RunDir.for_run("beef").log("rank3").name == "rank3"  # next to its primary
    # A second process of the same label continues its log, name and all.
    w3 = cairn.attach("feed", label="rank3", project="p", system_metrics=False, capture_output=False)
    w3.finish()
    assert RunDir.for_run("feed").log("rank3").name == ref.name
    assert ops("feed", "rank3") == ["join", "detach", "join", "detach"]


def test_resume_elsewhere_offline_is_a_clear_error(env) -> None:
    with pytest.raises(ServerUnavailable, match="cannot reach"):
        cairn.Run("p", resume="nope", **QUIET)


def test_fork_from_a_local_run(env) -> None:
    parent = cairn.Run("p", **QUIET)
    parent.config(lr=2)
    parent.track(1.0, "loss", 5)
    parent.finish()
    child = cairn.Run("p", fork_from=(parent.id, 3), name="c", **QUIET)
    assert child.id != parent.id and child._docs["config"] == {"lr": 2}
    child.finish()
    first = records(child.id)[0]
    assert first["op"] == "fork_run" and first["parent_id"] == parent.id
    assert first["new_id"] == child.id and first["step"] == 3 and first["name"] == "c"


def test_attach_writes_its_own_log(env) -> None:
    run = cairn.Run("p", **QUIET)
    w = cairn.attach(run.id, label="rank1", system_metrics=False, capture_output=False)
    assert w.project == "p"
    with pytest.raises(ValueError, match="in use"):
        cairn.attach(run.id, label="rank1", system_metrics=False, capture_output=False)
    with pytest.raises(ValueError, match="reserved"):
        cairn.attach(run.id, label="main", system_metrics=False, capture_output=False)
    w.track(2.0, "w.loss", 0)
    w.finish()
    run.finish()
    rd = RunDir.for_run(run.id)
    assert ops(run.id, "rank1") == ["join", "batch", "detach"]
    assert rd.log("rank1").finished()["status"] == "detached"
    assert [x.name for x in rd.logs()] == ["main", "rank1"]
    assert "finish" not in ops(run.id, "rank1")


def test_attach_before_the_primary_and_offline_needs_a_project(env, monkeypatch) -> None:
    monkeypatch.setattr(cairn.Run, "JOIN_WAIT", 0.3)
    with pytest.raises(LookupError, match="project="):
        cairn.attach("feedbeef", label="rank1", system_metrics=False, capture_output=False)
    w = cairn.attach("feedbeef", label="rank1", project="p", system_metrics=False,
                     capture_output=False)
    w.finish()
    # The primary arrives later on the same machine.
    run = cairn.Run("p", run_id="feedbeef", **QUIET)
    run.finish()
    assert ops("feedbeef") == ["create_run", "finish"]


def test_use_artifact_by_ref_needs_the_server(env) -> None:
    run = cairn.Run("p", **QUIET)
    with pytest.raises(ServerUnavailable, match="use_artifact"):
        run.use_artifact("other/data:best")
    run.finish()


def test_use_run_unknown_offline_is_recorded(env) -> None:
    run = cairn.Run("p", **QUIET)
    run.use_run("somewhere-else")
    with pytest.raises(ValueError):
        run.use_run(run.id)
    run.finish()
    assert ops(run.id).count("record_run_use") == 1


def test_version_is_none_until_the_server_confirms(env) -> None:
    run = cairn.Run("p", name="n", **QUIET)
    assert run.version is None
    run.finish()


def test_duplicate_id_refused(env) -> None:
    run = cairn.Run("p", run_id="dup", **QUIET)
    run.finish()
    with pytest.raises(ValueError, match="exists already"):
        cairn.Run("p", run_id="dup", **QUIET)


def test_heartbeats_are_records(env, monkeypatch) -> None:
    monkeypatch.setattr(cairn.Run, "_HEARTBEAT_INTERVAL", 0.05)
    run = cairn.Run("p", **QUIET)
    time.sleep(0.3)
    run.finish()
    assert ops(run.id).count("heartbeat") >= 2


def test_disabled_mode_writes_nothing(env) -> None:
    run = cairn.Run("p", mode="disabled")
    run.track(1.0, "x", 0)
    run.finish()
    assert not (env / "cd").exists()


# ---- with the uploader ---------------------------------------------------------------


def _stop_daemon(base: Path) -> None:
    try:
        pid = int((base / "agent.pid").read_text())
        os.kill(pid, signal.SIGTERM)
    except (OSError, ValueError):
        pass
    deadline = time.monotonic() + 10
    while agent.is_running(base) and time.monotonic() < deadline:
        time.sleep(0.05)


def test_finish_waits_for_the_upload(env, monkeypatch, capsys) -> None:
    monkeypatch.setenv("CAIRN_UPLOADER", "on")
    monkeypatch.setenv("CAIRN_AGENT_IDLE_EXIT", "2")
    served = FakeIngest().serve()
    try:
        run = cairn.Run("p", server=served.url, **QUIET)
        for i in range(100):
            run.track(float(i), "loss", i)
        run.finish()
        assert "not confirmed" not in capsys.readouterr().err
        rd = RunDir.for_run(run.id)
        served.fake.assert_exactly_once(run.id, "main", rd.log().last_seq())
    finally:
        _stop_daemon(env / "agent")
        served.close()


def test_finish_timeout_notice(env, monkeypatch, capsys) -> None:
    monkeypatch.setenv("CAIRN_UPLOADER", "on")
    monkeypatch.setenv("CAIRN_FINISH_TIMEOUT", "1")
    try:
        run = cairn.Run("p", server="http://127.0.0.1:9", **QUIET)
        run.track(1.0, "loss", 0)
        t0 = time.monotonic()
        run.finish()
        assert time.monotonic() - t0 < 5
        err = capsys.readouterr().err
        assert "not confirmed" in err and "cairn sync" in err
        assert RunDir.for_run(run.id).log().acked() == 0
    finally:
        _stop_daemon(env / "agent")
