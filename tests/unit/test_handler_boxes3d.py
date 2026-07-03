"""Boxes3D handler — mins/maxs/depth/values roundtrip, caps, validation."""

from __future__ import annotations

import io

import numpy as np
import pytest

from cairn.sdk.handlers.boxes3d import MAX_BOXES, Boxes3DHandler
from cairn.sdk.wrappers import BVH, Boxes3D, Octree


def _load(data: bytes) -> dict:
    return dict(np.load(io.BytesIO(data)))


def _boxes(n: int, rng: np.random.Generator):
    mins = rng.normal(size=(n, 3)).astype(np.float32)
    maxs = mins + rng.uniform(0.1, 1.0, size=(n, 3)).astype(np.float32)
    return mins, maxs


def test_roundtrip_minimal():
    h = Boxes3DHandler()
    rng = np.random.default_rng(0)
    mins, maxs = _boxes(20, rng)
    data, meta = h.serialize({"mins": mins, "maxs": maxs})
    assert meta["n_boxes"] == 20
    assert meta["kind"] == "boxes"
    assert meta["max_depth"] == 0
    assert "value_range" not in meta

    back = _load(data)
    np.testing.assert_allclose(back["mins"], mins)
    np.testing.assert_allclose(back["maxs"], maxs)
    assert back["depth"].dtype == np.uint16
    np.testing.assert_array_equal(back["depth"], np.zeros(20, dtype=np.uint16))
    assert "values" not in back


def test_roundtrip_depth_and_values():
    h = Boxes3DHandler()
    rng = np.random.default_rng(1)
    mins, maxs = _boxes(15, rng)
    depth = rng.integers(0, 5, size=15)
    values = rng.normal(size=15).astype(np.float32)
    data, meta = h.serialize(
        {"mins": mins, "maxs": maxs, "depth": depth, "values": values}, kind="octree"
    )
    assert meta["kind"] == "octree"
    assert meta["max_depth"] == int(depth.max())
    assert "value_range" in meta
    assert meta["value_range"]["min"] == pytest.approx(float(values.min()))
    assert meta["value_range"]["max"] == pytest.approx(float(values.max()))
    assert meta["value_range"]["mean"] == pytest.approx(float(values.mean()))

    back = _load(data)
    np.testing.assert_array_equal(back["depth"], depth.astype(np.uint16))
    np.testing.assert_allclose(back["values"], values)


def test_bounds_over_mins_maxs():
    h = Boxes3DHandler()
    mins = np.array([[0.0, -1.0, 2.0], [3.0, 1.0, -2.0]], dtype=np.float32)
    maxs = np.array([[1.0, 0.0, 3.0], [4.0, 2.0, -1.0]], dtype=np.float32)
    _, meta = h.serialize({"mins": mins, "maxs": maxs})
    assert meta["bounds"]["min"] == [0.0, -1.0, -2.0]
    assert meta["bounds"]["max"] == [4.0, 2.0, 3.0]
    assert meta["size_bytes"] == mins.nbytes + maxs.nbytes + 2 * 2  # depth is u2


def test_metadata_size_bytes_positive():
    h = Boxes3DHandler()
    rng = np.random.default_rng(2)
    mins, maxs = _boxes(5, rng)
    _, meta = h.serialize({"mins": mins, "maxs": maxs})
    assert meta["size_bytes"] > 0


def test_validation_mins_le_maxs():
    h = Boxes3DHandler()
    mins = np.array([[0.0, 0.0, 0.0]], dtype=np.float32)
    maxs = np.array([[-1.0, 1.0, 1.0]], dtype=np.float32)
    with pytest.raises(ValueError, match="mins <= maxs"):
        h.serialize({"mins": mins, "maxs": maxs})


def test_validation_bad_shape():
    h = Boxes3DHandler()
    with pytest.raises(ValueError, match=r"\(N, 3\)"):
        h.serialize({"mins": np.zeros((10, 2)), "maxs": np.zeros((10, 2))})


def test_validation_mismatched_maxs_shape():
    h = Boxes3DHandler()
    with pytest.raises(ValueError, match="maxs must have the same shape"):
        h.serialize({"mins": np.zeros((10, 3)), "maxs": np.zeros((5, 3))})


def test_validation_missing_arrays():
    h = Boxes3DHandler()
    with pytest.raises(ValueError, match="requires both"):
        h.serialize({"mins": None, "maxs": None})


def test_validation_depth_length_mismatch():
    h = Boxes3DHandler()
    mins = np.zeros((10, 3), dtype=np.float32)
    maxs = np.ones((10, 3), dtype=np.float32)
    with pytest.raises(ValueError, match="depth must have length"):
        h.serialize({"mins": mins, "maxs": maxs, "depth": np.zeros(3)})


def test_validation_values_length_mismatch():
    h = Boxes3DHandler()
    mins = np.zeros((10, 3), dtype=np.float32)
    maxs = np.ones((10, 3), dtype=np.float32)
    with pytest.raises(ValueError, match="values must have length"):
        h.serialize({"mins": mins, "maxs": maxs, "values": np.zeros(3)})


def test_max_boxes_cap_raises():
    h = Boxes3DHandler()
    n = MAX_BOXES + 1
    mins = np.zeros((n, 3), dtype=np.float32)
    maxs = np.ones((n, 3), dtype=np.float32)
    with pytest.raises(ValueError, match="too many boxes"):
        h.serialize({"mins": mins, "maxs": maxs})


def test_can_handle_only_via_wrapper():
    h = Boxes3DHandler()
    assert not h.can_handle(np.zeros((10, 3)))


def test_wrapper_kind_boxes():
    rng = np.random.default_rng(3)
    mins, maxs = _boxes(5, rng)
    w = Boxes3D(mins, maxs)
    assert w.object_type == "boxes3d"
    assert w.kwargs["kind"] == "boxes"
    assert w.obj["depth"] is None
    assert w.obj["values"] is None


def test_wrapper_kind_octree():
    rng = np.random.default_rng(4)
    mins, maxs = _boxes(5, rng)
    w = Octree(mins, maxs)
    assert w.object_type == "boxes3d"
    assert w.kwargs["kind"] == "octree"


def test_wrapper_kind_bvh():
    rng = np.random.default_rng(5)
    mins, maxs = _boxes(5, rng)
    w = BVH(mins, maxs, values=np.ones(5, dtype=np.float32))
    assert w.object_type == "boxes3d"
    assert w.kwargs["kind"] == "bvh"
    assert w.obj["values"] is not None


def test_wrapper_end_to_end_via_handler():
    """Wrapper obj/kwargs feed straight into the handler (mirrors run.track's
    ``handler.serialize(payload, **merged_kwargs)`` dispatch)."""
    rng = np.random.default_rng(6)
    mins, maxs = _boxes(8, rng)
    w = Octree(mins, maxs)
    h = Boxes3DHandler()
    data, meta = h.serialize(w.obj, **w.kwargs)
    assert meta["kind"] == "octree"
    assert meta["n_boxes"] == 8
