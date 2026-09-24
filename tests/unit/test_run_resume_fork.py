"""Resume, fork and rewind (C1): the ops, the routes, and the SDK on every
write path — HTTP, LocalTransport direct, LocalTransport WAL (replayed)."""

from __future__ import annotations

import json

import pytest

import cairn
from cairn.server import artifact_registry_ops, ingest_ops
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all
from cairn.sdk.transport import Transport

QUIET = dict(
    capture_source=False, capture_stdout=False, capture_env=False,
    capture_system_metrics=False,
)


def _pt(name, step, wall, value=None):
    return {
        "name": name, "step": step, "wall_time": wall,
        "object_type": "scalar", "scalar_value": float(step if value is None else value),
    }


def _wall(i: int) -> str:
    return f"2024-01-01T00:00:{i:02d}+00:00"


@pytest.fixture(autouse=True)
def _reset_active_run():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _seed_parent(db, blobs) -> str:
    """loss at steps 0..9 (wall = step), system.cpu samples 0..19 (wall = i),
    a per-step artifact at steps 2 and 8, a run-level one, params, summary,
    metric defs."""
    rid = ingest_ops.create_run(db, project="p", name="parent")["run_id"]
    ingest_ops.insert_batch(db, rid, [_pt("loss", s, _wall(s)) for s in range(10)])
    ingest_ops.insert_batch(db, rid, [_pt("system.cpu", i, _wall(i)) for i in range(20)])
    digest = ingest_ops.put_artifact(db, blobs, b"x", "application/octet-stream")["hash"]
    for step in (None, 2, 8):
        ingest_ops.attach_artifact(db, blobs, rid, "ckpt", digest, step)
    ingest_ops.set_params(db, rid, {"lr": 0.1})
    ingest_ops.set_summary(db, rid, {"best": 1.0})
    db.write(
        "INSERT INTO metric_defs (run_id, name, x, summary) VALUES (?, ?, ?, ?)",
        [rid, "loss", "epoch", "min"],
    )
    ingest_ops.finish_run(db, rid, "killed", exit_code=137)
    return rid


def _steps(db, rid, name):
    return [r["step"] for r in db.read_columns(
        "SELECT step FROM sequences WHERE run_id = ? AND name = ? ORDER BY step", [rid, name],
    )]


# ---- ingest_ops ------------------------------------------------------------


def test_fork_copies_history_up_to_the_step(fresh_db, blob_store):
    db = fresh_db
    parent = _seed_parent(db, blob_store)
    child = ingest_ops.fork_run(db, parent_id=parent, step=4, run_id="c" * 32, name="kid")

    assert child["run_id"] == "c" * 32 and child["project_id"] == "p"
    row = db.read_columns("SELECT * FROM runs WHERE id = ?", [child["run_id"]])[0]
    assert (row["parent_run_id"], row["fork_step"], row["display_name"]) == (parent, 4, "kid")
    assert row["status"] == "running"
    assert _steps(db, child["run_id"], "loss") == [0, 1, 2, 3, 4]
    # system.* is cut by time: up to the wall time of the last kept loss point.
    assert _steps(db, child["run_id"], "system.cpu") == [0, 1, 2, 3, 4]
    assert sorted(r["step"] for r in db.read_columns(
        "SELECT step FROM run_artifacts WHERE run_id = ?", [child["run_id"]])) == [-1, 2]
    assert db.read_one("SELECT value FROM params WHERE run_id = ?", [child["run_id"]]) == ("0.1",)
    assert db.read_one("SELECT value FROM summary WHERE run_id = ?", [child["run_id"]]) == ("1.0",)
    assert db.read_columns(
        "SELECT name, x, summary FROM metric_defs WHERE run_id = ?", [child["run_id"]],
    ) == [{"name": "loss", "x": "epoch", "summary": "min"}]
    # The parent is untouched.
    assert _steps(db, parent, "loss") == list(range(10))


def test_fork_replay_is_idempotent_and_keeps_the_childs_writes(fresh_db, blob_store):
    db = fresh_db
    parent = _seed_parent(db, blob_store)
    kid = ingest_ops.fork_run(db, parent_id=parent, step=4, run_id="c" * 32)["run_id"]
    ingest_ops.set_params(db, kid, {"lr": 0.5})
    ingest_ops.fork_run(db, parent_id=parent, step=4, run_id=kid)
    assert db.read_one("SELECT value FROM params WHERE run_id = ?", [kid]) == ("0.5",)
    assert _steps(db, kid, "loss") == [0, 1, 2, 3, 4]
    assert db.read_one("SELECT COUNT(*) FROM runs") == (2,)


