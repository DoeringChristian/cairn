"""A float image logged through Run.track arrives as image/x-exr end to end."""

from __future__ import annotations

import numpy as np
import pytest

import cairn
from cairn.sdk.transport import Transport


@pytest.fixture
def transport(live_server):
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
    assert '"precision": "float"' in gray_meta or '"precision":"float"' in gray_meta
