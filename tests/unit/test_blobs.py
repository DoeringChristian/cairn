"""Unit tests for the content-addressable blob store."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from cairn.server.storage.blobs import BlobStore


@pytest.fixture
def store(tmp_path):
    return BlobStore(tmp_path / "artifacts")


def test_put_creates_layout(store):
    h, size = store.put(b"hello world", "text/plain", {"note": "x"})
    assert size == 11
    # Hash of "hello world" is stable
    assert h == "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    expected_blob = store.root / h[:2] / h / "blob"
    expected_meta = store.root / h[:2] / h / "meta.json"
    assert expected_blob.read_bytes() == b"hello world"
    meta = json.loads(expected_meta.read_text())
    assert meta["mime_type"] == "text/plain"
    assert meta["size_bytes"] == 11
    assert meta["metadata"] == {"note": "x"}


def test_put_is_idempotent_and_dedups(store):
    h1, s1 = store.put(b"abc", "text/plain")
    h2, s2 = store.put(b"abc", "text/plain")
    assert h1 == h2 and s1 == s2
    # Only one blob directory should exist under the 2-char prefix.
    prefix_dir = store.root / h1[:2]
    assert [p.name for p in prefix_dir.iterdir()] == [h1]


def test_exists_and_size(store):
    assert store.exists("deadbeef") is False
    h, _ = store.put(b"payload", "application/octet-stream")
    assert store.exists(h) is True
    assert store.size(h) == len(b"payload")


def test_get_round_trip(store):
    h, _ = store.put(b"round-trip", "application/octet-stream", {"k": "v"})
    data, meta = store.get(h)
    assert data == b"round-trip"
    assert meta["metadata"] == {"k": "v"}


def test_open_stream_reads(store):
    h, _ = store.put(b"streamed", "application/octet-stream")
    with store.open_stream(h) as fh:
        chunk = fh.read()
    assert chunk == b"streamed"


def test_atomic_write_on_exception(store, monkeypatch):
    """If the write fails mid-way, no partial blob file should remain."""
    real_replace = __import__("os").replace

    def boom(*a, **kw):
        raise OSError("disk full")

    monkeypatch.setattr("os.replace", boom)
    with pytest.raises(OSError, match="disk full"):
        store.put(b"content", "text/plain")
    # No blob file at the computed hash location
    import hashlib

    h = hashlib.sha256(b"content").hexdigest()
    assert not (store.root / h[:2] / h / "blob").exists()
    # Restore for any subsequent usage
    monkeypatch.setattr("os.replace", real_replace)


def test_delete_removes_blob_and_meta(store):
    h, _ = store.put(b"to-delete", "text/plain")
    assert store.exists(h)
    store.delete(h)
    assert not store.exists(h)
    assert not store.meta_path_for(h).exists()


def test_hash_bytes_matches_hashlib():
    from hashlib import sha256

    assert BlobStore.hash_bytes(b"xyz") == sha256(b"xyz").hexdigest()
