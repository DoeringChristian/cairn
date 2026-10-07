"""LocalTransport full lifecycle: each op logged, applied by the ingester."""

from __future__ import annotations

import hashlib

import pytest

from cairn.sdk.local import LocalTransport


def _iso(i: int = 0) -> str:
    return f"2026-01-01T00:00:{i:02d}Z"


class _Logged:
    """A run's LocalTransport plus ``db``: the repo DB, caught up on the
    log at every access (what the lease holder does in the background)."""

    def __init__(self, repo):
        from cairn.server.storage.blobs import BlobStore
        from cairn.server.storage.db import Database

        self.t = LocalTransport(repo)
        self._db = Database.open(self.t.data_dir.db_path)
        self._blobs = BlobStore(self.t.data_dir.artifacts_dir)

    @property
    def db(self):
        from cairn.server.wal_ingest import ingest_all

        ingest_all(self.t.data_dir, self._db, self._blobs)
        return self._db

    def create_run(self, body):
        import secrets

        return self.t.create_run({"run_id": secrets.token_hex(16), **body})

    def __getattr__(self, name):
        return getattr(self.t, name)

    def close(self):
        self.t.close()
        self._db.close()


@pytest.fixture
def transport(tmp_path):
    t = _Logged(tmp_path / ".cairn")
    yield t
    t.close()


def test_create_run_writes_to_db(transport):
    resp = transport.create_run({"project": "p", "name": "r1"})
    # run ids are client-minted 128-bit hex (secrets.token_hex(16))
    assert len(resp["run_id"]) == 32
    rows = transport.db.read_columns("SELECT * FROM runs WHERE id = ?", [resp["run_id"]])
    assert rows[0]["status"] == "running"
    assert rows[0]["display_name"] == "r1"


def test_params_flattened_and_stored(transport):
    rid = transport.create_run({"project": "p"})["run_id"]
    transport.post_params(rid, {"hparams": {"lr": 0.01}, "flat": 1})
    rows = transport.db.read_columns(
        "SELECT key FROM params WHERE run_id = ? ORDER BY key", [rid]
    )
    assert [r["key"] for r in rows] == ["flat", "hparams.lr"]


def test_batch_and_sequence_readback(transport):
    rid = transport.create_run({"project": "p"})["run_id"]
    ok = transport.post_batch(
        rid,
        [
            {
                "name": "loss",
                "step": i,
                "wall_time": _iso(i),
                "object_type": "scalar",
                "scalar_value": float(i) * 0.1,
            }
            for i in range(5)
        ],
    )
    assert ok is True
    rows = transport.db.read_columns(
        "SELECT step, scalar_value FROM sequences WHERE run_id = ? ORDER BY step",
        [rid],
    )
    assert len(rows) == 5
    assert rows[0]["scalar_value"] == 0.0
    assert rows[-1]["scalar_value"] == 0.4


def test_upload_artifact_is_idempotent(transport):
    transport.create_run({"project": "p"})
    digest1 = transport.upload_artifact(b"xyz", "application/octet-stream", {"k": 1})
    digest2 = transport.upload_artifact(b"xyz", "application/octet-stream", {"k": 1})
    assert digest1 == digest2 == hashlib.sha256(b"xyz").hexdigest()
    # Only one artifact row, even after "two" uploads.
    (count,) = transport.db.read_one("SELECT COUNT(*) FROM artifacts") or (0,)
    assert count == 1


def test_logs_inserted_and_written_to_disk(transport, tmp_path):
    rid = transport.create_run({"project": "p"})["run_id"]
    ok = transport.post_logs(
        rid,
        [
            {"stream": "stdout", "wall_time": _iso(1), "line_no": 1, "content": "hi"},
            {"stream": "stderr", "wall_time": _iso(2), "line_no": 2, "content": "oops"},
        ],
    )
    assert ok is True
    # DB row inserted
    count = transport.db.read_one(
        "SELECT COUNT(*) FROM log_lines WHERE run_id = ?", [rid]
    )[0]
    assert count == 2
    # On-disk files written
    logs_dir = transport.data_dir.run_log_dir(rid)
    assert (logs_dir / "stdout.log").read_text() == "hi\n"
    assert (logs_dir / "combined.log").read_text() == "[stdout] hi\n[stderr] oops\n"


def test_finish_and_status_update(transport):
    rid = transport.create_run({"project": "p"})["run_id"]
    transport.finish_run(rid, "completed", exit_code=0)
    status = transport.db.read_one(
        "SELECT status FROM runs WHERE id = ?", [rid]
    )[0]
    assert status == "completed"


def test_tags_and_notes(transport):
    import json

    rid = transport.create_run({"project": "p"})["run_id"]
    transport.set_tags(rid, ["ablation"])
    transport.set_notes(rid, "testing")
    row = transport.db.read_columns("SELECT * FROM runs WHERE id = ?", [rid])[0]
    assert json.loads(row["tags"]) == ["ablation"]
    assert row["notes"] == "testing"


def test_drain_spill_is_noop(transport):
    assert transport.drain_spill() == 0


def test_concurrent_writers_on_same_repo(tmp_path):
    """Runs never contend: each appends to its own log."""
    t1 = _Logged(tmp_path / ".cairn")
    t2 = LocalTransport(tmp_path / ".cairn")
    try:
        r1 = t1.create_run({"project": "p"})
        r2 = t2.create_run({"project": "p", "run_id": "b" * 32})
        point = {"name": "loss", "step": 0, "scalar_value": 1.0,
                 "wall_time": "2025-01-01T00:00:00", "object_type": "scalar"}
        t1.post_batch(r1["run_id"], [point])
        t2.post_batch(r2["run_id"], [point])
        assert t1.db.read_one("SELECT COUNT(*) FROM sequences") == (2,)
    finally:
        t1.close()
        t2.close()
