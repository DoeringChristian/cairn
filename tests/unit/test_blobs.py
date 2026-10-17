"""Unit tests for the content-addressable blob store."""

from __future__ import annotations

import errno
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
from unittest.mock import patch

import pytest

from cairn.backend.storage.blobs import BlobStore


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


def _upload(store, payload, streamed):
    if not streamed:
        return store.put(payload)
    incoming = store.incoming()
    with incoming:
        incoming.write(payload)
        incoming.flush()
        os.fsync(incoming.fileno())
    try:
        digest = store.hash_bytes(payload)
        store.commit_incoming(incoming.name, digest)
        return digest, len(payload)
    finally:
        Path(incoming.name).unlink(missing_ok=True)


@pytest.mark.parametrize("streamed", [False, True])
@pytest.mark.skipif(os.name == "nt", reason="Windows has no directory fsync API")
def test_directory_io_errors_fail_upload_and_dedup_retry(store, monkeypatch, streamed):
    real_fsync = os.fsync

    def fail_directory(fd):
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            raise OSError(errno.EIO, "directory sync failed")
        return real_fsync(fd)

    with monkeypatch.context() as failing:
        failing.setattr(os, "fsync", fail_directory)
        # The first attempt has already renamed complete bytes. Retrying the
        # same content must still fail until its directory can be persisted.
        for _ in range(2):
            with pytest.raises(OSError, match="directory sync failed"):
                _upload(store, b"durable or rejected", streamed)
        with pytest.raises(OSError, match="directory sync failed"):
            store.touch(store.hash_bytes(b"durable or rejected"))
    digest, _ = _upload(store, b"durable or rejected", streamed)
    assert store.get(digest) == b"durable or rejected"


@pytest.mark.parametrize("streamed", [False, True])
@pytest.mark.parametrize("parent", ["prefix", "root"])
def test_new_parent_entries_must_sync_before_acknowledgment(store, monkeypatch, streamed, parent):
    from cairn.backend.storage import blobs as module

    payload = b"new parent directories"
    digest = store.hash_bytes(payload)
    directory = store.root / digest[:2] if parent == "prefix" else store.root
    real_sync = module.fsync_dir

    def fail_parent(path):
        if path == directory:
            raise OSError(errno.EIO, "parent directory sync failed")
        real_sync(path)

    with monkeypatch.context() as failing:
        failing.setattr(module, "fsync_dir", fail_parent)
        with pytest.raises(OSError, match="parent directory sync failed"):
            _upload(store, payload, streamed)
    _upload(store, payload, streamed)
    assert store.get(digest) == payload


@pytest.mark.skipif(os.name == "nt", reason="Windows has no directory fsync API")
def test_directory_open_io_error_is_not_ignored(store, monkeypatch):
    from cairn.backend.storage.blobs import fsync_dir

    def fail_open(*args, **kwargs):
        raise OSError(errno.EIO, "directory open failed")

    monkeypatch.setattr(os, "open", fail_open)
    with pytest.raises(OSError, match="directory open failed"):
        fsync_dir(store.root)


def test_collector_crash_does_not_hide_a_young_blob(store):
    digest, _ = store.put(b"recently acknowledged")
    script = """
import os, sys
from pathlib import Path
from cairn.backend.storage.blobs import BlobStore
store = BlobStore(Path(sys.argv[1]))
real_stat = Path.stat
def crash_before_age_check(path, *args, **kwargs):
    if path.name == 'blob':
        os._exit(23)
    return real_stat(path, *args, **kwargs)
Path.stat = crash_before_age_check
store.delete_if_older(sys.argv[2], 0)
"""
    process = subprocess.run([sys.executable, "-c", script, str(store.root), digest],
                             capture_output=True, timeout=10)
    assert process.returncode == 23, process.stderr.decode()
    assert store.get(digest) == b"recently acknowledged"
    assert store.touch(digest)  # a process exit also releases its prefix lock


@pytest.mark.parametrize("operation", ["touch", "put", "streamed"])
def test_collector_waits_for_other_process_refresh(store, tmp_path, operation):
    from concurrent.futures import ThreadPoolExecutor, TimeoutError

    digest, _ = store.put(b"shared")
    os.utime(store.path_for(digest), (0, 0))
    ready, release = tmp_path / "ready", tmp_path / "release"
    script = """
import os, sys, time
from pathlib import Path
from cairn.backend.storage.blobs import BlobStore
store = BlobStore(Path(sys.argv[1]))
digest, operation = sys.argv[2:4]
ready, release = map(Path, sys.argv[4:6])
real_utime = os.utime
def paused_touch(*args, **kwargs):
    real_utime(*args, **kwargs)
    ready.write_text('refreshed')
    deadline = time.monotonic() + 10
    while not release.exists():
        if time.monotonic() > deadline:
            raise RuntimeError('test did not release writer')
        time.sleep(.01)
os.utime = paused_touch
if operation == 'touch':
    assert store.touch(digest)
elif operation == 'put':
    store.put(b'shared')
else:
    incoming = store.incoming()
    with incoming:
        incoming.write(b'shared')
        incoming.flush()
        os.fsync(incoming.fileno())
    store.commit_incoming(incoming.name, digest)
"""
    process = subprocess.Popen([sys.executable, "-c", script, str(store.root), digest,
                                operation, str(ready), str(release)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 10
        while not ready.exists():
            assert process.poll() is None, process.communicate()[1].decode()
            assert time.monotonic() < deadline, "writer did not reach age refresh"
            time.sleep(.01)
        with ThreadPoolExecutor(max_workers=1) as pool:
            collection = pool.submit(store.delete_if_older, digest, time.time() - 3600)
            try:
                with pytest.raises(TimeoutError):
                    collection.result(timeout=.1)
            finally:
                release.touch()
            assert collection.result(timeout=10) is None
        _, error = process.communicate(timeout=10)
        assert process.returncode == 0, error.decode()
        assert store.get(digest) == b"shared"
    finally:
        release.touch()
        if process.poll() is None:
            process.kill()
        process.wait(timeout=10)