def test_rewind_drops_later_history_bumps_epoch_and_resumes(fresh_db, blob_store):
    db = fresh_db
    rid = _seed_parent(db, blob_store)
    db.write("UPDATE runs SET stop_requested = 'now' WHERE id = ?", [rid])

    out = ingest_ops.rewind_run(db, rid, 6)

    assert out["run_id"] == rid and out["project_id"] == "p"
    assert _steps(db, rid, "loss") == list(range(7))
    assert _steps(db, rid, "system.cpu") == list(range(7))
    assert sorted(r["step"] for r in db.read_columns(
        "SELECT step FROM run_artifacts WHERE run_id = ?", [rid])) == [-1, 2]
    row = db.read_columns("SELECT * FROM runs WHERE id = ?", [rid])[0]
    assert row["data_epoch"] == 1
    assert (row["status"], row["ended_at"], row["exit_code"], row["stop_requested"]) == (
        "running", None, None, None,
    )


def test_resume_reopens_the_run(fresh_db, blob_store):
    db = fresh_db
    rid = _seed_parent(db, blob_store)
    ingest_ops.set_tags(db, rid, ["a"])
    out = ingest_ops.resume_run(db, rid)
    assert out["tags"] == ["a"]
    row = db.read_columns("SELECT * FROM runs WHERE id = ?", [rid])[0]
    assert (row["status"], row["ended_at"], row["exit_code"]) == ("running", None, None)
    assert row["data_epoch"] == 0  # resume alone keeps the history
    assert _steps(db, rid, "loss") == list(range(10))
    with pytest.raises(ingest_ops.RunNotFound):
        ingest_ops.resume_run(db, "nope")


def test_lineage_has_fork_edges_only_for_the_project_graph(fresh_db, blob_store):
    db = fresh_db
    parent = _seed_parent(db, blob_store)
    kid = ingest_ops.fork_run(db, parent_id=parent, step=4)["run_id"]
    graph = artifact_registry_ops.get_lineage_graph(db, "p")
    assert graph["edges"] == [{"source": parent, "target": kid, "relation": "forked"}]
    runs = {n["id"]: n for n in graph["nodes"]}
    assert runs[parent]["label"] == "parent" and runs[kid]["type"] == "run"
    fam = artifact_registry_ops.get_lineage_graph(db, "p", family_id="none")
    assert fam["edges"] == []


# ---- routes ----------------------------------------------------------------


