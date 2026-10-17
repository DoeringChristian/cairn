"""Blob garbage collection (``cairn/server/gc.py``, ``cairn gc``)."""

from __future__ import annotations

import json
import os
import threading
import time

import numpy as np
import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

import cairn
from cairn import cli
from cairn.backend import gc, ingest_ops
from cairn.server.app import create_app
from cairn.backend.storage.blobs import BlobStore
from cairn.backend.storage.datadir import DataDir
from cairn.backend.storage.db import Database
from tests.conftest import ingest_repo

QUIET = {"capture_source": False, "capture_stdout": False, "capture_env": False,
         "capture_system_metrics": False}
OLD = time.time() - gc.GRACE_SECONDS - 3600


def _age(blobs: BlobStore, digest: str, t: float = OLD) -> None:
    os.utime(blobs.path_for(digest), (t, t))


def _age_all(blobs: BlobStore) -> None:
    for d in blobs.iter_digests():
        _age(blobs, d)


class _Repo:
    def __init__(self, root):
        self.dd = DataDir(root)
        self.db = Database.open(self.dd.db_path)
        self.blobs = BlobStore(self.dd.artifacts_dir)

    def close(self):
        self.db.close()


@pytest.fixture
def repo(tmp_path):
    r = _Repo(tmp_path / ".cairn")
    yield r
    r.close()


def test_only_unreferenced_old_blobs_go(repo):
    rid = ingest_ops.create_run(repo.db, project="p")["run_id"]
    used = ingest_ops.put_artifact(repo.db, repo.blobs, b"used", "text/plain")["hash"]
    ingest_ops.insert_batch(repo.db, rid, [{
        "name": "t", "step": 0, "wall_time": "2026-01-01T00:00:00+00:00",
        "object_type": "text", "artifact_hash": used,
    }])
    orphan = ingest_ops.put_artifact(repo.db, repo.blobs, b"orphan" * 100, "text/plain")["hash"]
    young = ingest_ops.put_artifact(repo.db, repo.blobs, b"young", "text/plain")["hash"]
    _age(repo.blobs, used)
    _age(repo.blobs, orphan)

    dry = gc.collect(repo.db, repo.dd, repo.blobs, dry_run=True)
    assert (dry["deleted"], dry["freed_bytes"], dry["dry_run"]) == (1, 600, True)
    assert repo.blobs.exists(orphan)

    result = gc.collect(repo.db, repo.dd, repo.blobs)
    assert (result["deleted"], result["freed_bytes"]) == (1, 600)
    assert not repo.blobs.exists(orphan)
    assert repo.blobs.exists(used) and repo.blobs.exists(young)
    rows = {h for (h,) in repo.db.read("SELECT hash FROM artifacts")}
    assert rows == {used, young}  # the deleted blob's row went with it


def test_every_reference_site_is_marked(tmp_path):
    """Run media, galleries (and their items' sources), artifact versions and
    their files, report assets, source diffs and pending log records."""
    root = tmp_path / ".cairn"
    fig = pytest.importorskip("plotly.graph_objects")
    with cairn.Run("p", repo=root, **QUIET) as run:
        run.track(cairn.Image(np.zeros((4, 4, 3), np.uint8)), "img", 0)
        run.track([cairn.Text("a"), cairn.Text("b")], "gallery", 0)
        run.track(fig.Figure(data=[fig.Scatter(x=[1, 2], y=[3, 4])]), "fig", 0)
        art = cairn.Artifact("ds")
        art.add(b"payload-bytes", "x.bin")
        run.log_artifact(art)
        rid = run.id
    ingest_repo(root)
    r = _Repo(root)
    try:
        # A report asset and a source diff (manifest on disk).
        asset, _ = r.blobs.put(b"asset-bytes")
        from cairn.backend.artifact_registry_ops import create_version
        import json
        manifest, _ = r.blobs.put(json.dumps({'files':[{'path':'image.png','hash':asset,'size':11}]}).encode())
        create_version(r.db,r.blobs,project_id='p',name='report-r',type='report',digest=manifest)
        diff, _ = r.blobs.put(b"diff --git")
        from cairn.backend import sources
        archive, _ = r.blobs.put(b"source archive")
        sources.bind(r.db, rid, archive, {"files": [], "diff_hash": diff})
        everything = set(r.blobs.iter_digests())
        _age_all(r.blobs)
        marked = gc.mark(r.db, r.dd, r.blobs)
        assert everything <= marked, everything - marked
        assert {asset, diff} <= marked
        assert gc.collect(r.db, r.dd, r.blobs)["deleted"] == 0
    finally:
        r.close()


