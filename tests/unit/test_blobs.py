"""Unit tests for the content-addressable blob store."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from cairn.server.storage.blobs import BlobStore


@pytest.fixture
def store(tmp_path):
    return BlobStore(tmp_path / "artifacts")


def test_put_creates_layout(store):
    h, size = store.put(b"hello world")
    assert size == 11
    # Hash of "hello world" is stable
    assert h == "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    blob_dir = store.root / h[:2] / h
    assert (blob_dir / "blob").read_bytes() == b"hello world"
    # Bytes only: what they are lives in the database's artifacts row.
    assert [p.name for p in blob_dir.iterdir()] == ["blob"]


def test_put_is_idempotent_and_dedups(store):
    h1, s1 = store.put(b"abc")
    h2, s2 = store.put(b"abc")
    assert h1 == h2 and s1 == s2
    # Only one blob directory should exist under the 2-char prefix.
    prefix_dir = store.root / h1[:2]
    assert [p.name for p in prefix_dir.iterdir()] == [h1]


def test_exists_and_size(store):
    assert store.exists("deadbeef") is False
    h, _ = store.put(b"payload")
    assert store.exists(h) is True
    assert store.size(h) == len(b"payload")


def test_get_round_trip(store):
    h, _ = store.put(b"round-trip")
    assert store.get(h) == b"round-trip"


def test_open_stream_reads(store):
    h, _ = store.put(b"streamed")
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
        store.put(b"content")
    # No blob file at the computed hash location
    import hashlib

    h = hashlib.sha256(b"content").hexdigest()
    assert not (store.root / h[:2] / h / "blob").exists()
    # Restore for any subsequent usage
    monkeypatch.setattr("os.replace", real_replace)


def test_delete_removes_the_blob_dir(store):
    h, _ = store.put(b"to-delete")
    assert store.exists(h)
    store.delete(h)
    assert not store.exists(h)
    assert not store.dir_for(h).exists()


def test_hash_bytes_matches_hashlib():
    from hashlib import sha256

    assert BlobStore.hash_bytes(b"xyz") == sha256(b"xyz").hexdigest()


def test_writer_killed_right_after_the_rename_leaves_a_readable_blob(store, monkeypatch):
    """A writer killed right after the blob's rename must not leave bytes that
    can never be read again (a later put of the same bytes finds the blob and
    returns early, so nothing would repair them)."""
    import os

    real_replace = os.replace

    def replace_then_die(src, dst):
        real_replace(src, dst)
        raise KeyboardInterrupt("killed after the rename")

    monkeypatch.setattr("os.replace", replace_then_die)
    with pytest.raises(KeyboardInterrupt):
        store.put(b"half-written")
    monkeypatch.setattr("os.replace", real_replace)

    h, _ = store.put(b"half-written")
    assert store.get(h) == b"half-written"


def test_get_right_after_the_rename_reads_the_bytes(store, monkeypatch):
    """A reader that arrives between the blob's rename and anything written
    after it reads the bytes."""
    import os

    seen: list[bytes] = []
    real_replace = os.replace

    def replace_then_read(src, dst):
        real_replace(src, dst)
        h = BlobStore.hash_bytes(b"racing")
        seen.append(store.get(h))

    monkeypatch.setattr("os.replace", replace_then_read)
    store.put(b"racing")
    assert seen == [b"racing"]
