"""A float image logged through Run.track arrives as image/x-exr end to end."""

from __future__ import annotations

import json

import numpy as np
import pytest

import cairn
from cairn.sdk.transport import Transport
from cairn.sdk.wal import INLINE_ARTIFACT_MAX


@pytest.fixture
def wal_dir(tmp_path, monkeypatch):
    """Run builds its own WAL over any injected transport (run.py:249-253); this
    redirects it (and its artifact spill files) from the user cache into tmp_path."""
    path = tmp_path / "wal"
    monkeypatch.setenv("CAIRN_WAL_DIR", str(path))
    return path


@pytest.fixture
def transport(live_server, wal_dir):
    t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
    yield t
    t.close()


@pytest.fixture
def reader(live_server):
    import httpx

    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        yield c


def _run(transport):
    return cairn.Run(project="exr", name="r", capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False, transport=transport)


def test_float_image_is_exr_from_track_to_artifact_route(transport, reader):
    run = _run(transport)
    arr = np.random.default_rng(0).random((16, 24, 3)).astype(np.float32)
    try:
        run.track(arr, name="render", step=0)
        run.track(arr, name="raw", step=0, format="npy")
        run.track(cairn.Image(arr[..., 0], precision="float"), name="gray", step=0)
        # call keyword overrides wrapper keyword (Run.track merges {**wrapper, **call}, run.py:415)
        run.track(cairn.Image(arr, format="npy"), name="override", step=0, format="exr")
    finally:
        run.finish()
    for name, mime, magic in [
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
    assert json.loads(gray_meta)["hdr"]["precision"] == "float"


def test_exr_larger_than_the_wal_inline_limit_spills_to_a_file(transport, reader, wal_dir):
    run = _run(transport)
    # 512x512x3 half EXR, stored uncompressed => ~1.5 MB, past the 1 MB inline cap.
    arr = np.random.default_rng(1).random((512, 512, 3)).astype(np.float32)
    try:
        run.track(cairn.Image(arr, compression="none"), name="big", step=0)
        # Assert before finish(): a fully-acked WAL is cleanup()ed there, spills and all.
        spills = list(wal_dir.glob(f"{run.id}.artifact.*.bin"))
        assert spills and spills[0].stat().st_size > INLINE_ARTIFACT_MAX
    finally:
        run.finish()
    point = reader.get(f"/api/runs/{run.id}/sequences/big").json()["points"][0]
    assert point["artifact_mime"] == "image/x-exr"
    r = reader.get(f"/api/artifacts/{point['artifact_hash']}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/x-exr")
    assert r.content.startswith(b"\x76\x2f\x31\x01")
