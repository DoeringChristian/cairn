"""WAL-mode LocalTransport: every op written to the per-run WAL and replayed
into the DB by ``wal_ingest`` — both the incremental drain (run still live)
and the full drain (lock gone)."""

from __future__ import annotations

import cairn
from cairn.sdk.local import LocalTransport
from cairn.server import artifact_registry_ops
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all


def _quiet_run(repo, **kw) -> cairn.Run:
    return cairn.Run(
        repo=repo, local_wal=True,
        capture_source=False, capture_stdout=False,
        capture_env=False, capture_system_metrics=False,
        **kw,
    )


def _drain(repo):
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    ingest_all(dd, db, BlobStore(dd.artifacts_dir))
    return db


def test_versioned_artifact_lineage_survives_wal(tmp_path):
    repo = tmp_path / ".cairn"
    with _quiet_run(repo, project="p", name="producer") as run:
        run.log_artifact(cairn.Text("weights"), name="model", artifact_type="checkpoint")
        producer = run.id

    reader = cairn.Reader(repo=repo)
    try:
        graph = reader.lineage("p")
    finally:
        reader.close()
    versions = [n for n in graph["nodes"] if n["type"] == "artifact_version"]
    assert [(v["family_name"], v["version"]) for v in versions] == [("model", 1)]
    assert {"source": producer, "target": versions[0]["id"], "relation": "produced"} in graph["edges"]


def test_record_artifact_input_is_replayed(tmp_path):
    repo = tmp_path / ".cairn"
    with _quiet_run(repo, project="p") as run:
        run.log_artifact(cairn.Text("weights"), name="model", artifact_type="checkpoint")
    db = _drain(repo)
    try:
        version = artifact_registry_ops.resolve_ref(db, "p", "model:latest")
    finally:
        db.close()

    t = LocalTransport(repo, use_wal=True)
    rid = t.create_run({"project": "p", "run_id": "c" * 32})["run_id"]
    t.record_artifact_input(rid, version["id"], "input")
    t.close()

    db = _drain(repo)
    try:
        rows = db.read_columns("SELECT * FROM run_inputs WHERE run_id = ?", [rid])
    finally:
        db.close()
    assert [(r["artifact_version_id"], r["role"]) for r in rows] == [(version["id"], "input")]


def test_incremental_then_full_drain_creates_one_version(tmp_path):
    """A live WAL is drained incrementally, then again in full once the lock
    goes; the version op must not create version 2 the second time."""
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo, use_wal=True)
    rid = t.create_run({"project": "p", "run_id": "a" * 32})["run_id"]
    digest = t.upload_artifact(b"w", "application/octet-stream")
    t.create_artifact_version("p", "model", "artifact", digest, 1, {}, rid, None)

    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    try:
        ingest_all(dd, db, blobs)  # lock present -> incremental
        t.finish_run(rid, "completed")
        t.close()  # lock removed
        ingest_all(dd, db, blobs)  # full re-read of the whole file
        rows = db.read_columns("SELECT version FROM artifact_versions")
        (status,) = db.read_one("SELECT status FROM runs WHERE id = ?", [rid])
    finally:
        db.close()
    assert [r["version"] for r in rows] == [1]
    assert status == "completed"


def test_torn_last_line_is_read_next_cycle(tmp_path):
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo, use_wal=True)
    rid = t.create_run({"project": "p", "run_id": "b" * 32})["run_id"]
    # Simulate a writer caught mid-append: half a record, no newline.
    t._wal_fh.write('{"seq":99,"op":"set_notes","payload":{"run_id":"' + rid)
    t._wal_fh.flush()
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    try:
        ingest_all(dd, db, blobs)
        assert db.read_one("SELECT notes FROM runs WHERE id = ?", [rid]) == (None,)
        t._wal_fh.write('","notes":"hi"}}\n')
        t._wal_fh.flush()
        ingest_all(dd, db, blobs)
        assert db.read_one("SELECT notes FROM runs WHERE id = ?", [rid]) == ("hi",)
    finally:
        t.close()
        db.close()
