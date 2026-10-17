"""Server-assigned run versions: a run's number in its series (project,
group, job_type, name), never reused."""

from __future__ import annotations

import io
import sqlite3

import pytest

import cairn
import json

from fastapi.testclient import TestClient

from cairn.backend import record_apply
from cairn.server.app import create_app
from cairn.backend.storage.blobs import BlobStore
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.db import Database
from cairn.backend.storage.migrations import UnsupportedSchema, apply_migrations

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}


def _create(client, name=None, group=None, project="p", job_type=None, **kw) -> dict:
    body = {"project": project, "name": name, "group": group, "job_type": job_type, **kw}
    r = client.post("/api/runs", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _version(client, run_id: str):
    return client.get(f"/api/runs/{run_id}").json()["run"]["version"]


# ---- HTTP -----------------------------------------------------------------


def test_series_is_project_group_name(client):
    a = _create(client, "train")
    b = _create(client, "train")
    g1 = _create(client, "train", group="exp-1")
    g2 = _create(client, "train", group="exp-1")
    other = _create(client, "train", project="q")
    ev = _create(client, "evaluate")
    unnamed = _create(client)
    assert [a["version"], b["version"]] == [1, 2]
    assert [g1["version"], g2["version"]] == [1, 2]
    assert other["version"] == 1 and ev["version"] == 1
    assert unnamed["version"] is None
    # An empty group is a group of its own, not the ungrouped series.
    assert _create(client, "train", group="")["version"] == 1
    # Detail, list and query rows carry it.
    assert _version(client, b["run_id"]) == 2
    rows = client.get("/api/runs", params={"project": "p", "sort": "version"}).json()["runs"]
    assert {r["id"]: r["version"] for r in rows}[g2["run_id"]] == 2
    assert [r["version"] for r in rows][-1] is None  # missing sorts last
    q = client.post("/api/runs/query", json={"project": "p"}).json()["runs"]
    assert {r["id"]: r["version"] for r in q}[a["run_id"]] == 1


def test_series_includes_the_job_type(client):
    # Fine-tune siblings with distinct names coexist, each its own v1.
    ft1 = _create(client, "ft-lr1e-4", group="exp-44", job_type="finetune")
    ft2 = _create(client, "ft-lr1e-5", group="exp-44", job_type="finetune")
    assert (ft1["version"], ft2["version"]) == (1, 1)
    # A re-run of the same (group, job_type, name) is v2.
    assert _create(client, "ft-lr1e-4", group="exp-44", job_type="finetune")["version"] == 2
    # The same name under another job type (or none) is another series.
    assert _create(client, "ft-lr1e-4", group="exp-44", job_type="eval")["version"] == 1
    assert _create(client, "ft-lr1e-4", group="exp-44")["version"] == 1
    assert _create(client, "ft-lr1e-4", group="exp-44")["version"] == 2
    # An empty job type is a job type of its own, not "none".
    assert _create(client, "ft-lr1e-4", group="exp-44", job_type="")["version"] == 1
    # Without a group the key is (job_type, name).
    assert _create(client, "train", job_type="train")["version"] == 1
    assert _create(client, "train")["version"] == 1
    row = client.get(f"/api/runs/{ft2['run_id']}").json()["run"]
    assert (row["group"], row["job_type"], row["version"]) == ("exp-44", "finetune", 1)


def test_job_type_change_moves_to_the_new_series(client):
    a = _create(client, "train", group="g", job_type="train")
    _create(client, "train", group="g", job_type="eval")
    r = client.patch(f"/api/runs/{a['run_id']}", json={"job_type": "eval"})
    assert r.json() == {"run_id": a["run_id"], "job_type": "eval", "version": 2}
    # The same job type again: no change.
    assert client.patch(f"/api/runs/{a['run_id']}", json={"job_type": "eval"}).json()["version"] == 2
    # Back: the next number there (1 stays taken).
    assert client.patch(f"/api/runs/{a['run_id']}", json={"job_type": "train"}).json()["version"] == 2
    # Cleared: the (g, none, train) series.
    r = client.patch(f"/api/runs/{a['run_id']}", json={"job_type": None})
    assert r.json()["version"] == 1
    run = client.get(f"/api/runs/{a['run_id']}").json()["run"]
    assert (run["job_type"], run["group"], run["display_name"], run["version"]) == (
        None, "g", "train", 1)
    # A rename and a group change keep the job type in the key.
    b = _create(client, "x", group="g", job_type="eval")
    assert client.patch(f"/api/runs/{b['run_id']}", json={"display_name": "train"}).json()[
        "version"] == 3
    assert client.patch(f"/api/runs/{b['run_id']}", json={"group": "h"}).json()["version"] == 1


def test_numbers_are_never_reused_after_delete(client):
    a = _create(client, "train")
    b = _create(client, "train")
    for run in (a, b):
        assert client.delete(f"/api/runs/{run['run_id']}").status_code == 200
    assert _create(client, "train")["version"] == 3


def test_rename_and_group_change_move_to_the_new_series(client):
    a = _create(client, "train")
    _create(client, "eval")
    r = client.patch(f"/api/runs/{a['run_id']}", json={"display_name": "eval"})
    assert r.json()["version"] == 2
    # Same name again: no change.
    r = client.patch(f"/api/runs/{a['run_id']}", json={"display_name": "eval"})
    assert r.json()["version"] == 2
    # The old number is not reused in the old series...
    assert _create(client, "train")["version"] == 2
    # ...and renaming back takes the next number there, not the old one.
    r = client.patch(f"/api/runs/{a['run_id']}", json={"display_name": "train"})
    assert r.json()["version"] == 3
    r = client.patch(f"/api/runs/{a['run_id']}", json={"group": "exp-1"})
    assert r.json() == {"run_id": a["run_id"], "group": "exp-1", "version": 1}
    r = client.patch(f"/api/runs/{a['run_id']}", json={"group": None})
    assert r.json()["version"] == 4
    run = client.get(f"/api/runs/{a['run_id']}").json()["run"]
    assert run["group"] is None and run["display_name"] == "train" and run["version"] == 4
    # Notes alone change nothing.
    client.patch(f"/api/runs/{a['run_id']}", json={"notes": "x"})
    assert _version(client, a["run_id"]) == 4


def test_concurrent_renames_allocate_each_series_number_once(data_dir):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from cairn.backend import ingest_ops

    db = Database.open(data_dir.db_path)
    try:
        runs = [ingest_ops.create_run(db, project='parallel', name=f'run-{i}')['run_id']
                for i in range(8)]
    finally:
        db.close()
    ready = Barrier(len(runs))

    def rename(run_id):
        connection = Database.open(data_dir.db_path)
        try:
            ready.wait(timeout=10)
            return ingest_ops.rename_run(connection, run_id, 'shared')['version']
        finally:
            connection.close()

    with ThreadPoolExecutor(max_workers=len(runs)) as pool:
        versions = list(pool.map(rename, runs))
    assert sorted(versions) == list(range(1, 9))


def test_resume_join_keep_and_fork_takes_next(client):
    a = _create(client, "train")
    rid = a["run_id"]
    client.post(f"/api/runs/{rid}/finish", json={"status": "completed"})
    assert client.post(f"/api/runs/{rid}/resume", json={}).json()["version"] == 1
    joined = client.post("/api/runs", json={"project": "p", "run_id": rid, "primary": False})
    assert joined.json()["version"] == 1
    fork = client.post(f"/api/runs/{rid}/fork", json={"step": 0, "name": "train"}).json()
    assert fork["version"] == 2
    assert _version(client, rid) == 1


def test_import_takes_the_next_number(client):
    a = _create(client, "train")
    _create(client, "train")
    exported = client.post("/api/export", json={"run_ids": [a["run_id"]]})
    imported = client.post(
        "/api/import",
        files={"file": ("runs.zip", io.BytesIO(exported.content), "application/zip")},
    ).json()["imported"]
    assert _version(client, imported[0]["new_id"]) == 3


# ---- uploaded run logs ----------------------------------------------------


def _versions(db) -> dict[str, int | None]:
    return {r["id"]: r["version"] for r in db.read_columns("SELECT id, version FROM runs")}


def _counter(db, name: str) -> int:
    return db.read_one(
        "SELECT last_version FROM run_series WHERE name = ? AND grouped = 0", [name],
    )[0]


def _create_records(rid: str, name: str, **extra) -> list[dict]:
    return [
        {"seq": 1, "op": "create_run", "payload": {"project": "p", "run_id": rid, "name": name, **extra}},
        {"seq": 2, "op": "rename_run", "payload": {"run_id": rid, "name": name}},  # no new number
    ]


def test_upload_is_numbered_once_when_the_apply_fails_mid_batch(tmp_path, monkeypatch):
    """The server fails while applying the second run's create (after it
    took a number): the batch's transaction rolls back with the counter, so
    once the uploader retries the runs are 1 and 2, not 1 and 3; a replayed
    batch is not applied again."""
    ids = ["1" * 32, "2" * 32]
    real = record_apply._apply_record
    calls = {"n": 0}

    def dying(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 3:  # the second run's create
            raise sqlite3.OperationalError("simulated crash before commit")
        return real(*a, **kw)

    app = create_app(data_dir=tmp_path / ".cairn", auth_enabled=False)
    with TestClient(app, raise_server_exceptions=False) as client:
        def upload(rid: str) -> int:
            return client.post(f"/api/ingest/runs/{rid}/logs/main", json={
                "from_seq": 1, "records": _create_records(rid, "train"),
            }).status_code

        monkeypatch.setattr(record_apply, "_apply_record", dying)
        assert upload(ids[0]) == 200
        assert upload(ids[1]) == 500
        monkeypatch.setattr(record_apply, "_apply_record", real)
        assert upload(ids[1]) == 200
        db = app.state.db
        assert sorted(_versions(db).values()) == [1, 2]
        assert _counter(db, "train") == 2
        assert upload(ids[0]) == 200 and upload(ids[1]) == 200  # replays
        assert _counter(db, "train") == 2
        r = client.post(f"/api/ingest/runs/{ids[0]}/logs/main", json={
            "from_seq": 3,
            "records": [{"seq": 3, "op": "rename_run", "payload": {"run_id": ids[0], "name": "eval"}}],
        })
        assert r.json() == {"applied_seq": 3}
        assert client.post(f"/api/ingest/runs/{'3' * 32}/logs/main", json={
            "from_seq": 1, "records": _create_records("3" * 32, "train"),
        }).status_code == 200
        v = _versions(db)
        assert v["3" * 32] == 3 and v[ids[0]] == 1
        assert _counter(db, "train") == 3 and _counter(db, "eval") == 1


def test_sdk_run_version_on_a_local_repo(tmp_path):
    repo = tmp_path / ".cairn"
    a = cairn.Run("p", name="train", repo=repo, **QUIET)
    assert a.version == 1
    a.track(1.0, "loss", 0)
    a.finish()
    b = cairn.Run("p", name="train", repo=repo, **QUIET)
    worker = cairn.attach(b.id, repo=repo, label="w")
    assert worker.version == 2
    worker.finish()
    b.finish()
    resumed = cairn.Run("p", resume=a.id, repo=repo, **QUIET)
    assert resumed.version == 1
    resumed.finish()
    fork = cairn.Run("p", name="train", fork_from=(a.id, 0), repo=repo, **QUIET)
    assert fork.version == 3
    fork.finish()
    unnamed = cairn.Run("p", repo=repo, **QUIET)
    assert unnamed.version is None
    unnamed.finish()
    with cairn.Reader(repo) as reader:
        assert reader.run(a.id).version == 1
        assert sorted(r.version or 0 for r in reader.runs("p").list()) == [0, 1, 2, 3]


def test_sdk_run_version_over_http(live_server, tmp_path, monkeypatch):
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    a = cairn.Run("p", name="train", group="exp-1", repo=live_server, **QUIET)
    a.finish()
    b = cairn.Run("p", name="train", group="exp-1", repo=live_server, **QUIET)
    b.finish()
    assert (a.version, b.version) == (1, 2)
    with cairn.Reader(live_server) as reader:
        run = reader.run(b.id)
        assert run.version == 2
        with run.edit() as e:
            e.rename("eval")
        assert run.version == 1  # first of its new series
        assert reader.run(b.id).version == 1


def test_reader_rename_on_a_local_repo(tmp_path):
    repo = tmp_path / ".cairn"
    for _ in range(2):
        cairn.Run("p", name="train", repo=repo, **QUIET).finish()
    with cairn.Reader(repo) as reader:
        run = reader.runs("p").list()[0]
        with run.edit() as e:
            e.rename("train-2")
        assert run.version == 1


# ---- migration ----------------------------------------------------------------


def test_old_run_numbering_requires_conversion_and_preserves_numbers(tmp_path):
    with sqlite3.connect(tmp_path / "old.db") as con:
        con.execute("CREATE TABLE runs (id TEXT PRIMARY KEY, job_type TEXT, version INTEGER)")
        con.executemany("INSERT INTO runs VALUES (?,?,?)", [('train','train',1),('eval','eval',2)])
        con.execute("CREATE TABLE run_series (project_id TEXT, name TEXT, last_version INTEGER)")
        con.execute("INSERT INTO run_series VALUES ('p','train',2)")
        con.commit()
        before = list(con.iterdump())
        with pytest.raises(UnsupportedSchema):
            apply_migrations(con)
        assert list(con.iterdump()) == before


# ---- cairn list ----------------------------------------------------------------
