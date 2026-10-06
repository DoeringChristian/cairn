"""A local run's log: every op appended to ``wals/<run_id>.wal.jsonl`` and
applied to the DB by ``wal_ingest`` exactly once (offset committed with the
ops), the log deleted once its finish is ingested, idle logs ``crashed``."""

from __future__ import annotations

import json
import os
import sqlite3
import time

import pytest

import cairn
from cairn.sdk.local import LocalTransport
from cairn.server import artifact_registry_ops, wal_ingest
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


def _quiet_run(repo, **kw) -> cairn.Run:
    return cairn.Run(repo=repo, **QUIET, **kw)


class _Repo:
    """The ingester's side of a repo (what the lease holder runs)."""

    def __init__(self, repo):
        self.dd = DataDir(repo)
        self.db = Database.open(self.dd.db_path)
        self.blobs = BlobStore(self.dd.artifacts_dir)

    def ingest(self) -> int:
        return ingest_all(self.dd, self.db, self.blobs)

    def one(self, sql, params=()):
        return self.db.read_one(sql, list(params))

    def close(self):
        self.db.close()


@pytest.fixture
def ing(tmp_path):
    r = _Repo(tmp_path / ".cairn")
    yield r
    r.close()


def test_versioned_artifact_lineage_survives_the_log(tmp_path):
    repo = tmp_path / ".cairn"
    with _quiet_run(repo, project="p", name="producer") as run:
        run.log_artifact(cairn.Text("weights"), "model", type="checkpoint")
        producer = run.id

    reader = cairn.Reader(repo=repo)
    try:
        graph = reader.lineage("p")
    finally:
        reader.close()
    versions = [n for n in graph["nodes"] if n["kind"] == "artifact_version"]
    assert [(v["name"], v["version"]) for v in versions] == [("model", 1)]
    assert {"source": producer, "target": versions[0]["id"], "kind": "produced"} in graph["edges"]


def test_record_artifact_input_is_replayed(tmp_path, ing):
    repo = tmp_path / ".cairn"
    with _quiet_run(repo, project="p") as run:
        run.log_artifact(cairn.Text("weights"), "model", type="checkpoint")
    ing.ingest()
    version = artifact_registry_ops.resolve_ref(ing.db, "p", "model:latest")

    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "c" * 32})["run_id"]
    t.record_artifact_input(rid, version["id"], "input")
    t.close()

    ing.ingest()
    rows = ing.db.read_columns("SELECT * FROM run_inputs WHERE run_id = ?", [rid])
    assert [(r["artifact_version_id"], r["role"]) for r in rows] == [(version["id"], "input")]


def test_each_record_is_applied_once_across_cycles(tmp_path, ing):
    """Ingesting a live log, then again after more records and its finish:
    nothing is applied twice (no version 2), and the finished log is deleted."""
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "a" * 32})["run_id"]
    art = cairn.Artifact("model")
    art.add(b"w", "w.bin")
    digest, _ = art._build_manifest(t, None)
    assert t.create_artifact_version("p", {
        "name": "model", "digest": digest, "created_by_run": rid, "version_id": "f" * 16,
    }) is None
    t.post_batch(rid, [{"name": "x", "step": 0, "wall_time": "2026-01-01T00:00:00+00:00",
                        "object_type": "scalar", "scalar_value": 1.0}])
    log = wal_ingest.log_path(ing.dd, rid)

    ing.ingest()
    ing.ingest()  # nothing new: a no-op
    assert ing.one("SELECT COUNT(*) FROM sequences") == (1,)
    t.post_batch(rid, [{"name": "x", "step": 1, "wall_time": "2026-01-01T00:00:01+00:00",
                        "object_type": "scalar", "scalar_value": 2.0}])
    t.finish_run(rid, "completed")
    t.close()
    ing.ingest()
    rows = ing.db.read_columns("SELECT version FROM artifact_versions")
    assert [r["version"] for r in rows] == [1]
    assert ing.one("SELECT COUNT(*) FROM sequences") == (2,)
    assert ing.one("SELECT status FROM runs WHERE id = ?", [rid]) == ("completed",)
    assert not log.exists()
    assert ing.one("SELECT COUNT(*) FROM wal_progress") == (0,)


def test_torn_last_line_is_read_next_cycle(tmp_path, ing):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "b" * 32})["run_id"]
    # Simulate a writer caught mid-append: half a record, no newline.
    t._wal_fh.write(b'{"seq":99,"op":"set_notes","payload":{"run_id":"' + rid.encode())
    t._wal_fh.flush()
    try:
        ing.ingest()
        assert ing.one("SELECT notes FROM runs WHERE id = ?", [rid]) == (None,)
        t._wal_fh.write(b'","notes":"hi"}}\n')
        t._wal_fh.flush()
        ing.ingest()
        assert ing.one("SELECT notes FROM runs WHERE id = ?", [rid]) == ("hi",)
    finally:
        t.close()


def test_reopening_a_torn_log_ends_the_torn_line(tmp_path, ing):
    """A writer killed mid-append, then the run resumed: the torn fragment is
    skipped, every later record is applied."""
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "e" * 32})["run_id"]
    t._wal_fh.write(b'{"seq":2,"op":"set_notes","payload":{"run_id":"')
    t._wal_fh.flush()
    t.close()  # "killed"
    ing.ingest()
    t2 = LocalTransport(repo)
    t2.resume_run(rid)
    t2.set_notes(rid, "after")
    t2.close()
    ing.ingest()
    assert ing.one("SELECT notes FROM runs WHERE id = ?", [rid]) == ("after",)


