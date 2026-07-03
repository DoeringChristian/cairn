"""Mesh handler — indexed triangle mesh → compressed .npz blob.

Dispatches only via the ``cairn.Mesh`` wrapper (the input is a
``{vertices, faces, values, colors, normals}`` dict — ``can_handle`` is
always False, matching the other wrapper-only handlers).

npz arrays:

- ``positions`` f4 ``(N, 3)`` — vertex positions.
- ``faces`` u4 ``(M, 3)`` — triangle vertex indices (must be ``< N``).
- ``values`` f4 ``(N,)`` — optional per-vertex scalar (colored via a colormap
  in the UI).
- ``colors`` f4 ``(N, 3)`` — optional per-vertex RGB; accepts either ``0-255``
  or ``0-1`` and auto-normalizes to ``0-1`` (same convention as
  ``PointCloud``'s ``xyzrgb``).
- ``normals`` f4 ``(N, 3)`` — optional per-vertex normals; the UI computes
  smooth-shading normals itself when absent.

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

MAX_BYTES = 64 * 1024 * 1024  # 64MB, pre-compression total array bytes


def _to_numpy(obj: Any) -> "np.ndarray | None":
    if obj is None:
        return None
    torch = try_import("torch")
    if torch is not None and isinstance(obj, torch.Tensor):
        return obj.detach().cpu().numpy()
    return np.asarray(obj)


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
        values = _to_numpy(obj.get("values"))
        colors = _to_numpy(obj.get("colors"))
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

        if values is not None and (values.ndim != 1 or values.shape[0] != n_vertices):
            raise ValueError(
                f"mesh values must be a length-{n_vertices} 1D array; got "
                f"{tuple(values.shape)}"
            )
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

        positions = np.ascontiguousarray(vertices, dtype=np.float32)
        faces_u4 = np.ascontiguousarray(faces_i, dtype=np.uint32)

        arrays: dict[str, np.ndarray] = {"positions": positions, "faces": faces_u4}
        total_bytes = positions.nbytes + faces_u4.nbytes

        value_range: dict[str, float] | None = None
        if values is not None:
            values_f4 = np.ascontiguousarray(values, dtype=np.float32)
            arrays["values"] = values_f4
            total_bytes += values_f4.nbytes
            if values_f4.size:
                value_range = {
                    "min": float(values_f4.min()),
                    "max": float(values_f4.max()),
                    "mean": float(values_f4.mean()),
                }

        has_colors = colors is not None
        if has_colors:
            colors_f4 = np.ascontiguousarray(colors, dtype=np.float32)
            if colors_f4.size and float(colors_f4.max()) > 1.0:
                colors_f4 = colors_f4 / 255.0
            colors_f4 = np.clip(colors_f4, 0.0, 1.0)
            arrays["colors"] = colors_f4
            total_bytes += colors_f4.nbytes

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
            "has_normals": has_normals,
            "size_bytes": int(total_bytes),
        }
        if value_range is not None:
            meta["value_range"] = value_range
        return data, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None
    ) -> dict[str, "np.ndarray"]:
        """Load .npz bytes back into a ``{positions, faces, ...}`` dict."""
        loaded = np.load(io.BytesIO(data))
        return {k: loaded[k] for k in loaded.files}
