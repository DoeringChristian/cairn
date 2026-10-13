"""A float image logged through Run.track is PNG by default and EXR/npy on request, end to end."""

from __future__ import annotations

import json

import numpy as np
import pytest

import cairn
from cairn.sdk.runlog.rundir import RunDir


@pytest.fixture
def server(live_server):
    return live_server


@pytest.fixture
def reader(live_server):
    import httpx

    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        yield c


def _run(server):
    return cairn.Run(project="exr", name="r", capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False, server=server)


def test_image_encoding_from_track_to_artifact_route(server, reader):
    run = _run(server)
    arr = np.random.default_rng(0).random((16, 24, 3)).astype(np.float32)
    try:
        run.track(arr, name="default", step=0)
        run.track(cairn.Image(arr, encoding="exr:dwab"), name="render", step=0)
        run.track(arr, name="raw", step=0, encoding="npy")
        run.track(cairn.Image(arr[..., 0], encoding="exr::float"), name="gray", step=0)
        # call keyword overrides wrapper keyword (Run.track merges {**wrapper, **call})
        run.track(cairn.Image(arr, encoding="npy"), name="override", step=0, encoding="exr")
    finally:
        run.finish()
    for name, mime, magic in [
        ("default", "image/png", b"\x89PNG"),
        ("render", "image/x-exr", b"\x76\x2f\x31\x01"),
        ("raw", "application/x-npy", b"\x93NUMPY"),
        ("gray", "image/x-exr", b"\x76\x2f\x31\x01"),
        ("override", "image/x-exr", b"\x76\x2f\x31\x01"),
    ]:
        # detail route is keyed by NAME: routes/sequences.py:108, as in test_run_e2e.py:63
        point = reader.get(f"/api/runs/{run.id}/sequences/{name}").json()["points"][0]
        assert point["artifact_mime"] == mime
        r = reader.get(f"/api/artifacts/{point['artifact_hash']}")
        assert r.status_code == 200 and r.headers["content-type"].startswith(mime)
        assert r.content.startswith(magic)
        assert r.headers["cache-control"].startswith("public")
    gray_meta = reader.get(f"/api/runs/{run.id}/sequences/gray").json()["points"][0]["artifact_metadata"]
    assert json.loads(gray_meta)["encoding"] == "exr:piz:float"


def test_a_large_exr_is_a_blob_of_the_run_directory(server, reader):
    run = _run(server)
    # 512x512x3 half EXR, stored uncompressed => ~1.5 MB: a blob file, not a record.
    arr = np.random.default_rng(1).random((512, 512, 3)).astype(np.float32)
    try:
        run.track(cairn.Image(arr, encoding="exr:none"), name="big", step=0)
        blobs = list(RunDir.for_run(run.id).blobs_dir.iterdir())
        assert blobs and max(b.stat().st_size for b in blobs) > 1 << 20
    finally:
        run.finish()
    point = reader.get(f"/api/runs/{run.id}/sequences/big").json()["points"][0]
    assert point["artifact_mime"] == "image/x-exr"
    r = reader.get(f"/api/artifacts/{point['artifact_hash']}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/x-exr")
    assert r.content.startswith(b"\x76\x2f\x31\x01")
