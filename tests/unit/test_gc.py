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
from cairn.sdk.local import LocalTransport
from cairn.server import gc, ingest_ops
from cairn.server.app import create_app
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from tests.conftest import ingest_repo

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)
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
        r.db.write(
            "INSERT INTO reports (id, project_id, name, payload, created_at, updated_at) "
            "VALUES ('rep', 'p', 'r', '{}', 'x', 'x')"
        )
        r.db.write(
            "INSERT INTO report_assets VALUES ('rep', ?, 'image/png', 11, 'x')", [asset],
        )
        diff, _ = r.blobs.put(b"diff --git")
        src = r.dd.run_source_dir(rid)
        (src / "manifest.json").write_text(json.dumps({"files": [], "diff_hash": diff}))
        # A record not ingested yet names a blob.
        t = LocalTransport(root)
        t.create_run({"project": "p", "run_id": "9" * 32})
        pending = t.upload_artifact(b"pending-bytes", "text/plain")
        t.close()
        everything = set(r.blobs.iter_digests())
        _age_all(r.blobs)
        marked = gc.mark(r.db, r.dd, r.blobs)
        assert everything <= marked, everything - marked
        assert {asset, diff, pending} <= marked
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
    with TestClient(create_app(data_dir=root)) as client:
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


def test_cli_gc_on_a_local_repo(tmp_path):
    root = tmp_path / ".cairn"
    r = _Repo(root)
    d, _ = r.blobs.put(b"x" * 1000)
    _age(r.blobs, d)
    r.close()
    out = CliRunner().invoke(cli.main, ["gc", "--dry-run", "--repo", str(root)])
    assert out.exit_code == 0, out.output
    assert "would free 0.0 MB in 1 blob(s)" in out.output
    out = CliRunner().invoke(cli.main, ["gc", "--repo", str(root)])
    assert out.exit_code == 0, out.output
    assert "freed 0.0 MB in 1 blob(s)" in out.output
    assert not BlobStore(DataDir(root).artifacts_dir).exists(d)
