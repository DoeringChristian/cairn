"""The decompressed-source LRU behind GET /api/runs/{id}/source/file."""

from __future__ import annotations

import io
import json
import os
import tarfile

import pytest
import zstandard as zstd

from cairn.backend import source_cache
from cairn.backend.source_cache import SourceCache


def _archive(files: dict[str, bytes], dirs: tuple[str, ...] = ()) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for d in dirs:
            info = tarfile.TarInfo(name=d)
            info.type = tarfile.DIRTYPE
            tf.addfile(info)
        for name, content in files.items():
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            tf.addfile(info, io.BytesIO(content))
    return zstd.ZstdCompressor().compress(buf.getvalue())


def _upload(client, rid, files, dirs=()):
    manifest = {"root": "/src", "captured_at": "2026-01-01T00:00:00Z",
                "files": [{"path": n, "size": len(c), "sha256": "x"} for n, c in files.items()],
                "skipped": [], "marker": "pyproject.toml"}
    r = client.post(
        f"/api/runs/{rid}/source",
        files={"archive": ("tree.tar.zst", io.BytesIO(_archive(files, dirs)), "application/zstd")},
        data={"manifest": json.dumps(manifest)},
    )
    assert r.status_code == 200, r.text


@pytest.fixture
def counted(monkeypatch):
    """Swap in a fresh cache and count decompressions."""
    calls: list[str] = []
    real = source_cache.load_tree

    def spy(path):
        calls.append(str(path))
        return real(path)

    monkeypatch.setattr(source_cache, "load_tree", spy)
    monkeypatch.setattr(source_cache.SOURCE_CACHE, "_trees", type(source_cache.SOURCE_CACHE._trees)())
    monkeypatch.setattr(source_cache.SOURCE_CACHE, "_bytes", 0)
    return calls


def test_two_file_reads_decompress_once(client, counted):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    _upload(client, rid, {"train.py": b"print(1)\n", "cfg/a.yaml": b"x: 1\n"})

    a = client.get(f"/api/runs/{rid}/source/file", params={"path": "train.py"}).json()
    b = client.get(f"/api/runs/{rid}/source/file", params={"path": "cfg/a.yaml"}).json()
    assert a["content"] == "print(1)\n"
    assert b["content"] == "x: 1\n"
    assert len(counted) == 1


@pytest.mark.parametrize("transport", ["repository", "http"])
def test_source_upload_uses_configured_blob_store(tmp_path, transport):
    from cairn.backend import integrity, sources
    from cairn.backend.repository import Repository
    from cairn.backend.storage.context import StorageConfig
    from cairn.server.app import create_app
    from fastapi.testclient import TestClient

    storage = StorageConfig(tmp_path / "repo", blob_root=str(tmp_path / "separate-blobs"))
    files = {"train.py": b"print('captured source')\n"}
    if transport == "repository":
        writer = Repository(storage)
        try:
            rid = writer.create_run({"project": "p"})["run_id"]
            writer.upload_source(rid, _archive(files), {"files": [{"path": "train.py"}]})
            assert sources.file(writer._db, writer.blobs, rid, "train.py") == files["train.py"]
        finally:
            writer.close()
    else:
        app = create_app(data_dir=storage.root, blob_root=storage.blob_root,
                         mount_ui=False, auth_enabled=False)
        with TestClient(app) as client:
            rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
            _upload(client, rid, files)
            result = client.get(f"/api/runs/{rid}/source/file", params={"path": "train.py"})
            assert result.status_code == 200, result.text
            assert result.json()["content"] == files["train.py"].decode()
    db, blobs, directory = storage.open()
    try:
        digest, _ = sources.get(db, rid)
        assert blobs.exists(digest)
        assert not (directory.artifacts_dir / digest[:2] / digest / "blob").exists()
        assert integrity.fsck(db, directory, blobs)["missing_blobs"] == []
    finally:
        db.close()


def test_reupload_is_not_served_stale(client, counted):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    _upload(client, rid, {"train.py": b"old\n"})
    assert client.get(f"/api/runs/{rid}/source/file",
                      params={"path": "train.py"}).json()["content"] == "old\n"
    _upload(client, rid, {"train.py": b"new\n"})
    assert client.get(f"/api/runs/{rid}/source/file",
                      params={"path": "train.py"}).json()["content"] == "new\n"
    assert len(counted) == 2
    # Distinct content hashes have independent cache entries.
    assert len(source_cache.SOURCE_CACHE._trees) == 2


def test_path_traversal_still_rejected(client, counted):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    _upload(client, rid, {"train.py": b"x\n"})
    for bad in ("/etc/passwd", "../../../etc/passwd", "..\\win.ini", "a/../../b"):
        r = client.get(f"/api/runs/{rid}/source/file", params={"path": bad})
        assert r.status_code == 400, bad
    # Rejected before the archive is ever touched.
    assert counted == []


def test_directory_and_missing_members(client, counted):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    _upload(client, rid, {"pkg/m.py": b"x\n"}, dirs=("pkg",))
    assert client.get(f"/api/runs/{rid}/source/file", params={"path": "pkg"}).status_code == 400
    assert client.get(f"/api/runs/{rid}/source/file", params={"path": "nope.py"}).status_code == 404
    # Normalized lookups hit the same entry.
    r = client.get(f"/api/runs/{rid}/source/file", params={"path": "pkg/./m.py"})
    assert r.json()["content"] == "x\n"
    assert len(counted) == 1


def _write_archive(path, files):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_archive(files))
    return path


def test_lru_evicts_least_recently_used(tmp_path):
    cache = SourceCache(max_bytes=250)
    a = _write_archive(tmp_path / "a" / "tree.tar.zst", {"f": b"a" * 100})
    b = _write_archive(tmp_path / "b" / "tree.tar.zst", {"f": b"b" * 100})
    c = _write_archive(tmp_path / "c" / "tree.tar.zst", {"f": b"c" * 100})
    ta = cache.get(a)
    cache.get(b)
    assert cache.get(a) is ta  # touch a; b is now least recent
    cache.get(c)
    keys = {k[0] for k in cache._trees}
    assert keys == {str(a.resolve()), str(c.resolve())}
    assert cache._bytes == 200


def test_tree_larger_than_budget_is_not_kept(tmp_path):
    cache = SourceCache(max_bytes=50)
    big = _write_archive(tmp_path / "big" / "tree.tar.zst", {"f": b"x" * 100})
    assert cache.get(big).files["f"] == b"x" * 100
    assert len(cache._trees) == 0
    assert cache._bytes == 0
