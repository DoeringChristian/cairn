"""Directory / multi-file artifacts and external references: files uploaded
content-addressed, a versioned manifest naming them, an ArtifactDir handle back."""

from __future__ import annotations

import io
import json
import zipfile

import pytest

import cairn
from cairn.sdk.artifact_dir import MANIFEST_MIME, ArtifactDir
from cairn.sdk.local import LocalTransport
from cairn.sdk.transport import Transport
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)


@pytest.fixture
def tree(tmp_path):
    root = tmp_path / "data"
    (root / "train").mkdir(parents=True)
    (root / "train" / "a.txt").write_text("alpha")
    (root / "train" / "b.bin").write_bytes(b"\x00\x01")
    (root / "labels.json").write_text('{"a": 1}')
    external = tmp_path / "raw.tar"
    external.write_bytes(b"external bytes")
    return root, external


def _drain(repo):
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    try:
        ingest_all(dd, db, BlobStore(dd.artifacts_dir))
    finally:
        db.close()


@pytest.fixture(params=["http", "local", "wal"])
def backend(request, tmp_path, monkeypatch):
    """``(transport, reader_repo, finish)`` for the three write paths."""
    if request.param == "http":
        live = request.getfixturevalue("live_server")
        monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
        t = Transport(live, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
        yield t, live.replace("http://", "cairn://"), t.close
        return
    repo = tmp_path / ".cairn"
    t = LocalTransport(repo, use_wal=request.param == "wal")

    def finish():
        t.close()
        if request.param == "wal":
            _drain(repo)

    yield t, repo, finish


def _check_dir(d, tmp_path, external):
    assert isinstance(d, ArtifactDir)
    by_path = {f["path"]: f for f in d.files}
    assert set(by_path) == {"labels.json", "train/a.txt", "train/b.bin", "raw.tar"}
    assert by_path["train/a.txt"]["size"] == 5 and by_path["train/a.txt"]["mime"] == "text/plain"
    assert by_path["raw.tar"] == {"path": "raw.tar", "uri": external.as_uri(), "size": 14}
    assert d.open("train/a.txt").read() == b"alpha"
    out = d.download(tmp_path / "out")
    assert (out / "train" / "b.bin").read_bytes() == b"\x00\x01"
    assert (out / "raw.tar").read_bytes() == b"external bytes"


def test_directory_artifact_through_every_backend(backend, tree, tmp_path):
    transport, repo, finish = backend
    root, external = tree
    run = cairn.Run(project="mf", transport=transport, **QUIET)
    run.log_artifact(root, name="data", artifact_type="dataset")
    run.log_artifact(cairn.Reference(external.as_uri(), size=14), name="raw")
    run.finish()
    finish()

    with cairn.Reader(repo=repo) as reader:
        refs = reader.resolve_and_download_artifact("mf", "raw:latest")
        assert refs.files == [{"path": "raw.tar", "uri": external.as_uri(), "size": 14}]
        d = reader.resolve_and_download_artifact("mf", "data:v1")
        assert len(d) == 3
        versions = reader.artifact_versions("data", project="mf")
        assert versions[0]["mime_type"] == MANIFEST_MIME
        assert versions[0]["size_bytes"] == 5 + 2 + 8
        assert json.loads(versions[0]["metadata"])["n_files"] == 3
        _check_dir(ArtifactDir(
            {"files": d.files + refs.files}, reader._backend.get_artifact_bytes,
        ), tmp_path, external)


def test_use_artifact_returns_an_artifact_dir(tree, tmp_path, live_server, monkeypatch):
    root, external = tree
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    for transport in (
        Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001),
        LocalTransport(tmp_path / ".cairn"),
    ):
        producer = cairn.Run(project="mf", transport=transport, **QUIET)
        producer.log_artifact([cairn.Reference(external.as_uri(), size=14)], name="data")
        producer.log_artifact(root, name="data")
        producer.finish()
        consumer = cairn.Run(project="mf", transport=transport, **QUIET)
        d = consumer.use_artifact("data:latest")
        consumer.finish()
        # v1 is the reference list, v2 the directory.
        refs = cairn.Run(project="mf", transport=transport, **QUIET)
        v1 = refs.use_artifact("data:v1")
        refs.finish()
        transport.close()
        assert {f["path"] for f in d.files} == {"labels.json", "train/a.txt", "train/b.bin"}
        assert v1.read("raw.tar") == b"external bytes"


