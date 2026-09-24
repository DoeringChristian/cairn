"""Media in table cells: each cairn.Image/Audio/Video cell is its own artifact,
and the table holds ``{"$media": {hash, mime_type, object_type}}`` in its place."""

from __future__ import annotations

import io
import json
import zipfile

import numpy as np
import pytest

import cairn
from cairn.sdk.handlers.table import TableHandler
from cairn.sdk.local import LocalTransport
from cairn.sdk.transport import Transport
from cairn.server.storage.blobs import BlobStore
from cairn.server.storage.datadir import DataDir
from cairn.server.storage.db import Database
from cairn.server.wal_ingest import ingest_all

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)


def _images():
    rng = np.random.default_rng(0)
    return [rng.random((6, 6, 3)).astype(np.float32) for _ in range(2)]


def _log(run):
    a, b = _images()
    run.track(cairn.Table(columns=["id", "img"], data=[[0, cairn.Image(a)], [1, cairn.Image(b)], [2, None]]),
              name="preds", step=0)
    run.log_artifact(cairn.Table(columns=["img"], data=[[cairn.Image(a)]]), name="named")


@pytest.fixture(params=["http", "local", "wal"])
def backend(request, tmp_path, monkeypatch):
    """Yields ``(transport, reader_repo, finish)`` for the three write paths."""
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
            dd = DataDir(repo)
            db = Database.open(dd.db_path)
            try:
                ingest_all(dd, db, BlobStore(dd.artifacts_dir))
            finally:
                db.close()

    yield t, repo, finish


def test_media_cells_roundtrip_through_every_backend(backend):
    transport, repo, finish = backend
    run = cairn.Run(project="tm", transport=transport, **QUIET)
    try:
        _log(run)
    finally:
        run.finish()
    finish()

    reader = cairn.Reader(repo=repo)
    try:
        r = reader.run(run.id)
        table = r.artifact("preds")
        assert [c["type"] for c in table["columns"]] == ["number", "media"]
        ref = table["data"][0][1]
        assert isinstance(ref, cairn.MediaRef)
        assert (ref.mime_type, ref.object_type) == ("image/png", "image")
        assert ref.load().size == (6, 6)
        assert table["data"][2][1] is None
        meta = json.loads(next(a.metadata for a in r.artifacts() if a.name == "preds"))
        assert meta["media_hashes"] == [table["data"][0][1].hash, table["data"][1][1].hash]
        assert isinstance(r.artifact("named")["data"][0][0], cairn.MediaRef)
    finally:
        reader.close()


def test_dataframe_media_cells(tmp_path):
    pd = pytest.importorskip("pandas")
    (a, _) = _images()
    run = cairn.Run(project="tm", repo=tmp_path / ".cairn", **QUIET)
    run.track(cairn.Table(dataframe=pd.DataFrame({"x": [1], "img": [cairn.Image(a)]})), name="t", step=0)
    run.finish()
    reader = cairn.Reader(repo=tmp_path / ".cairn")
    try:
        cell = reader.run(run.id).artifact("t")["data"][0][1]
        assert isinstance(cell, cairn.MediaRef)
    finally:
        reader.close()


def test_export_carries_media_cells(live_server, tmp_path, monkeypatch):
    import httpx

    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
    run = cairn.Run(project="tm", transport=t, **QUIET)
    _log(run)
    run.finish()
    t.close()
    with httpx.Client(base_url=live_server, timeout=10.0) as http:
        point = http.get(f"/api/runs/{run.id}/sequences/preds").json()["points"][0]
        hashes = json.loads(point["artifact_metadata"])["media_hashes"]
        exported = http.post("/api/export", json={"run_ids": [run.id]})
    names = zipfile.ZipFile(io.BytesIO(exported.content)).namelist()
    for h in hashes:
        assert any(n.startswith(f"artifacts/{h}") for n in names), h

    path = tmp_path / "runs.zip"
    path.write_bytes(exported.content)
    with cairn.Reader(repo=path) as reader:
        assert reader.run(run.id).artifact("preds")["data"][1][1].load().size == (6, 6)


def test_handler_passes_media_cells_through():
    ref = {"$media": {"hash": "h", "mime_type": "image/png", "object_type": "image"}}
    blob, _ = TableHandler().serialize({"columns": ["m", "x"], "data": [[ref, {"a": 1}]], "dataframe": None})
    table = json.loads(blob)
    assert [c["type"] for c in table["columns"]] == ["media", "other"]
    assert table["data"][0] == [ref, "{'a': 1}"]
