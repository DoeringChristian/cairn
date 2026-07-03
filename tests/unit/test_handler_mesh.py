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
# Fixture 1: a regular octahedron (6 vertices on the axes, 8 faces — one per
# octant). Closed convex manifold: `_normalize_winding` takes the
# orientation-propagation + signed-volume path (exact), and convexity also
# makes the per-face cross-product-vs-centroid check an exact ground truth
# for the assertions.
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


# Fixture 2: a torus — a closed manifold that is NOT star-shaped around its
# own centroid (the origin sits in the empty hole). A per-face centroid
# heuristic would silently corrupt ~43% of its faces at log time; the
# topological normalization (orientation propagation + signed volume) must
# handle it exactly. Ground truth is the analytic torus surface normal
# (cos v cos u, cos v sin u, sin v), independent of the mesh's own topology.
def _torus(
    n_u: int = 12, n_v: int = 8, big_r: float = 1.0, tube_r: float = 0.35
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """CCW-from-outside torus: ``(vertices, faces, analytic_normals)``."""
    u = 2 * np.pi * np.arange(n_u) / n_u
    v = 2 * np.pi * np.arange(n_v) / n_v
    uu, vv = np.meshgrid(u, v, indexing="ij")
    vertices = np.stack(
        [
            (big_r + tube_r * np.cos(vv)) * np.cos(uu),
            (big_r + tube_r * np.cos(vv)) * np.sin(uu),
            tube_r * np.sin(vv),
        ],
        axis=-1,
    ).reshape(-1, 3)
    analytic = np.stack(
        [np.cos(vv) * np.cos(uu), np.cos(vv) * np.sin(uu), np.sin(vv)], axis=-1
    ).reshape(-1, 3)
    faces = []
    for i in range(n_u):
        for j in range(n_v):
            a = i * n_v + j
            b = i * n_v + (j + 1) % n_v
            c = ((i + 1) % n_u) * n_v + j
            d = ((i + 1) % n_u) * n_v + (j + 1) % n_v
            faces.append((a, c, b))
            faces.append((b, c, d))
    return vertices, np.array(faces, dtype=np.int64), analytic


def _assert_all_ccw_analytic(
    vertices: np.ndarray, faces: np.ndarray, analytic_normals: np.ndarray
) -> None:
    """Every face's cross-product normal agrees with the true surface normal."""
    v0, v1, v2 = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    normal = np.cross(v1 - v0, v2 - v0)
    dot = np.einsum("ij,ij->i", normal, analytic_normals[faces[:, 0]])
    assert np.all(dot > 0), (
        f"{int(np.sum(dot <= 0))}/{len(faces)} faces wound against the "
        "analytic surface normal"
    )


def test_winding_torus_ccw_roundtrips_with_zero_flips():
    # The regression the centroid heuristic failed: a correctly-wound torus
    # must come back byte-identical (0 flips), so the UI's
    # computeVertexNormals produces outward normals without any user help.
    h = MeshHandler()
    vertices, faces, analytic = _torus()
    data, meta = h.serialize({"vertices": vertices, "faces": faces})
    assert meta["winding_normalized"] == 0
    back = _load(data)
    np.testing.assert_array_equal(back["faces"], faces.astype(np.uint32))
    _assert_all_ccw_analytic(vertices, back["faces"].astype(np.int64), analytic)


def test_winding_torus_all_cw_repaired():
    h = MeshHandler()
    vertices, faces, analytic = _torus()
    all_flipped = _flip(faces, np.ones(len(faces), dtype=bool))
    data, meta = h.serialize({"vertices": vertices, "faces": all_flipped})
    assert meta["winding_normalized"] == len(faces)
    back = _load(data)
    _assert_all_ccw_analytic(vertices, back["faces"].astype(np.int64), analytic)


def test_winding_torus_mixed_repaired():
    h = MeshHandler()
    vertices, faces, analytic = _torus()
    mask = np.random.default_rng(1).random(len(faces)) < 0.5
    mixed = _flip(faces, mask)
    data, meta = h.serialize({"vertices": vertices, "faces": mixed})
    assert meta["winding_normalized"] == int(mask.sum())
    back = _load(data)
    _assert_all_ccw_analytic(vertices, back["faces"].astype(np.int64), analytic)
    np.testing.assert_array_equal(back["faces"], faces.astype(np.uint32))


def test_winding_open_surface_mixed_repaired():
    # Open surface (a UV hemisphere without a bottom cap): exercises the
    # boundary-edge/majority-vote path rather than signed volume.
    n_lat, n_lon = 6, 12
    theta = np.pi / 2 * np.arange(n_lat + 1)[:, None] / n_lat  # 0..pi/2
    phi = 2 * np.pi * np.arange(n_lon)[None, :] / n_lon
    vertices = np.stack(
        [
            (np.sin(theta) * np.cos(phi)).ravel(),
            (np.sin(theta) * np.sin(phi)).ravel(),
            np.broadcast_to(np.cos(theta), (n_lat + 1, n_lon)).ravel(),
        ],
        axis=-1,
    )
    faces = []
    for i in range(n_lat):
        for j in range(n_lon):
            a = i * n_lon + j
            b = i * n_lon + (j + 1) % n_lon
            c = (i + 1) * n_lon + j
            d = (i + 1) * n_lon + (j + 1) % n_lon
            faces.append((a, c, b))
            faces.append((b, c, d))
    faces = np.array(faces, dtype=np.int64)
    mask = np.random.default_rng(2).random(len(faces)) < 0.5
    mixed = _flip(faces, mask)

    h = MeshHandler()
    data, meta = h.serialize({"vertices": vertices, "faces": mixed})
    assert meta["winding_normalized"] == int(mask.sum())
    back = _load(data)
    faces_out = back["faces"].astype(np.int64)
    # Ground truth: outward = radial (unit hemisphere centered at origin).
    v0, v1, v2 = vertices[faces_out[:, 0]], vertices[faces_out[:, 1]], vertices[faces_out[:, 2]]
    normal = np.cross(v1 - v0, v2 - v0)
    dot = np.einsum("ij,ij->i", normal, (v0 + v1 + v2) / 3.0)
    # Pole-row faces are zero-area (dot == 0); every real face must be CCW.
    assert np.all(dot >= 0) and int(np.sum(dot > 0)) == len(faces) - n_lon


def test_winding_non_manifold_left_untouched():
    # Three faces sharing one edge (a "fin"): no consistent orientation
    # exists, so the faces must be stored byte-identical, with metadata
    # flagging the winding as unnormalized (the UI's double-sided default
    # covers rendering).
    vertices = np.array(
        [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]],
        dtype=np.float64,
    )
    faces = np.array([[0, 1, 2], [1, 0, 3], [0, 1, 4]], dtype=np.int64)
    h = MeshHandler()
    data, meta = h.serialize({"vertices": vertices, "faces": faces})
    assert meta["winding"] == "unnormalized"
    assert "winding_normalized" not in meta
    back = _load(data)
    np.testing.assert_array_equal(back["faces"], faces.astype(np.uint32))