def test_deleting_a_run_frees_its_blobs_and_the_server_collects(tmp_path):
    root = tmp_path / ".cairn"
    with cairn.Run("p", repo=root, **QUIET) as run:
        run.track(cairn.Image(np.ones((4, 4, 3), np.uint8)), "img", 0)
        rid = run.id
    with cairn.Run("p", repo=root, **QUIET) as keep:
        keep.track(cairn.Image(np.zeros((4, 4, 3), np.uint8)), "img", 0)
    ingest_repo(root)
    blobs = BlobStore(DataDir(root).artifacts_dir)
    _age_all(blobs)
    before = set(blobs.iter_digests())
    with TestClient(create_app(data_dir=root, auth_enabled=False)) as client:
        assert client.delete(f"/api/runs/{rid}").status_code == 200
        deadline = time.monotonic() + 10
        while set(blobs.iter_digests()) == before:
            assert time.monotonic() < deadline, "the server did not collect"
            time.sleep(0.05)
    after = set(blobs.iter_digests())
    assert len(before - after) == 1  # the deleted run's image; the other is kept


def test_put_of_a_stored_blob_refreshes_it_against_gc(repo):
    """A writer re-using a stored, unreferenced blob (same bytes) while GC
    runs: the put refreshes its mtime, so it survives."""
    digest, _ = repo.blobs.put(b"shared")
    _age(repo.blobs, digest)
    repo.blobs.put(b"shared")  # a writer stores the same bytes again
    assert gc.collect(repo.db, repo.dd, repo.blobs)["deleted"] == 0
    assert repo.blobs.exists(digest)


@pytest.mark.parametrize("manifest_metadata", [True, False])
def test_snapshot_keeps_deleted_output_manifest_and_files(repo, manifest_metadata):
    from cairn.backend import artifact_registry_ops, snapshots
    from cairn.backend.artifact_refs import MANIFEST_MIME

    rid = ingest_ops.create_run(repo.db, project="p")["run_id"]
    payload = b"immutable output"
    digest, size = repo.blobs.put(payload)
    manifest_bytes = json.dumps({"files": [{"path": "result.txt", "hash": digest,
                                          "size": size}]}).encode()
    if manifest_metadata:
        manifest = ingest_ops.put_artifact(repo.db, repo.blobs, manifest_bytes,
                                          MANIFEST_MIME)["hash"]
    else:
        # Registering a raw uploaded manifest is supported too; its files
        # must survive even without an artifacts-table MIME descriptor.
        manifest, _ = repo.blobs.put(manifest_bytes)
    version = artifact_registry_ops.create_version(
        repo.db, repo.blobs, project_id="p", name="result", digest=manifest,
        created_by_run=rid,
    )
    ingest_ops.finish_run(repo.db, rid, "completed")
    snapshot = snapshots.capture_run(repo.db, rid)
    artifact_registry_ops.delete_version(repo.db, version["id"], force=True)
    ingest_ops.delete_run(repo.db, repo.dd, rid)
    _age_all(repo.blobs)

    assert gc.collect(repo.db, repo.dd, repo.blobs)["deleted"] == 0
    restored = snapshots.capture_run(repo.db, rid, snapshot["snapshot_id"])
    assert restored["outputs"][0]["digest"] == manifest
    assert json.loads(repo.blobs.get(manifest))["files"][0]["hash"] == digest
    assert repo.blobs.get(digest) == payload


