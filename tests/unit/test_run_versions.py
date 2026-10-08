"""Server-assigned run versions: a run's number in its series (project,
group, name), never reused."""

from __future__ import annotations

import io
import sqlite3

import cairn
from cairn.sdk.local import LocalTransport
from cairn.server import wal_ingest
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.storage.migrations import apply_migrations
from cairn.server.wal_ingest import ingest_all

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}


def _create(client, name=None, group=None, project="p", **kw) -> dict:
    body = {"project": project, "name": name, "group": group, **kw}
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


# ---- local repo (run logs) --------------------------------------------------


class _Ingester:
    def __init__(self, repo):
        self.dd = DataDir(repo)
        self.db = Database.open(self.dd.db_path)
        self.blobs = BlobStore(self.dd.artifacts_dir)

    def ingest(self) -> int:
        return ingest_all(self.dd, self.db, self.blobs)

    def versions(self) -> dict[str, int | None]:
        return {r["id"]: r["version"] for r in self.db.read_columns("SELECT id, version FROM runs")}

    def counter(self, name: str) -> int:
        return self.db.read_one(
            "SELECT last_version FROM run_series WHERE name = ? AND grouped = 0", [name],
        )[0]

    def close(self) -> None:
        self.db.close()


def test_log_create_is_numbered_once_under_a_restart_mid_ingest(tmp_path, monkeypatch):
    """The ingester dies while applying the second run's create (after it
    took a number): the rollback takes the counter back with it, so after the
    restart the runs are 1 and 2, not 1 and 3. A restarted ingester never
    re-applies an ingested create."""
    repo = tmp_path / ".cairn"
    ids = ["1" * 32, "2" * 32]
    for rid in ids:
        t = LocalTransport(repo)
        t.create_run({"project": "p", "run_id": rid, "name": "train"})
        t.rename_run(rid, "train")  # same name: no new number
        t.close()

    real = wal_ingest._apply_record
    calls = {"n": 0}

    def dying(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 3:  # the second log's create, after the first's
            raise sqlite3.OperationalError("simulated crash before commit")
        return real(*a, **kw)

    first = _Ingester(repo)
    monkeypatch.setattr(wal_ingest, "_apply_record", dying)
    first.ingest()
    monkeypatch.setattr(wal_ingest, "_apply_record", real)
    first.close()  # the restart

    second = _Ingester(repo)
    second.ingest()
    assert sorted(second.versions().values()) == [1, 2]
    assert second.counter("train") == 2
    second.ingest()
    assert second.counter("train") == 2
    second.close()

    t = LocalTransport(repo)
    t.create_run({"project": "p", "run_id": "3" * 32, "name": "train"})
    t.rename_run(ids[0], "eval")
    t.close()
    third = _Ingester(repo)
    third.ingest()
    v = third.versions()
    assert v["3" * 32] == 3 and v[ids[0]] == 1
    assert third.counter("train") == 3 and third.counter("eval") == 1
    third.close()


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


def test_migration_numbers_existing_runs(tmp_path):
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    # A database from before run versions (the columns the numbering reads).
    con.execute(
        "CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, "
        "display_name TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL, run_group TEXT)"
    )
    rows = [
        ("r3", "train", None, "2026-01-03"),
        ("r1", "train", None, "2026-01-01"),
        ("r2b", "train", None, "2026-01-02"),
        ("r2a", "train", None, "2026-01-02"),  # a tie: by id
        ("g1", "train", "exp-1", "2026-01-05"),
        ("u1", None, None, "2026-01-01"),
        ("e1", "eval", None, "2026-01-09"),
    ]
    con.executemany(
        "INSERT INTO runs (id, project_id, display_name, run_group, created_at, status) "
        "VALUES (?, 'p', ?, ?, ?, 'completed')", rows,
    )
    con.commit()
    apply_migrations(con)
    got = dict(con.execute("SELECT id, version FROM runs").fetchall())
    assert got == {"r1": 1, "r2a": 2, "r2b": 3, "r3": 4, "g1": 1, "u1": None, "e1": 1}
    counters = {
        (g, n): v for g, n, v in con.execute(
            "SELECT run_group, name, last_version FROM run_series"
        )
    }
    assert counters == {("", "train"): 4, ("exp-1", "train"): 1, ("", "eval"): 1}
    # Idempotent: a second run changes nothing.
    apply_migrations(con)
    assert dict(con.execute("SELECT id, version FROM runs").fetchall()) == got
    con.close()


# ---- cairn list ----------------------------------------------------------------


def test_cairn_list_shows_and_sorts_by_version(tmp_path):
    from click.testing import CliRunner

    from cairn import cli

    repo = tmp_path / ".cairn"
    for name in ("train", "train", "train", "evaluate"):
        cairn.Run("p", name=name, repo=repo, **QUIET).finish()
    result = CliRunner().invoke(
        cli.main, ["list", "--repo", str(repo), "--project", "p", "--sort", "version", "--asc"],
    )
    assert result.exit_code == 0, result.output
    rows = [line.split() for line in result.output.strip().splitlines()]
    assert rows[0][:3] == ["ID", "NAME", "VERSION"]
    assert [r[2] for r in rows[1:]] == ["1", "1", "2", "3"]
