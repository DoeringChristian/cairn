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
    # Winding normalization may reorder indices *within* a face (to fix
    # orientation) but must preserve which triangle each face is — compare
    # as per-face index sets rather than exact array equality (see the
    # dedicated winding tests below for orientation-direction assertions).
    np.testing.assert_array_equal(
        np.sort(back["faces"], axis=1), np.sort(faces.astype(np.uint32), axis=1)
    )


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


# ── Winding normalization ────────────────────────────────────────────────
#
# Fixture: a regular octahedron (6 vertices on the axes, 8 faces — one per
# octant). It's convex/star-shaped around its own centroid (the origin), so
# the centroid-direction heuristic in `serialize()` is *exact* here, not
# just approximate — a solid ground truth to test against.
_OCTA_VERTICES = np.array(
    [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
    dtype=np.float64,
)
# Verified CCW-from-outside: cross(v1-v0, v2-v0) . face_centroid > 0 for each.
_OCTA_FACES_CCW = np.array(
    [
        [0, 2, 4],
        [0, 5, 2],
        [0, 4, 3],
        [0, 3, 5],
        [1, 4, 2],
        [1, 2, 5],
        [1, 3, 4],
        [1, 5, 3],
    ],
    dtype=np.int64,
)


def _flip(faces: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Reverse winding (swap last two indices) of the faces selected by `mask`."""
    out = faces.copy()
    out[mask] = out[mask][:, [0, 2, 1]]
    return out


def _assert_all_ccw(vertices: np.ndarray, faces: np.ndarray) -> None:
    centroid = vertices.mean(axis=0)
    v0, v1, v2 = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    normal = np.cross(v1 - v0, v2 - v0)
    face_centroid = (v0 + v1 + v2) / 3.0
    dot = np.einsum("ij,ij->i", normal, face_centroid - centroid)
    assert np.all(dot > 0), f"non-CCW faces remain, dots={dot}"


def test_winding_already_ccw_faces_byte_identical():
    h = MeshHandler()
    data, meta = h.serialize({"vertices": _OCTA_VERTICES, "faces": _OCTA_FACES_CCW})
    assert meta["winding_normalized"] == 0
    back = _load(data)
    np.testing.assert_array_equal(back["faces"], _OCTA_FACES_CCW.astype(np.uint32))


def test_winding_all_cw_input_normalized_to_ccw():
    h = MeshHandler()
    all_flipped = _flip(_OCTA_FACES_CCW, np.ones(len(_OCTA_FACES_CCW), dtype=bool))
    data, meta = h.serialize({"vertices": _OCTA_VERTICES, "faces": all_flipped})
    assert meta["winding_normalized"] == len(_OCTA_FACES_CCW)
    back = _load(data)
    _assert_all_ccw(_OCTA_VERTICES, back["faces"].astype(np.int64))
    np.testing.assert_array_equal(back["faces"], _OCTA_FACES_CCW.astype(np.uint32))


def test_winding_mixed_input_repaired():
    h = MeshHandler()
    mask = np.array([True, False, True, False, True, False, True, False])
    mixed = _flip(_OCTA_FACES_CCW, mask)
    data, meta = h.serialize({"vertices": _OCTA_VERTICES, "faces": mixed})
    assert meta["winding_normalized"] == int(mask.sum())
    back = _load(data)
    _assert_all_ccw(_OCTA_VERTICES, back["faces"].astype(np.int64))
    np.testing.assert_array_equal(back["faces"], _OCTA_FACES_CCW.astype(np.uint32))


def test_winding_flip_leaves_user_normals_untouched():
    h = MeshHandler()
    all_flipped = _flip(_OCTA_FACES_CCW, np.ones(len(_OCTA_FACES_CCW), dtype=bool))
    normals = np.random.default_rng(0).normal(size=(6, 3))
    data, meta = h.serialize(
        {"vertices": _OCTA_VERTICES, "faces": all_flipped, "normals": normals}
    )
    assert meta["winding_normalized"] == len(_OCTA_FACES_CCW)
    back = _load(data)
    # Normals are per-vertex; winding only reorders each face's own indices,
    # so the supplied normals must round-trip untouched (aside from dtype).
    np.testing.assert_allclose(back["normals"], normals.astype(np.float32))
