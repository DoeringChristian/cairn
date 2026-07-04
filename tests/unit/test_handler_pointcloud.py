"""Point-cloud handler — channel inference, rgb normalize, downsample, bounds,
named per-point properties."""

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


# ── Named per-point properties (spec-3dx-superseded §B) ─────────────────────


def test_no_values_stays_plain_npy_format():
    """Without `values=`, the blob is still a bare .npy array — byte-for-byte
    the same format as before named properties existed (`data[:2] != b"PK"`,
    the ZIP/npz magic)."""
    h = PointCloudHandler()
    pts = np.random.default_rng(3).normal(size=(10, 3))
    data, meta = h.serialize(pts)
    assert data[:2] != b"PK"
    assert "properties" not in meta
    assert "value_range" not in meta
    back = h.deserialize(data)
    assert isinstance(back, np.ndarray)


def test_single_values_array_canonicalized_to_value_property():
    h = PointCloudHandler()
    pts = np.random.default_rng(4).normal(size=(5, 3))
    values = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    data, meta = h.serialize(pts, values=values)
    assert data[:2] == b"PK"
    assert meta["properties"] == [{"name": "value", "min": 0.0, "max": 4.0, "mean": 2.0}]
    assert meta["value_range"] == {"min": 0.0, "max": 4.0, "mean": 2.0}
    back = h.deserialize(data)
    assert isinstance(back, dict)
    np.testing.assert_allclose(back["points"][:, :3], pts.astype(np.float32))
    np.testing.assert_allclose(back["values_value"], values.astype(np.float32))


def test_named_properties_dict():
    h = PointCloudHandler()
    pts = np.random.default_rng(5).normal(size=(4, 3))
    loss = np.array([1.0, 2.0, 3.0, 4.0])
    curvature = np.array([-1.0, 0.0, 1.0, 2.0])
    data, meta = h.serialize(pts, values={"loss": loss, "curvature": curvature})
    assert [p["name"] for p in meta["properties"]] == ["loss", "curvature"]
    # value_range mirrors the FIRST property (insertion order).
    assert meta["value_range"] == {"min": 1.0, "max": 4.0, "mean": 2.5}
    back = h.deserialize(data)
    np.testing.assert_allclose(back["values_loss"], loss.astype(np.float32))
    np.testing.assert_allclose(back["values_curvature"], curvature.astype(np.float32))


def test_properties_downsampled_with_same_index_as_points():
    h = PointCloudHandler()
    n = MAX_POINTS + 1000
    pts = np.random.default_rng(6).normal(size=(n, 3))
    # A property whose value IS the original row index lets us verify the
    # downsample index set applied to `values` matches the one applied to
    # the points themselves (same seeded `rng.choice`).
    row_index = np.arange(n, dtype=np.float64)
    data, meta = h.serialize(pts, values=row_index)
    assert meta["downsampled"] is True
    back = h.deserialize(data)
    kept_points = back["points"]
    kept_values = back["values_value"]
    assert kept_points.shape[0] == MAX_POINTS
    for i in range(0, MAX_POINTS, MAX_POINTS // 20):
        original_row = int(round(float(kept_values[i])))
        np.testing.assert_allclose(kept_points[i, :3], pts[original_row].astype(np.float32), atol=1e-4)


def test_named_properties_bad_length_rejected():
    h = PointCloudHandler()
    pts = np.zeros((5, 3))
    with pytest.raises(ValueError, match=r"property 'loss'"):
        h.serialize(pts, values={"loss": np.zeros(3)})
