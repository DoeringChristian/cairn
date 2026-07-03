"""Volume handler — (D,H,W) grid, spacing/origin/bounds, caps, npz roundtrip."""

from __future__ import annotations

import io

import numpy as np
import pytest

from cairn.sdk.handlers.volume import MAX_BYTES, VolumeHandler


def _load(data: bytes) -> np.ndarray:
    return np.load(io.BytesIO(data))["data"]


def test_roundtrip_default_spacing_origin():
    h = VolumeHandler()
    arr = np.random.default_rng(0).normal(size=(4, 5, 6)).astype(np.float32)
    data, meta = h.serialize(arr)
    assert meta["shape"] == [4, 5, 6]
    assert meta["spacing"] == [1.0, 1.0, 1.0]
    assert meta["origin"] == [0.0, 0.0, 0.0]
    back = _load(data)
    assert back.dtype == np.float32
    assert back.shape == (4, 5, 6)
    np.testing.assert_allclose(back, arr, rtol=1e-5)


def test_dtype_recorded_and_upcast_to_f4():
    h = VolumeHandler()
    arr = (np.random.default_rng(1).random((3, 3, 3)) * 100).astype(np.float64)
    data, meta = h.serialize(arr)
    assert meta["dtype"] == "float64"
    assert _load(data).dtype == np.float32


def test_metadata_stats():
    h = VolumeHandler()
    arr = np.zeros((2, 2, 2), dtype=np.float32)
    arr[0, 0, 0] = -5.0
    arr[1, 1, 1] = 10.0
    _, meta = h.serialize(arr)
    assert meta["vmin"] == pytest.approx(-5.0)
    assert meta["vmax"] == pytest.approx(10.0)
    assert meta["mean"] == pytest.approx(arr.mean())


def test_spacing_and_origin_and_bounds():
    h = VolumeHandler()
    arr = np.zeros((2, 3, 4), dtype=np.float32)
    _, meta = h.serialize(arr, spacing=[2.0, 1.0, 0.5], origin=[1.0, -1.0, 0.0])
    assert meta["spacing"] == [2.0, 1.0, 0.5]
    assert meta["origin"] == [1.0, -1.0, 0.0]
    assert meta["bounds"] == {
        "min": [1.0, -1.0, 0.0],
        # max = origin + shape * spacing, elementwise, in [D,H,W] order
        "max": [1.0 + 2 * 2.0, -1.0 + 3 * 1.0, 0.0 + 4 * 0.5],
    }


def test_bad_spacing_length_rejected():
    h = VolumeHandler()
    arr = np.zeros((2, 2, 2), dtype=np.float32)
    with pytest.raises(ValueError, match="spacing"):
        h.serialize(arr, spacing=[1.0, 1.0])
    with pytest.raises(ValueError, match="origin"):
        h.serialize(arr, origin=[1.0, 1.0])


def test_bad_shape_rejected():
    h = VolumeHandler()
    with pytest.raises(ValueError, match=r"\(D, H, W\)"):
        h.serialize(np.zeros((5, 5)))
    with pytest.raises(ValueError):
        h.serialize(np.zeros((2, 2, 2, 2)))


def test_max_bytes_cap():
    h = VolumeHandler()
    # nbytes = d*h*w*4 (float32); pick a shape just over MAX_BYTES.
    n = int((MAX_BYTES // 4) ** (1 / 3)) + 8
    huge = np.zeros((n, n, n), dtype=np.float32)
    assert huge.nbytes > MAX_BYTES
    with pytest.raises(ValueError, match="too large"):
        h.serialize(huge)


def test_can_handle_only_via_wrapper():
    h = VolumeHandler()
    assert not h.can_handle(np.zeros((4, 4, 4)))


def test_wrapper_threads_spacing_origin_kwargs():
    import cairn

    # cairn.Volume(obj, spacing=..., origin=...) stores extra kwargs on the
    # wrapper (base _TypeWrapper behavior); Run.track merges wrapper.kwargs
    # into handler.serialize(...) — verify the wrapper captures them so that
    # threading holds (serialize-level behavior itself is covered above).
    w = cairn.Volume(
        np.zeros((2, 2, 2), dtype=np.float32), spacing=[1.0, 2.0, 3.0], origin=[0.0, 0.0, 1.0]
    )
    assert w.object_type == "volume"
    assert w.kwargs == {"spacing": [1.0, 2.0, 3.0], "origin": [0.0, 0.0, 1.0]}