@pytest.mark.parametrize("writer", ["direct", "records"])
def test_gc_reupload_preserves_new_metadata(fresh_db, data_dir, blob_store, monkeypatch, writer):
    """A stale GC mark must not delete a re-upload's metadata after its bytes."""
    from concurrent.futures import ThreadPoolExecutor, TimeoutError
    from cairn.backend import record_apply

    db, blobs = fresh_db, blob_store
    rid = ingest_ops.create_run(db, project="p")["run_id"]
    payload = b"concurrently reused"
    digest = ingest_ops.put_artifact(db, blobs, payload, "text/plain", {"caption": "old"})["hash"]
    _age(blobs, digest)
    deleted, uploaded, release = threading.Event(), threading.Event(), threading.Event()
    real_delete, real_put = blobs.delete_if_older, blobs.put

    def pause_after_delete(value, cutoff):
        size = real_delete(value, cutoff)
        if value == digest and size is not None:
            deleted.set()
            assert release.wait(10), "test did not release collector"
        return size

    def notify_upload(value):
        result = real_put(value)
        uploaded.set()
        return result

    monkeypatch.setattr(blobs, "delete_if_older", pause_after_delete)
    monkeypatch.setattr(blobs, "put", notify_upload)
    metadata = {"caption": "re-uploaded"}
    point = {"name": "text", "step": 0, "wall_time": "2026-10-17T00:00:00+00:00",
             "object_type": "text", "artifact_hash": digest}

    def publish_again():
        if writer == "direct":
            ingest_ops.put_artifact(db, blobs, payload, "text/plain", metadata)
            ingest_ops.insert_batch(db, rid, [point])
        else:
            blobs.put(payload)
            record_apply.apply_records(db, data_dir, blobs, rid, "primary", 1, [
                {"seq": 1, "op": "artifact_meta", "payload": {
                    "hash": digest, "mime_type": "text/plain", "size_bytes": len(payload),
                    "metadata": metadata, "object_type": "text",
                }},
                {"seq": 2, "op": "batch", "payload": {"points": [point]}},
            ])

    with ThreadPoolExecutor(max_workers=2) as pool:
        collection = pool.submit(gc.collect, db, data_dir, blobs)
        try:
            assert deleted.wait(10), "collector did not delete the old bytes"
            publication = pool.submit(publish_again)
            assert uploaded.wait(10), "writer did not re-upload the bytes"
            # The filesystem upload can finish, but metadata publication must
            # wait for GC's old-row deletion, on SQLite and PostgreSQL alike.
            with pytest.raises(TimeoutError):
                publication.result(timeout=.1)
        finally:
            release.set()
        collection.result(timeout=10)
        publication.result(timeout=10)

    assert blobs.get(digest) == payload
    assert db.read_one("SELECT mime_type,metadata FROM artifacts WHERE hash=?", [digest]) == (
        "text/plain", json.dumps(metadata),
    )
    assert db.read_one("SELECT artifact_hash FROM sequences WHERE run_id=?", [rid]) == (digest,)
    assert gc.collect(db, data_dir, blobs)["deleted"] == 0


def test_gc_racing_a_writer_never_loses_a_written_blob(repo):
    """Writers put (and immediately reference, as a log record) blobs while
    collections run in a loop: every blob a writer stored is still there."""
    digests: list[str] = []
    stop = threading.Event()

    def writer():
        i = 0
        while not stop.is_set():
            d, _ = repo.blobs.put(f"blob-{i % 20}".encode())
            digests.append(d)
            i += 1

    for i in range(20):  # the same bytes exist already, old and unreferenced
        d, _ = repo.blobs.put(f"blob-{i}".encode())
        _age(repo.blobs, d)
    th = threading.Thread(target=writer)
    th.start()
    for _ in range(20):
        gc.collect(repo.db, repo.dd, repo.blobs)
    stop.set()
    th.join()
    # Whatever the writer put in the last grace period is there.
    lost = [d for d in set(digests[-20:]) if not repo.blobs.exists(d)]
    assert lost == []
