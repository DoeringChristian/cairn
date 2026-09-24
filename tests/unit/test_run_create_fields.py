"""The optional create_run fields (created_at, group, job_type, sweep_id,
parent_run_id, fork_step, git.remote) and finish's ended_at, on every write
path: HTTP, LocalTransport direct, LocalTransport WAL (replayed), and the SDK
``Run(...)`` kwargs."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

import cairn
from cairn.sdk.local import LocalTransport
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all

CREATED = "2024-03-01T12:00:00+00:00"
ENDED = "2024-03-01T13:30:00+00:00"

FIELDS = {
    "project": "p",
    "name": "child",
    "created_at": CREATED,
    "group": "ablation-A",
    "job_type": "train",
    "sweep_id": "sw1",
    "parent_run_id": "parent01",
    "fork_step": 7,
    "git": {"sha": "abc", "branch": "main", "dirty": False, "remote": "https://github.com/o/r"},
}


def _check_row(row: dict, *, ended: bool) -> None:
    """``row`` is a raw ``runs`` row (``run_group`` column)."""
    assert row["run_group"] == "ablation-A"
    assert row["job_type"] == "train"
    assert row["sweep_id"] == "sw1"
    assert row["parent_run_id"] == "parent01"
    assert row["fork_step"] == 7
    assert row["git_remote"] == "https://github.com/o/r"
    assert row["data_epoch"] == 0
    assert row["stop_requested"] is None
    assert _ts(row["created_at"]) == _ts(CREATED)
    if ended:
        assert _ts(row["ended_at"]) == _ts(ENDED)


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def test_http_create_and_finish(client):
    rid = client.post("/api/runs", json=FIELDS).json()["run_id"]
    r = client.post(f"/api/runs/{rid}/finish", json={"status": "completed", "ended_at": ENDED})
    assert r.status_code == 200, r.text
    _check_row(client.app.state.db.read_columns("SELECT * FROM runs WHERE id = ?", [rid])[0], ended=True)

    # The API spells the column "group", on the detail and the list.
    run = client.get(f"/api/runs/{rid}").json()["run"]
    assert run["group"] == "ablation-A" and "run_group" not in run
    listed = client.get("/api/runs").json()["runs"][0]
    assert listed["group"] == "ablation-A" and "run_group" not in listed
    assert listed["job_type"] == "train" and listed["parent_run_id"] == "parent01"
    assert listed["fork_step"] == 7 and listed["data_epoch"] == 0


def test_http_rejects_bad_timestamps(client):
    assert client.post("/api/runs", json={"project": "p", "created_at": "yesterday"}).status_code == 400
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    assert client.post(f"/api/runs/{rid}/finish", json={"ended_at": "later"}).status_code == 400


def test_list_filters_on_group_job_type_and_sweep(client):
    def mk(**kw):
        return client.post("/api/runs", json={"project": "p", **kw}).json()["run_id"]

    a = mk(group="g1", job_type="train", sweep_id="s1")
    b = mk(group="g1", job_type="eval")
    c = mk(group="g2", job_type="train", sweep_id="s1")

    def ids(**params):
        return {r["id"] for r in client.get("/api/runs", params=params).json()["runs"]}

    assert ids(group="g1") == {a, b}
    assert ids(job_type="train") == {a, c}
    assert ids(sweep_id="s1") == {a, c}
    assert ids(group="g1", job_type="train") == {a}
    assert client.get("/api/runs", params={"group": "g1"}).json()["total"] == 2


def test_list_include_params(client):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    other = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    client.post(f"/api/runs/{rid}/params", json={"params": {"lr": 0.01, "opt": {"name": "adam"}, "on": True}})

    runs = {r["id"]: r for r in client.get("/api/runs", params={"include": "params"}).json()["runs"]}
    assert runs[rid]["params"] == {"lr": 0.01, "opt.name": "adam", "on": True}
    assert runs[other]["params"] == {}
    # Without include the list stays lean.
    assert "params" not in client.get("/api/runs").json()["runs"][0]


def test_local_direct(tmp_path):
    t = LocalTransport(tmp_path / ".cairn")
    try:
        rid = t.create_run(FIELDS)["run_id"]
        t.finish_run(rid, "completed", ended_at=ENDED)
        _check_row(t.read_columns("SELECT * FROM runs WHERE id = ?", [rid])[0], ended=True)
    finally:
        t.close()


def test_local_wal_replayed(tmp_path):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo, use_wal=True)
    rid = t.create_run({**FIELDS, "run_id": "f" * 32})["run_id"]
    t.finish_run(rid, "completed", ended_at=ENDED)
    t.close()

    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    try:
        ingest_all(dd, db, BlobStore(dd.artifacts_dir))
        _check_row(db.read_columns("SELECT * FROM runs WHERE id = ?", [rid])[0], ended=True)
    finally:
        db.close()


def test_local_wal_dates_the_run_by_the_client_clock(tmp_path):
    """Without an explicit created_at the WAL still carries the client's
    creation time, and replay uses it instead of the (later) ingest time."""
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo, use_wal=True)
    before = datetime.now(timezone.utc)
    rid = t.create_run({"project": "p", "run_id": "e" * 32})["run_id"]
    t.close()
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    try:
        ingest_all(dd, db, BlobStore(dd.artifacts_dir))
        (created,) = db.read_one("SELECT created_at FROM runs WHERE id = ?", [rid])
    finally:
        db.close()
    assert before <= _ts(created) <= datetime.now(timezone.utc)


@pytest.mark.parametrize("local_wal", [False, True])
def test_sdk_run_kwargs(tmp_path, local_wal):
    repo = tmp_path / ".cairn"
    with cairn.Run(
        project="p", repo=repo, local_wal=local_wal,
        group="ablation-A", job_type="train", sweep_id="sw1",
        parent_run_id="parent01", fork_step=7,
        created_at=datetime.fromisoformat(CREATED),
        capture_source=False, capture_stdout=False,
        capture_env=False, capture_system_metrics=False,
    ) as run:
        rid = run.id
    reader = cairn.Reader(repo=repo)
    try:
        r = reader.run(rid)
        assert (r.group, r.job_type) == ("ablation-A", "train")
        assert [x.id for x in reader.runs("p").filter(group="ablation-A")] == [rid]
        assert reader.runs("p").filter(job_type="eval").list() == []
        raw = r._raw
        assert raw["sweep_id"] == "sw1" and raw["parent_run_id"] == "parent01"
        assert raw["fork_step"] == 7
        assert _ts(raw["created_at"]) == _ts(CREATED)
    finally:
        reader.close()
