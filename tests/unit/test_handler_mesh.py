"""Mesh handler — shape/index validation, values/colors/normals, caps."""

from __future__ import annotations

import io

import numpy as np
import pytest

from cairn.sdk.handlers.mesh import MAX_BYTES, MeshHandler


def _load(data: bytes) -> dict[str, np.ndarray]:
    loaded = np.load(io.BytesIO(data))
    return {k: loaded[k] for k in loaded.files}


def _triangle(n_verts: int = 4) -> tuple[np.ndarray, np.ndarray]:
    vertices = np.random.default_rng(0).normal(size=(n_verts, 3))
    faces = np.array([[0, 1, 2], [1, 2, 3 % n_verts]], dtype=np.int64)
    return vertices, faces


def test_roundtrip_positions_faces():
    h = MeshHandler()
    vertices, faces = _triangle()
    data, meta = h.serialize({"vertices": vertices, "faces": faces})
    assert meta["n_vertices"] == 4
    assert meta["n_faces"] == 2
    assert meta["has_colors"] is False
    assert meta["has_normals"] is False
    assert "value_range" not in meta
    back = _load(data)
    assert back["positions"].dtype == np.float32
    assert back["positions"].shape == (4, 3)
    assert back["faces"].dtype == np.uint32
    assert back["faces"].shape == (2, 3)
    np.testing.assert_array_equal(back["faces"], faces.astype(np.uint32))


def test_metadata_bounds():
    h = MeshHandler()
    vertices = np.array([[0.0, -1.0, 2.0], [3.0, 1.0, -2.0], [1.0, 0.0, 0.0]])
    faces = np.array([[0, 1, 2]])
    _, meta = h.serialize({"vertices": vertices, "faces": faces})
    assert meta["bounds"]["min"] == [0.0, -1.0, -2.0]
    assert meta["bounds"]["max"] == [3.0, 1.0, 2.0]


def test_values_recorded_in_metadata_and_blob():
    h = MeshHandler()
    vertices, faces = _triangle()
    values = np.array([0.0, 1.0, 2.0, 3.0])
    data, meta = h.serialize({"vertices": vertices, "faces": faces, "values": values})
    assert meta["value_range"] == {"min": 0.0, "max": 3.0, "mean": 1.5}
    back = _load(data)
    np.testing.assert_allclose(back["values"], values.astype(np.float32))


def test_colors_0_255_normalized():
    h = MeshHandler()
    vertices, faces = _triangle()
    colors = np.full((4, 3), 255.0)
    data, meta = h.serialize({"vertices": vertices, "faces": faces, "colors": colors})
    assert meta["has_colors"] is True
    back = _load(data)
    np.testing.assert_allclose(back["colors"], 1.0)


def test_colors_0_1_preserved():
    h = MeshHandler()
    vertices, faces = _triangle()
    colors = np.full((4, 3), 0.5)
    data, _ = h.serialize({"vertices": vertices, "faces": faces, "colors": colors})
    back = _load(data)
    np.testing.assert_allclose(back["colors"], 0.5)


def test_normals_roundtrip():
    h = MeshHandler()
    vertices, faces = _triangle()
    normals = np.tile(np.array([0.0, 0.0, 1.0]), (4, 1))
    data, meta = h.serialize({"vertices": vertices, "faces": faces, "normals": normals})
    assert meta["has_normals"] is True
    back = _load(data)
    np.testing.assert_allclose(back["normals"], normals.astype(np.float32))


def test_bad_vertex_shape_rejected():
    h = MeshHandler()
    with pytest.raises(ValueError, match=r"\(N, 3\)"):
        h.serialize({"vertices": np.zeros((10, 4)), "faces": np.zeros((2, 3), dtype=np.int64)})


def test_bad_face_shape_rejected():
    h = MeshHandler()
    with pytest.raises(ValueError, match=r"\(M, 3\)"):
        h.serialize({"vertices": np.zeros((10, 3)), "faces": np.zeros((2, 4), dtype=np.int64)})


def test_face_index_out_of_range_rejected():
    h = MeshHandler()
    vertices = np.zeros((3, 3))
    faces = np.array([[0, 1, 3]])  # 3 is out of range for 3 vertices
    with pytest.raises(ValueError, match="face indices"):
        h.serialize({"vertices": vertices, "faces": faces})


def test_bad_values_shape_rejected():
    h = MeshHandler()
    vertices, faces = _triangle()
    with pytest.raises(ValueError, match="values"):
        h.serialize({"vertices": vertices, "faces": faces, "values": np.zeros(3)})


def test_bad_colors_shape_rejected():
    h = MeshHandler()
    vertices, faces = _triangle()
    with pytest.raises(ValueError, match="colors"):
        h.serialize({"vertices": vertices, "faces": faces, "colors": np.zeros((3, 3))})


def test_max_bytes_cap_raises():
    h = MeshHandler()
    # positions alone: n * 3 * 4 bytes must exceed MAX_BYTES.
    n = MAX_BYTES // (3 * 4) + 1000
    vertices = np.zeros((n, 3), dtype=np.float32)
    faces = np.array([[0, 1, 2]], dtype=np.int64)
    with pytest.raises(ValueError, match="too large"):
        h.serialize({"vertices": vertices, "faces": faces})


def test_non_dict_obj_rejected():
    h = MeshHandler()
    with pytest.raises(TypeError):
        h.serialize(np.zeros((10, 3)))


def test_can_handle_only_via_wrapper():
    h = MeshHandler()
    assert not h.can_handle(np.zeros((10, 3)))