def test_offset_is_committed_with_the_ops(tmp_path, ing, monkeypatch):
    """The ingester dies after applying a batch's ops but before its commit:
    neither the ops nor the offset are stored, so the batch is applied again
    exactly once (no duplicates, no loss)."""
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "1" * 32})["run_id"]
    for i in range(5):
        t.alert(rid, {"alert_id": f"a{i}", "title": f"t{i}", "text": "", "level": "info"})
        t.post_batch(rid, [{"name": "x", "step": i, "wall_time": "2026-01-01T00:00:00+00:00",
                            "object_type": "scalar", "scalar_value": float(i)}])
    t.post_logs(rid, [{"stream": "stdout", "wall_time": "2026-01-01T00:00:00+00:00",
                       "line_no": 0, "content": "hello"}])
    t.close()

    real = wal_ingest._apply_record
    calls = {"n": 0}

    def dying(*a, **kw):
        calls["n"] += 1
        if calls["n"] == 9:  # mid-batch, after several ops were applied
            raise sqlite3.OperationalError("simulated crash before commit")
        return real(*a, **kw)

    monkeypatch.setattr(wal_ingest, "_apply_record", dying)
    ing.ingest()  # the batch rolls back
    assert ing.one("SELECT COUNT(*) FROM runs") == (0,)
    assert ing.one("SELECT COUNT(*) FROM wal_progress") == (0,)
    monkeypatch.setattr(wal_ingest, "_apply_record", real)
    ing.ingest()
    assert ing.one("SELECT COUNT(*) FROM sequences") == (5,)
    assert ing.one("SELECT COUNT(*) FROM alerts") == (5,)
    assert ing.one("SELECT COUNT(*) FROM log_lines") == (1,)
    combined = (ing.dd.logs_dir / rid / "combined.log").read_text()
    assert combined == "[stdout] hello\n"  # appended once, after the commit


def test_restart_does_not_reread_from_zero(tmp_path):
    """A new ingester (a restarted server) continues at the stored offset."""
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "2" * 32})["run_id"]
    t.alert(rid, {"alert_id": "x1", "title": "t", "text": "", "level": "info"})
    first = _Repo(repo)
    first.ingest()
    (offset,) = first.one('SELECT "offset" FROM wal_progress')
    first.close()
    assert offset == wal_ingest.log_path(DataDir(repo), rid).stat().st_size

    t.set_notes(rid, "later")
    second = _Repo(repo)
    applied = second.ingest()
    assert applied == 1  # only the new record
    assert second.one("SELECT notes FROM runs WHERE id = ?", [rid]) == ("later",)
    second.close()
    t.close()


def test_idle_log_marks_the_run_crashed_then_running_again(tmp_path, ing, monkeypatch):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "3" * 32})["run_id"]
    ing.ingest()
    log = wal_ingest.log_path(ing.dd, rid)
    old = time.time() - wal_ingest.STALE_SECONDS - 5
    os.utime(log, (old, old))
    assert wal_ingest.has_pending(ing.dd, ing.db)
    ing.ingest()
    assert ing.one("SELECT status FROM runs WHERE id = ?", [rid]) == ("crashed",)
    (title,) = ing.one("SELECT title FROM alerts WHERE run_id = ?", [rid])
    assert "crashed" in title
    assert not wal_ingest.has_pending(ing.dd, ing.db)
    t.heartbeat(rid)  # it was only quiet
    ing.ingest()
    assert ing.one("SELECT status, ended_at FROM runs WHERE id = ?", [rid]) == ("running", None)
    t.finish_run(rid, "completed")
    t.close()
    ing.ingest()
    assert ing.one("SELECT status FROM runs WHERE id = ?", [rid]) == ("completed",)


def test_legacy_files_are_cleaned_and_logs_read_from_zero(tmp_path, ing):
    wals = ing.dd.root / "wals"
    wals.mkdir(exist_ok=True)
    rid = "4" * 32
    (wals / f"{rid}.lock").write_text("123")
    (wals / f"{'5' * 32}.wal.done").write_text("{}\n")
    (wals / f"{rid}.wal.jsonl").write_text(
        json.dumps({"seq": 1, "op": "create_run", "payload": {"run_id": rid, "project": "p"}})
        + "\n"
    )
    ing.ingest()
    assert ing.one("SELECT status FROM runs WHERE id = ?", [rid]) == ("running",)
    assert sorted(p.name for p in wals.iterdir()) == [f"{rid}.wal.jsonl"]


def test_records_after_finish_are_refused(tmp_path):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    rid = t.create_run({"project": "p", "run_id": "6" * 32})["run_id"]
    t.finish_run(rid, "completed")
    t.set_notes(rid, "too late")
    t.close()
    lines = wal_ingest.log_path(DataDir(repo), rid).read_text().splitlines()
    assert [json.loads(line)["op"] for line in lines] == ["create_run", "finish"]


def test_read_columns_is_read_only_and_sees_ingested_rows(tmp_path):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo)
    try:
        # No DB file yet (nothing ever ingested): reads are empty.
        assert not DataDir(repo).db_path.exists()
        assert t.read_columns("SELECT id FROM runs") == []

        rid = t.create_run({"project": "p", "run_id": "d" * 32})["run_id"]
        # The run's own ops are invisible until the ingester applies them.
        r = _Repo(repo)
        r.ingest()
        r.close()
        assert t.read_columns("SELECT id, status FROM runs WHERE id = ?", [rid]) == [
            {"id": rid, "status": "running"}
        ]
        with pytest.raises(sqlite3.OperationalError):
            t.read_columns("UPDATE runs SET status = 'x'")
    finally:
        t.close()
