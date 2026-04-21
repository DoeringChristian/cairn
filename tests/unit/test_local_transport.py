"""LocalTransport full lifecycle + edge cases."""

from __future__ import annotations

import hashlib

import pytest

from cairn.sdk.local import LocalTransport


def _iso(i: int = 0) -> str:
    return f"2026-01-01T00:00:{i:02d}Z"


@pytest.fixture
def transport(tmp_path):
    t = LocalTransport(tmp_path / ".cairn")
    yield t
    t.close()


def test_create_run_writes_to_duckdb(transport):
    resp = transport.create_run({"project": "p", "task": "t", "name": "r1"})
    assert len(resp["run_id"]) == 12
    rows = transport.db.read_columns("SELECT * FROM runs WHERE id = ?", [resp["run_id"]])
    assert rows[0]["status"] == "running"
    assert rows[0]["display_name"] == "r1"


def test_params_flattened_and_stored(transport):
    rid = transport.create_run({"project": "p", "task": "t"})["run_id"]
    transport.post_params(rid, {"hparams": {"lr": 0.01}, "flat": 1})
    rows = transport.db.read_columns(
        "SELECT key FROM params WHERE run_id = ? ORDER BY key", [rid]
    )
    assert [r["key"] for r in rows] == ["flat", "hparams.lr"]


def test_batch_and_sequence_readback(transport):
    rid = transport.create_run({"project": "p", "task": "t"})["run_id"]
    ok = transport.post_batch(
        rid,
        [
            {
                "name": "loss",
                "step": i,
                "wall_time": _iso(i),
                "context": None,
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
    digest1 = transport.upload_artifact(b"xyz", "application/octet-stream", {"k": 1})
    digest2 = transport.upload_artifact(b"xyz", "application/octet-stream", {"k": 1})
    assert digest1 == digest2 == hashlib.sha256(b"xyz").hexdigest()
    # Only one artifact row, even after "two" uploads.
    (count,) = transport.db.read_one("SELECT COUNT(*) FROM artifacts") or (0,)
    assert count == 1


def test_attach_artifact_to_run(transport):
    rid = transport.create_run({"project": "p", "task": "t"})["run_id"]
    digest = transport.upload_artifact(b"hello", "text/plain")
    transport.attach_artifact(rid, "readme", digest)
    rows = transport.db.read_columns(
        "SELECT name, hash FROM run_artifacts WHERE run_id = ?", [rid]
    )
    assert rows[0]["name"] == "readme"
    assert rows[0]["hash"] == digest


def test_logs_inserted_and_written_to_disk(transport, tmp_path):
    rid = transport.create_run({"project": "p", "task": "t"})["run_id"]
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
    rid = transport.create_run({"project": "p", "task": "t"})["run_id"]
    transport.finish_run(rid, "completed", exit_code=0)
    status = transport.db.read_one(
        "SELECT status FROM runs WHERE id = ?", [rid]
    )[0]
    assert status == "completed"


def test_tags_and_notes(transport):
    import json

    rid = transport.create_run({"project": "p", "task": "t"})["run_id"]
    transport.set_tags(rid, ["ablation"])
    transport.set_notes(rid, "testing")
    row = transport.db.read_columns("SELECT * FROM runs WHERE id = ?", [rid])[0]
    assert json.loads(row["tags"]) == ["ablation"]
    assert row["notes"] == "testing"


def test_drain_spill_is_noop(transport):
    assert transport.drain_spill() == 0


def test_concurrent_transports_on_same_repo(tmp_path):
    """SQLite WAL allows multiple concurrent connections."""
    t1 = LocalTransport(tmp_path / ".cairn")
    t2 = LocalTransport(tmp_path / ".cairn")
    try:
        # Both can create runs
        r1 = t1.create_run({"project": "p", "task": "t1"})
        r2 = t2.create_run({"project": "p", "task": "t2"})
        assert r1["run_id"] != r2["run_id"]
        # Both can write batches
        t1.post_batch(r1["run_id"], [{"name": "loss", "step": 0, "scalar_value": 1.0,
                                       "wall_time": "2025-01-01T00:00:00", "object_type": "scalar",
                                       "context": None, "context_hash": ""}])
        t2.post_batch(r2["run_id"], [{"name": "loss", "step": 0, "scalar_value": 2.0,
                                       "wall_time": "2025-01-01T00:00:00", "object_type": "scalar",
                                       "context": None, "context_hash": ""}])
    finally:
        t1.close()
        t2.close()


def test_raises_served_by_server_holder(tmp_path):
    """A server holding the lock triggers _RepoServedByOtherError so SDK
    can auto-switch to HTTP mode.
    """
    import json
    import os

    from cairn.sdk.local import _RepoServedByOtherError
    from cairn.server.storage.datadir import DataDir

    dd = DataDir(tmp_path / ".cairn")
    dd.lock_path.write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "mode": "server",
                "host": "127.0.0.1",
                "port": 9999,
                "started_at": "2026-01-01T00:00:00Z",
            }
        )
    )
    with pytest.raises(_RepoServedByOtherError) as exc:
        LocalTransport(tmp_path / ".cairn")
    assert exc.value.holder["mode"] == "server"


def test_ui_holder_does_not_block_sdk(tmp_path):
    """A UI holding the lock should NOT block SDK — SQLite handles concurrency."""
    import json
    import os

    from cairn.server.storage.datadir import DataDir

    dd = DataDir(tmp_path / ".cairn")
    dd.lock_path.write_text(
        json.dumps(
            {
                "pid": os.getpid(),
                "mode": "ui",
                "host": "127.0.0.1",
                "port": 9999,
                "started_at": "2026-01-01T00:00:00Z",
            }
        )
    )
    # Should NOT raise — UI and SDK can coexist with SQLite
    t = LocalTransport(tmp_path / ".cairn")
    t.close()


def test_lock_released_if_db_open_fails(tmp_path, monkeypatch):
    """If Database.open raises, we must not leak the lock."""
    from cairn.sdk import local as local_mod

    class Boom:
        @classmethod
        def open(cls, path):
            raise RuntimeError("boom")

    monkeypatch.setattr(local_mod, "Database", Boom)
    with pytest.raises(RuntimeError, match="boom"):
        LocalTransport(tmp_path / ".cairn")
    # Should be possible to acquire again — lock was released in the except.
    from cairn.server.storage.datadir import DataDir

    dd = DataDir(tmp_path / ".cairn")
    dd.acquire_lock("sdk")
    dd.release_lock()
