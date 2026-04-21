"""Unit tests for the Write-Ahead Log."""

from __future__ import annotations

import json

import pytest

from cairn.sdk.wal import WriteAheadLog


@pytest.fixture
def wal(tmp_path):
    w = WriteAheadLog("test-run-123", wal_dir=tmp_path / "wal")
    yield w
    w.close()


class TestWALBasics:
    def test_append_and_read(self, wal):
        seq1 = wal.append("batch", {"run_id": "r1", "points": [{"x": 1}]})
        seq2 = wal.append("params", {"run_id": "r1", "params": {"lr": 0.01}})
        assert seq1 == 1
        assert seq2 == 2

    def test_checkpoint(self, wal):
        wal.append("batch", {"points": []})
        wal.append("batch", {"points": []})
        assert wal.read_checkpoint() == 0
        wal.checkpoint(1)
        assert wal.read_checkpoint() == 1

    def test_pending_returns_entries_after_checkpoint(self, wal):
        wal.append("batch", {"data": "a"})
        wal.append("params", {"data": "b"})
        wal.append("logs", {"data": "c"})
        wal.checkpoint(1)
        pending = list(wal.pending())
        assert len(pending) == 2
        assert pending[0].seq == 2
        assert pending[0].op == "params"
        assert pending[1].seq == 3
        assert pending[1].op == "logs"

    def test_pending_empty_when_fully_checkpointed(self, wal):
        wal.append("batch", {"data": "a"})
        wal.checkpoint(1)
        assert list(wal.pending()) == []

    def test_has_pending(self, wal):
        assert not wal.has_pending
        wal.append("batch", {})
        assert wal.has_pending
        wal.checkpoint(1)
        assert not wal.has_pending


class TestWALArtifacts:
    def test_small_artifact_inlined(self, wal):
        data = b"small image data"
        seq = wal.append_artifact(data, "image/png", {"key": "val"})
        assert seq == 1
        entries = list(wal.pending())
        assert len(entries) == 1
        e = entries[0]
        assert e.op == "artifact"
        assert "data_b64" in e.payload
        import base64
        assert base64.b64decode(e.payload["data_b64"]) == data

    def test_large_artifact_uses_file(self, tmp_path):
        w = WriteAheadLog("test-large", wal_dir=tmp_path / "wal")
        # Create data larger than INLINE_ARTIFACT_MAX (1MB)
        data = b"x" * (1024 * 1024 + 1)
        seq = w.append_artifact(data, "application/octet-stream", None)
        entries = list(w.pending())
        assert len(entries) == 1
        e = entries[0]
        assert "data_file" in e.payload
        from pathlib import Path
        assert Path(e.payload["data_file"]).read_bytes() == data
        w.close()


class TestWALCleanup:
    def test_cleanup_removes_files(self, tmp_path):
        w = WriteAheadLog("cleanup-run", wal_dir=tmp_path / "wal")
        w.append("batch", {})
        w.checkpoint(1)
        wal_path = tmp_path / "wal" / "cleanup-run.wal.jsonl"
        cp_path = tmp_path / "wal" / "cleanup-run.checkpoint"
        assert wal_path.exists()
        w.cleanup()
        assert not wal_path.exists()
        assert not cp_path.exists()


class TestWALResume:
    def test_resume_after_reopen(self, tmp_path):
        """Simulate crash+restart: close WAL, reopen, continue appending."""
        w1 = WriteAheadLog("resume-run", wal_dir=tmp_path / "wal")
        w1.append("batch", {"data": "first"})
        w1.checkpoint(1)
        w1.append("batch", {"data": "second"})
        w1.close()

        # Reopen — should resume from seq 2
        w2 = WriteAheadLog("resume-run", wal_dir=tmp_path / "wal")
        assert w2.read_checkpoint() == 1
        pending = list(w2.pending())
        assert len(pending) == 1
        assert pending[0].payload["data"] == "second"

        # Continue appending
        w2.append("batch", {"data": "third"})
        pending = list(w2.pending())
        assert len(pending) == 2
        w2.close()