def test_family_api_versions_carry_mime_type(client, tmp_path):
    rid = client.post("/api/runs", json={"project": "p"}).json()["run_id"]
    manifest = json.dumps({"files": []}).encode()
    h = client.post(
        "/api/artifacts",
        files={"file": ("m", manifest, MANIFEST_MIME)},
        data={"mime_type": MANIFEST_MIME, "metadata": "{}"},
    ).json()["hash"]
    fam = client.post("/api/projects/p/artifact-families", json={"name": "d", "type": "dataset"}).json()
    r = client.post(f"/api/artifact-families/{fam['id']}/versions", json={"hash": h, "created_by_run": rid})
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/artifact-families/{fam['id']}").json()
    assert detail["versions"][0]["mime_type"] == MANIFEST_MIME
    resolved = client.post("/api/projects/p/resolve-artifact-ref", json={"ref": "d:latest"}).json()
    assert resolved["mime_type"] == MANIFEST_MIME


def _seed(tmp_path, root):
    repo = tmp_path / "src" / ".cairn"
    producer = cairn.Run(project="mf", repo=repo, **QUIET)
    producer.log_artifact(root, name="data", artifact_type="dataset", aliases=["latest", "best"])
    producer.finish()
    consumer = cairn.Run(project="mf", repo=repo, **QUIET)
    consumer.use_artifact("data:best")
    consumer.finish()
    return repo, producer.id, consumer.id


def test_archive_carries_the_registry_and_manifest_files(tree, tmp_path):
    from cairn.server import run_archive

    root, _ = tree
    repo, producer, consumer = _seed(tmp_path, root)
    dd = DataDir(repo)
    db = Database.open(dd.db_path)
    buf = io.BytesIO()
    try:
        with zipfile.ZipFile(buf, "w") as zf:
            run_archive.write_archive(db, BlobStore(dd.artifacts_dir), dd, [producer, consumer], zf)
    finally:
        db.close()
    path = tmp_path / "runs.zip"
    path.write_bytes(buf.getvalue())

    registry = json.loads(zipfile.ZipFile(path).read("artifact_registry.json"))
    assert [f["name"] for f in registry["families"]] == ["data"]
    assert {a["alias"] for a in registry["aliases"]} == {"latest", "best"}
    assert [i["run_id"] for i in registry["inputs"]] == [consumer]

    with cairn.Reader(repo=path) as reader:
        d = reader.resolve_and_download_artifact("mf", "data:best")
        assert d.open("labels.json").read() == b'{"a": 1}'
        assert [r["family_name"] for r in reader.run(consumer).input_artifacts()] == ["data"]
        assert reader.lineage("mf")["edges"]


def test_import_merges_registry_into_a_live_repo(tree, tmp_path, client):
    root, _ = tree
    repo, producer, consumer = _seed(tmp_path, root)
    # Export through a server on the source repo, import into `client`'s repo twice.
    from fastapi.testclient import TestClient

    from cairn.server.app import create_app

    with TestClient(create_app(data_dir=repo, mount_ui=False)) as src:
        exported = src.post("/api/export", json={"run_ids": [producer, consumer]})
    assert exported.status_code == 200
    ids = []
    for _ in range(2):
        r = client.post("/api/import", files={"file": ("runs.zip", io.BytesIO(exported.content), "application/zip")})
        assert r.status_code == 200, r.text
        ids.append({x["original_id"]: x["new_id"] for x in r.json()["imported"]})

    fams = client.get("/api/projects/mf/artifact-families").json()
    fams = fams["families"] if isinstance(fams, dict) else fams
    (fam,) = [f for f in fams if f["name"] == "data"]
    detail = client.get(f"/api/artifact-families/{fam['id']}").json()
    # Same blob imported twice is one version, produced by the first import's run.
    assert [v["version"] for v in detail["versions"]] == [1]
    assert detail["versions"][0]["created_by_run"] == ids[0][producer]
    for id_map in ids:
        inputs = client.get(f"/api/runs/{id_map[consumer]}/inputs").json()["inputs"]
        assert [i["family_name"] for i in inputs] == ["data"]


def test_manifest_mime_matches_the_server():
    from cairn.server import artifact_refs

    assert artifact_refs.MANIFEST_MIME == MANIFEST_MIME


def test_unsafe_manifest_paths_are_refused(tmp_path):
    d = ArtifactDir({"files": [{"path": "../evil", "hash": "h", "size": 1}]}, lambda h: b"x")
    with pytest.raises(ValueError, match="unsafe"):
        d.download(tmp_path / "out")
    assert not (tmp_path / "evil").exists()


def test_reference_without_fsspec_hints(monkeypatch, tmp_path):
    import builtins

    real = builtins.__import__

    def fake(name, *a, **kw):
        if name == "fsspec":
            raise ImportError("no fsspec")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", fake)
    d = ArtifactDir({"files": [{"path": "x", "uri": "s3://b/x"}]}, lambda h: b"")
    with pytest.raises(ImportError, match="pip install fsspec"):
        d.read("x")
