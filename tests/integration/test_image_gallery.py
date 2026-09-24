"""A tracked list of cairn.Image is one gallery point, as in wandb."""

from __future__ import annotations

import io
import json
import zipfile

import numpy as np
import pytest

import cairn
from cairn.sdk.handlers.image import GALLERY_MIME
from cairn.sdk.transport import Transport


@pytest.fixture
def transport(live_server, tmp_path, monkeypatch):
    monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
    t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
    yield t
    t.close()


@pytest.fixture
def http(live_server):
    import httpx

    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        yield c


def _run(transport):
    return cairn.Run(project="gallery", name="r", capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False, transport=transport)


def _images():
    rng = np.random.default_rng(0)
    return [rng.random((8, 8, 3)).astype(np.float32) for _ in range(3)]


def test_list_of_images_is_one_gallery_point(transport, http, live_server):
    a, b, c = _images()
    run = _run(transport)
    try:
        run.track([cairn.Image(a), cairn.Image(b), cairn.Image(c, encoding="exr")], name="samples", step=0)
        run.scope(step=1).track([cairn.Image(a)], "sc.samples")
    finally:
        run.finish()

    points = http.get(f"/api/runs/{run.id}/sequences/samples").json()["points"]
    assert len(points) == 1
    point = points[0]
    assert point["artifact_mime"] == GALLERY_MIME
    assert json.loads(point["artifact_metadata"])["gallery"] == 3
    manifest = http.get(f"/api/artifacts/{point['artifact_hash']}").json()
    assert [i["mime_type"] for i in manifest["images"]] == ["image/png", "image/png", "image/x-exr"]
    for item in manifest["images"]:
        assert http.get(f"/api/artifacts/{item['hash']}").status_code == 200

    back = cairn.Reader(repo=live_server.replace("http://", "cairn://")).run(run.id)
    decoded = back.artifact("samples")
    assert len(decoded) == 3 and isinstance(decoded[2], np.ndarray)
    assert len(back.artifact("sc.samples", step=1)) == 1


def test_export_carries_the_gallery_images(transport, http):
    run = _run(transport)
    try:
        run.track([cairn.Image(x) for x in _images()], name="samples", step=0)
    finally:
        run.finish()
    manifest_hash = http.get(f"/api/runs/{run.id}/sequences/samples").json()["points"][0]["artifact_hash"]
    manifest = http.get(f"/api/artifacts/{manifest_hash}").json()

    exported = http.post("/api/export", json={"run_ids": [run.id]})
    assert exported.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(exported.content)).namelist()
    for h in [manifest_hash, *(i["hash"] for i in manifest["images"])]:
        assert any(n.startswith(f"artifacts/{h}") for n in names), h


def test_image_wrapper_rejects_a_list():
    with pytest.raises(TypeError, match="track a list"):
        cairn.Image([np.zeros((2, 2, 3))])