def _http_parent(client) -> str:
    rid = client.post("/api/runs", json={"project": "p", "name": "parent"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/batch", json={"points": [_pt("loss", s, _wall(s)) for s in range(10)]})
    client.post(f"/api/runs/{rid}/params", json={"params": {"lr": 0.1}})
    client.post(f"/api/runs/{rid}/finish", json={"status": "killed"})
    return rid


def test_routes_resume_rewind_fork(client):
    rid = _http_parent(client)

    r = client.post(f"/api/runs/{rid}/resume")
    assert r.status_code == 200, r.text
    assert client.get(f"/api/runs/{rid}").json()["run"]["status"] == "running"

    before = client.get(f"/api/runs/{rid}/updates").json()
    assert before["data_epoch"] == 0
    seq = client.get(f"/api/runs/{rid}/sequences/loss").json()
    assert seq["data_epoch"] == 0

    r = client.post(f"/api/runs/{rid}/rewind", json={"step": 3})
    assert r.status_code == 200, r.text
    after = client.get(f"/api/runs/{rid}/updates").json()
    assert after["data_epoch"] == 1
    assert [p["step"] for p in after["points"]] == [0, 1, 2, 3]
    assert client.get(f"/api/runs/{rid}/sequences/loss").json()["data_epoch"] == 1
    listed = client.get("/api/runs").json()["runs"][0]
    assert listed["data_epoch"] == 1

    r = client.post(f"/api/runs/{rid}/fork", json={"step": 1, "new_id": "d" * 32, "name": "kid",
                                                   "group": "g"})
    assert r.status_code == 200, r.text
    kid = client.get(f"/api/runs/{'d' * 32}").json()["run"]
    assert (kid["parent_run_id"], kid["fork_step"], kid["display_name"], kid["group"]) == (
        rid, 1, "kid", "g",
    )
    pts = client.get(f"/api/runs/{'d' * 32}/sequences/loss").json()["points"]
    assert [p["step"] for p in pts] == [0, 1]

    assert client.post("/api/runs/nope/resume").status_code == 404
    assert client.post("/api/runs/nope/rewind", json={"step": 1}).status_code == 404
    assert client.post("/api/runs/nope/fork", json={"step": 1}).status_code == 404


# ---- SDK on every write path ---------------------------------------------------


class _Http:
    def __init__(self, client):
        self.client = client

    def run(self, **kw):
        t = Transport("http://testserver", client=self.client, max_retries=1)
        return cairn.Run(project="p", transport=t, **QUIET, **kw)

    def drain(self):
        pass

    def rows(self, sql, params=()):
        return self.client.app.state.db.read_columns(sql, list(params))

    def close(self):
        pass


class _Local:
    def __init__(self, repo, wal):
        self.repo, self.wal = repo, wal
        self._db = None

    def run(self, **kw):
        return cairn.Run(project="p", repo=self.repo, local_wal=self.wal, **QUIET, **kw)

    def drain(self):
        if self.wal:
            dd = DataDir(self.repo)
            db = Database.open(dd.db_path)
            try:
                ingest_all(dd, db, BlobStore(dd.artifacts_dir))
            finally:
                db.close()

    def rows(self, sql, params=()):
        db = Database.open(DataDir(self.repo).db_path)
        try:
            return db.read_columns(sql, list(params))
        finally:
            db.close()

    def close(self):
        pass


@pytest.fixture(params=["http", "direct", "wal"])
def backend(request, tmp_path):
    if request.param == "http":
        return _Http(request.getfixturevalue("client"))
    return _Local(tmp_path / ".cairn", wal=request.param == "wal")


def _parent_run(backend) -> str:
    run = backend.run(name="parent", tags=["base"])
    for s in range(10):
        run.track(float(s), name="loss", step=s)
    for _ in range(5):
        run._track_sample("system.cpu", 1.0)
    run.config(lr=0.1)
    run.finish("killed")
    backend.drain()
    return run.id


def _series_steps(backend, rid, name):
    return [r["step"] for r in backend.rows(
        "SELECT step FROM sequences WHERE run_id = ? AND name = ? ORDER BY step", [rid, name],
    )]


def test_sdk_resume_continues_the_run(backend):
    rid = _parent_run(backend)
    run = backend.run(resume=rid)
    assert run.id == rid
    run.set_tag("resumed")  # keeps the run's stored tags
    run.track(10.0, name="loss", step=10)
    run._track_sample("system.cpu", 2.0)
    run.finish()
    backend.drain()

    row = backend.rows("SELECT * FROM runs WHERE id = ?", [rid])[0]
    assert row["status"] == "completed" and row["data_epoch"] == 0
    assert json.loads(row["tags"]) == ["base", "resumed"]
    assert _series_steps(backend, rid, "loss") == list(range(11))
    # The sampler counter continued instead of colliding with steps 0..4.
    assert _series_steps(backend, rid, "system.cpu") == list(range(6))


def test_sdk_rewind(backend):
    rid = _parent_run(backend)
    run = backend.run(resume=rid, rewind_to=4)
    run.track(-5.0, name="loss", step=5)
    run.finish()
    backend.drain()

    row = backend.rows("SELECT * FROM runs WHERE id = ?", [rid])[0]
    assert row["status"] == "completed" and row["data_epoch"] >= 1
    pts = backend.rows(
        "SELECT step, scalar_value FROM sequences WHERE run_id = ? AND name = 'loss' ORDER BY step",
        [rid],
    )
    assert [(p["step"], p["scalar_value"]) for p in pts] == [
        (0, 0.0), (1, 1.0), (2, 2.0), (3, 3.0), (4, 4.0), (5, -5.0),
    ]


def test_sdk_fork(backend):
    rid = _parent_run(backend)
    run = backend.run(fork_from=(rid, 6), name="kid")
    assert run.id != rid
    run.track(99.0, name="loss", step=7)
    run.finish()
    backend.drain()

    row = backend.rows("SELECT * FROM runs WHERE id = ?", [run.id])[0]
    assert (row["parent_run_id"], row["fork_step"], row["display_name"]) == (rid, 6, "kid")
    assert row["status"] == "completed"
    assert _series_steps(backend, run.id, "loss") == list(range(8))
    assert backend.rows("SELECT key FROM params WHERE run_id = ?", [run.id]) == [{"key": "lr"}]
    assert _series_steps(backend, rid, "loss") == list(range(10))


def test_sdk_argument_checks(tmp_path):
    with pytest.raises(ValueError, match="rewind_to"):
        cairn.Run(project="p", repo=tmp_path, rewind_to=3, **QUIET)
    with pytest.raises(ValueError, match="not both"):
        cairn.Run(project="p", repo=tmp_path, resume="a", fork_from=("b", 1), **QUIET)


def test_wal_resume_needs_an_ingested_run(tmp_path):
    with pytest.raises(LookupError, match="ingested"):
        cairn.Run(project="p", repo=tmp_path / ".cairn", local_wal=True, resume="f" * 32, **QUIET)
