"""Mesh handler — indexed triangle mesh → compressed .npz blob.

Dispatches only via the ``cairn.Mesh`` wrapper (the input is a
``{vertices, faces, values, colors, normals}`` dict — ``can_handle`` is
always False, matching the other wrapper-only handlers).

npz arrays:

- ``positions`` f4 ``(N, 3)`` — vertex positions.
- ``faces`` u4 ``(M, 3)`` — triangle vertex indices (must be ``< N``).
- ``values_<name>`` f4 ``(N,)`` — optional named per-vertex scalar
  properties (colored via a colormap + a Property selector in the UI). A
  bare ``values=`` array is canonicalized to a single ``values_value``
  property (see ``handlers/_properties.py``); a ``values={"name": arr, ...}``
  dict logs one array per name. Metadata's ``properties`` list carries
  ``{name, min, max, mean}`` per property; ``value_range`` mirrors the first
  property for backward compat.
- ``colors`` f4 ``(N, 3)`` — optional per-vertex RGB; accepts either ``0-255``
  or ``0-1`` and auto-normalizes to ``0-1`` (same convention as
  ``PointCloud``'s ``xyzrgb``).
- ``face_colors`` f4 ``(M, 3)`` or ``(M, 4)`` — optional per-FACE (per-triangle)
  RGB(A); one color per face, ``M == n_faces``. Accepts ``0-255`` or ``0-1``
  and auto-normalizes to ``0-1``. When present the UI expands the indexed mesh
  to a non-indexed geometry (3 unique verts per face sharing the face color)
  so each triangle renders one flat color. Precedence at render time is
  ``face_colors`` > ``colors`` (per-vertex) > uniform solid. ``meta`` records
  ``has_face_colors`` and ``face_color_channels`` (3 or 4).
- ``normals`` f4 ``(N, 3)`` — optional per-vertex normals; the UI computes
  smooth-shading normals itself when absent (after winding normalization —
  see below — so it never inherits a bad face orientation).

Faces are re-wound to be consistently CCW-from-outside at log time via a
topology-aware pass (``_normalize_winding``): orientation is propagated
across shared edges within each connected component (repairing MIXED
winding exactly, with no shape assumption), then each component's global
orientation is fixed by signed volume when the component is closed (exact
for any closed manifold — torus included) or by a centroid-direction
majority vote when it is open (documented approximation). Non-manifold
meshes (any edge shared by >2 faces) are left completely untouched and
flagged ``winding: "unnormalized"`` in metadata — the UI's double-sided
default covers rendering for those. Otherwise metadata records how many
faces were flipped as ``winding_normalized``. Any supplied ``normals`` are
per-vertex data never modified by this — winding only reorders each face's
own index triple.

Meshes whose total array size (pre-compression) exceeds ``MAX_BYTES`` are
rejected at log time with a ``ValueError`` (no silent truncation/degradation
— truncating a mesh would produce a different, wrong shape, unlike
PointCloud's uniform downsample). Metadata records the true ``size_bytes`` so
the UI header never needs to fetch the blob.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper
from ._optional import try_import
from ._properties import (
    normalize_properties,
    properties_arrays,
    properties_metadata,
    value_range_from,
)

MAX_BYTES = 64 * 1024 * 1024  # 64MB, pre-compression total array bytes


def _to_numpy(obj: Any) -> "np.ndarray | None":
    if obj is None:
        return None
    torch = try_import("torch")
    if torch is not None and isinstance(obj, torch.Tensor):
        return obj.detach().cpu().numpy()
    return np.asarray(obj)


def _normalize_winding(
    vertices: np.ndarray, faces: np.ndarray
) -> tuple[np.ndarray, int, bool]:
    """Re-orient triangle faces to consistent CCW-from-outside winding.

    Returns ``(faces, n_flipped, normalized)``. ``faces`` is either the input
    array untouched or a flipped copy; ``normalized`` is False only for
    non-manifold input (see below), in which case the faces are guaranteed
    byte-identical to the input.

    Algorithm (topology-aware — makes no shape assumption for the winding
    repair itself):

    1. Build edge adjacency over the faces (vectorized numpy). If any
       undirected edge is shared by more than 2 faces the mesh is
       NON-MANIFOLD: there is no well-defined "consistent orientation", so
       the winding is left completely untouched (never guess on user data)
       and the caller flags it in metadata; the UI's double-sided rendering
       default keeps such meshes displayable.
    2. Per connected component, propagate a consistent orientation across
       shared edges (DFS; a shared edge must be traversed in opposite
       directions by its two faces — a face is flipped relative to its
       neighbor when that is violated). This repairs MIXED winding exactly,
       for any manifold shape (a global flip alone could not). A
       non-orientable component (e.g. a Möbius strip) has no consistent
       orientation at all and is left untouched.
    3. Fix each component's global orientation (consistent could still mean
       "consistently inward"):
       - closed component (every edge shared by exactly 2 faces): by signed
         volume (sum of per-face tetrahedron determinants) — exact for any
         closed manifold, torus/concave shapes included;
       - open component: by majority vote of the per-face
         centroid-direction sign (face normal vs mesh-centroid→face-centroid
         vector). This is a documented approximation — exact when most of
         the surface faces away from the mesh centroid (spheres with open
         poles, cube faces, height fields), potentially wrong for open
         surfaces that mostly face the centroid; residuals are covered by
         the UI's double-sided default.

    Adjacency construction is vectorized; the orientation propagation is a
    Python loop that visits each face once and each shared edge twice —
    O(faces + edges), acceptable at the 64MB cap scale.
    """
    n_faces = len(faces)
    if n_faces == 0:
        return faces, 0, True

    verts = np.asarray(vertices, dtype=np.float64)

    # The 3 directed edges of every face, in winding order.
    edges = np.empty((3 * n_faces, 2), dtype=np.int64)
    edges[0::3] = faces[:, [0, 1]]
    edges[1::3] = faces[:, [1, 2]]
    edges[2::3] = faces[:, [2, 0]]
    edge_face = np.arange(3 * n_faces) // 3

    lo = edges.min(axis=1)
    hi = edges.max(axis=1)
    # Degenerate edges (repeated vertex index within a face) carry no
    # orientation information — exclude them from adjacency.
    valid = np.flatnonzero(lo != hi)
    key = lo[valid] * np.int64(len(verts)) + hi[valid]

    order = np.argsort(key, kind="stable")
    idx = valid[order]  # directed-edge indices, grouped by undirected edge
    counts = np.unique(key[order], return_counts=True)[1]
    if counts.size and counts.max() > 2:
        return faces, 0, False  # non-manifold: leave winding untouched

    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])

    # Interior edges (count == 2): adjacency pairs + relative orientation.
    pair_start = starts[counts == 2]
    i1, i2 = idx[pair_start], idx[pair_start + 1]
    f1, f2 = edge_face[i1], edge_face[i2]
    # Both faces traversing the shared edge in the same direction means
    # their orientations are inconsistent (one must flip relative to the
    # other); opposite directions means consistent.
    inconsistent = (edges[i1, 0] < edges[i1, 1]) == (edges[i2, 0] < edges[i2, 1])

    # Boundary edges (count == 1) mark their component as open.
    boundary_face = np.zeros(n_faces, dtype=bool)
    boundary_face[edge_face[idx[starts[counts == 1]]]] = True

    # CSR-style adjacency over faces (both directions of every pair).
    src = np.concatenate([f1, f2])
    dst = np.concatenate([f2, f1])
    rel = np.concatenate([inconsistent, inconsistent])
    order = np.argsort(src, kind="stable")
    src, dst, rel = src[order], dst[order], rel[order]
    offsets = np.searchsorted(src, np.arange(n_faces + 1))

    v0, v1, v2 = verts[faces[:, 0]], verts[faces[:, 1]], verts[faces[:, 2]]
    # 6x signed tetra volume per face (origin apex); the sum over a closed
    # surface is orientation-signed enclosed volume (translation-invariant).
    base_det = np.einsum("ij,ij->i", v0, np.cross(v1, v2))
    # Centroid-direction sign per face, for the open-surface majority vote.
    face_normal = np.cross(v1 - v0, v2 - v0)
    face_centroid = (v0 + v1 + v2) / 3.0
    base_dot = np.einsum("ij,ij->i", face_normal, face_centroid - verts.mean(axis=0))

    flip = np.zeros(n_faces, dtype=bool)
    visited = np.zeros(n_faces, dtype=bool)
    for seed in range(n_faces):
        if visited[seed]:
            continue
        visited[seed] = True
        comp = [seed]
        stack = [seed]
        orientable = True
        while stack:
            f = stack.pop()
            f_flip = flip[f]
            for i in range(offsets[f], offsets[f + 1]):
                g = dst[i]
                want = f_flip ^ rel[i]
                if not visited[g]:
                    visited[g] = True
                    flip[g] = want
                    comp.append(g)
                    stack.append(g)
                elif flip[g] != want:
                    orientable = False
        comp_arr = np.asarray(comp)
        if not orientable:
            flip[comp_arr] = False  # e.g. Möbius strip: no consistent winding
            continue
        sign = np.where(flip[comp_arr], -1.0, 1.0)
        if boundary_face[comp_arr].any():
            score = float(np.sign(base_dot[comp_arr] * sign).sum())
        else:
            score = float((base_det[comp_arr] * sign).sum())
        if score < 0:
            flip[comp_arr] = ~flip[comp_arr]

    n_flipped = int(np.count_nonzero(flip))
    if n_flipped:
        faces = faces.copy()
        faces[flip] = faces[flip][:, [0, 2, 1]]
    return faces, n_flipped, True


class MeshHandler:
    object_type = "mesh"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        # Only via the explicit cairn.Mesh wrapper.
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        if not isinstance(obj, dict):
            raise TypeError(
                "Mesh handler expects a cairn.Mesh wrapper; got "
                f"{type(obj).__name__}"
            )

        vertices = _to_numpy(obj.get("vertices"))
        faces = _to_numpy(obj.get("faces"))
        raw_values = obj.get("values")
        colors = _to_numpy(obj.get("colors"))
        face_colors = _to_numpy(obj.get("face_colors"))
        normals = _to_numpy(obj.get("normals"))

        if vertices is None or vertices.ndim != 2 or vertices.shape[1] != 3:
            raise ValueError(
                "mesh vertices must be an (N, 3) array; got "
                f"{None if vertices is None else tuple(vertices.shape)}"
            )
        if faces is None or faces.ndim != 2 or faces.shape[1] != 3:
            raise ValueError(
                "mesh faces must be an (M, 3) array; got "
                f"{None if faces is None else tuple(faces.shape)}"
            )

        n_vertices = int(vertices.shape[0])
        n_faces = int(faces.shape[0])

        faces_i = faces.astype(np.int64, copy=False)
        if n_faces and (int(faces_i.min()) < 0 or int(faces_i.max()) >= n_vertices):
            raise ValueError(
                f"face indices must be in [0, {n_vertices}); got range "
                f"[{int(faces_i.min())}, {int(faces_i.max())}]"
            )

        # `values` may be a single array (canonicalized to {"value": arr}) or
        # a dict[str, array] of named per-vertex properties (spec-3dx-superseded
        # §B) — validated against n_vertices by the shared helper.
        properties = normalize_properties(raw_values, n_vertices, "mesh")
        if colors is not None and (colors.ndim != 2 or tuple(colors.shape) != (n_vertices, 3)):
            raise ValueError(
                f"mesh colors must be an ({n_vertices}, 3) array; got "
                f"{tuple(colors.shape)}"
            )
        if normals is not None and (normals.ndim != 2 or tuple(normals.shape) != (n_vertices, 3)):
            raise ValueError(
                f"mesh normals must be an ({n_vertices}, 3) array; got "
                f"{tuple(normals.shape)}"
            )
        # Per-face (per-triangle) colors: exactly one RGB(A) per face.
        if face_colors is not None and (
            face_colors.ndim != 2
            or face_colors.shape[0] != n_faces
            or face_colors.shape[1] not in (3, 4)
        ):
            raise ValueError(
                f"mesh face_colors must be an ({n_faces}, 3) or ({n_faces}, 4) "
                f"array (one color per face); got "
                f"{None if face_colors is None else tuple(face_colors.shape)}"
            )

        # Winding normalization: the UI (and computeVertexNormals when no
        # normals are supplied) assumes CCW-from-outside faces. We don't
        # trust callers to get this right, and a mesh can even be
        # MIXED-wound (e.g. after boolean ops or naive concatenation of
        # sub-meshes), which no single global flip can repair. See
        # _normalize_winding for the topology-aware algorithm and its
        # non-manifold/open-surface behavior.
        faces_i, n_flipped, winding_ok = _normalize_winding(vertices, faces_i)

        positions = np.ascontiguousarray(vertices, dtype=np.float32)
        faces_u4 = np.ascontiguousarray(faces_i, dtype=np.uint32)

        arrays: dict[str, np.ndarray] = {"positions": positions, "faces": faces_u4}
        total_bytes = positions.nbytes + faces_u4.nbytes

        property_arrays = properties_arrays(properties)
        arrays.update(property_arrays)
        for arr in property_arrays.values():
            total_bytes += arr.nbytes
        properties_meta = properties_metadata(properties)
        value_range = value_range_from(properties_meta)

        has_colors = colors is not None
        if has_colors:
            colors_f4 = np.ascontiguousarray(colors, dtype=np.float32)
            if colors_f4.size and float(colors_f4.max()) > 1.0:
                colors_f4 = colors_f4 / 255.0
            colors_f4 = np.clip(colors_f4, 0.0, 1.0)
            arrays["colors"] = colors_f4
            total_bytes += colors_f4.nbytes

        # Per-face colors survive winding normalization untouched: _normalize_
        # winding only reorders each face's own index triple, never the row
        # order of `faces`, so `face_colors[i]` still describes face `i`.
        has_face_colors = face_colors is not None
        face_color_channels = 0
        if has_face_colors:
            face_colors_f4 = np.ascontiguousarray(face_colors, dtype=np.float32)
            if face_colors_f4.size and float(face_colors_f4.max()) > 1.0:
                face_colors_f4 = face_colors_f4 / 255.0
            face_colors_f4 = np.clip(face_colors_f4, 0.0, 1.0)
            arrays["face_colors"] = face_colors_f4
            total_bytes += face_colors_f4.nbytes
            face_color_channels = int(face_colors_f4.shape[1])

        has_normals = normals is not None
        if has_normals:
            normals_f4 = np.ascontiguousarray(normals, dtype=np.float32)
            arrays["normals"] = normals_f4
            total_bytes += normals_f4.nbytes

        if total_bytes > MAX_BYTES:
            raise ValueError(
                f"mesh is too large ({total_bytes} bytes); max is {MAX_BYTES}"
            )

        if n_vertices:
            bounds = {
                "min": [float(v) for v in positions.min(axis=0)],
                "max": [float(v) for v in positions.max(axis=0)],
            }
        else:
            bounds = {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}

        buf = io.BytesIO()
        np.savez_compressed(buf, **arrays)
        data = buf.getvalue()

        meta: dict[str, Any] = {
            "n_vertices": n_vertices,
            "n_faces": n_faces,
            "bounds": bounds,
            "has_colors": has_colors,
            "has_face_colors": has_face_colors,
            "has_normals": has_normals,
            "size_bytes": int(total_bytes),
        }
        if has_face_colors:
            meta["face_color_channels"] = face_color_channels
        if winding_ok:
            meta["winding_normalized"] = n_flipped
        else:
            # Non-manifold input: winding untouched (see _normalize_winding).
            meta["winding"] = "unnormalized"
        if value_range is not None:
            meta["value_range"] = value_range
        if properties_meta is not None:
            meta["properties"] = properties_meta
        return data, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None
    ) -> dict[str, "np.ndarray"]:
        """Load .npz bytes back into a ``{positions, faces, ...}`` dict."""
        loaded = np.load(io.BytesIO(data))
        return {k: loaded[k] for k in loaded.files}
