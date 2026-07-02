"""Point-cloud handler — channel inference, rgb normalize, downsample, bounds."""

from __future__ import annotations

import io

import numpy as np
import pytest

from cairn.sdk.handlers.pointcloud import MAX_POINTS, PointCloudHandler


def _load(data: bytes) -> np.ndarray:
    return np.load(io.BytesIO(data), allow_pickle=False)


def test_xyz_roundtrip():
    h = PointCloudHandler()
    pts = np.random.default_rng(0).normal(size=(50, 3))
    data, meta = h.serialize(pts)
    assert meta["channels"] == "xyz"
    assert meta["n_points"] == 50
    assert meta["original_count"] == 50
    assert meta["downsampled"] is False
    back = _load(data)
    assert back.dtype == np.float32
    assert back.shape == (50, 3)


def test_xyzc_channels():
    h = PointCloudHandler()
    pts = np.column_stack([np.random.default_rng(1).normal(size=(20, 3)), np.zeros(20)])
    _, meta = h.serialize(pts)
    assert meta["channels"] == "xyzc"


def test_rgb_0_255_normalized():
    h = PointCloudHandler()
    xyz = np.zeros((10, 3))
    rgb = np.full((10, 3), 255.0)
    data, meta = h.serialize(np.hstack([xyz, rgb]))
    assert meta["channels"] == "xyzrgb"
    back = _load(data)
    np.testing.assert_allclose(back[:, 3:6], 1.0)


def test_rgb_0_1_preserved():
    h = PointCloudHandler()
    xyz = np.zeros((10, 3))
    rgb = np.full((10, 3), 0.5)
    data, _ = h.serialize(np.hstack([xyz, rgb]))
    back = _load(data)
    np.testing.assert_allclose(back[:, 3:6], 0.5)


def test_bounds_over_xyz():
    h = PointCloudHandler()
    pts = np.array([[0.0, -1.0, 2.0], [3.0, 1.0, -2.0]])
    _, meta = h.serialize(pts)
    assert meta["bounds"]["min"] == [0.0, -1.0, -2.0]
    assert meta["bounds"]["max"] == [3.0, 1.0, 2.0]


def test_downsample_seeded_and_deterministic():
    h = PointCloudHandler()
    n = MAX_POINTS + 5000
    pts = np.random.default_rng(2).normal(size=(n, 3))
    d1, m1 = h.serialize(pts)
    d2, m2 = h.serialize(pts)
    assert m1["n_points"] == MAX_POINTS
    assert m1["original_count"] == n
    assert m1["downsampled"] is True
    # Seeded downsample must be deterministic.
    np.testing.assert_array_equal(_load(d1), _load(d2))


def test_bad_shape_rejected():
    h = PointCloudHandler()
    with pytest.raises(ValueError, match=r"\(N, 3\)"):
        h.serialize(np.zeros((10, 5)))
    with pytest.raises(ValueError):
        h.serialize(np.zeros(10))


def test_can_handle_only_via_wrapper():
    h = PointCloudHandler()
    assert not h.can_handle(np.zeros((10, 3)))
