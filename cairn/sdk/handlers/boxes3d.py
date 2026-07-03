"""Boxes3D handler — box hierarchies (octrees/BVHs) → .npz blob.

Octrees and BVHs share a single object type: both are just axis-aligned
boxes with a depth level and an optional per-box scalar value, and the
renderer treats them identically. ``cairn.Boxes3D``/``cairn.Octree``/
``cairn.BVH`` all serialize here; ``kind`` (``"boxes"``/``"octree"``/
``"bvh"``) is metadata-only, set by the wrapper used at log time.

npz arrays: ``mins`` f4 (N,3), ``maxs`` f4 (N,3), ``depth`` u2 (N,), optional
``values`` f4 (N,). Every box must satisfy ``mins <= maxs`` elementwise.
Box sets larger than ``MAX_BOXES`` raise (no silent truncation — matches
Tensor's ``MAX_BYTES`` behavior). Metadata records ``n_boxes``, ``max_depth``,
``kind``, overall ``bounds``, an optional ``value_range``, and ``size_bytes``
so the UI can render a header without loading the blob.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper
from ._optional import try_import

MAX_BOXES = 200_000


def _to_numpy(obj: Any) -> np.ndarray | None:
    if obj is None:
        return None
    torch = try_import("torch")
    if torch is not None and isinstance(obj, torch.Tensor):
        return obj.detach().cpu().numpy()
    return np.asarray(obj)


class Boxes3DHandler:
    object_type = "boxes3d"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        # Only via explicit wrapper (cairn.Boxes3D/Octree/BVH) — a bag of
        # arrays has no unambiguous auto-detection.
        return False

    def serialize(
        self, obj: Any, kind: str = "boxes", **kwargs: Any
    ) -> tuple[bytes, dict[str, Any]]:
        raw_mins = obj["mins"] if isinstance(obj, dict) else obj
        raw_maxs = obj["maxs"] if isinstance(obj, dict) else kwargs.get("maxs")
        raw_depth = obj.get("depth") if isinstance(obj, dict) else kwargs.get("depth")
        raw_values = obj.get("values") if isinstance(obj, dict) else kwargs.get("values")

        mins_arr = _to_numpy(raw_mins)
        maxs_arr = _to_numpy(raw_maxs)
        if mins_arr is None or maxs_arr is None:
            raise ValueError("boxes3d requires both 'mins' and 'maxs' arrays")

        mins = np.asarray(mins_arr, dtype=np.float32)
        maxs = np.asarray(maxs_arr, dtype=np.float32)
        if mins.ndim != 2 or mins.shape[1] != 3:
            raise ValueError(
                f"mins must be an (N, 3) array; got shape {tuple(mins.shape)}"
            )
        if maxs.shape != mins.shape:
            raise ValueError(
                "maxs must have the same shape as mins "
                f"({tuple(mins.shape)}); got {tuple(maxs.shape)}"
            )

        n_boxes = int(mins.shape[0])
        if n_boxes > MAX_BOXES:
            raise ValueError(f"too many boxes ({n_boxes}); max is {MAX_BOXES}")
        if n_boxes and bool(np.any(mins > maxs)):
            raise ValueError("every box must satisfy mins <= maxs elementwise")

        depth_arr = _to_numpy(raw_depth)
        if depth_arr is None:
            depth = np.zeros(n_boxes, dtype=np.uint16)
        else:
            depth = np.asarray(depth_arr).reshape(-1).astype(np.uint16)
            if depth.shape[0] != n_boxes:
                raise ValueError(
                    f"depth must have length {n_boxes} (one per box); "
                    f"got {depth.shape[0]}"
                )

        values_arr = _to_numpy(raw_values)
        has_values = values_arr is not None
        values = None
        if has_values:
            values = np.asarray(values_arr).reshape(-1).astype(np.float32)
            if values.shape[0] != n_boxes:
                raise ValueError(
                    f"values must have length {n_boxes} (one per box); "
                    f"got {values.shape[0]}"
                )

        arrays: dict[str, np.ndarray] = {"mins": mins, "maxs": maxs, "depth": depth}
        if has_values:
            arrays["values"] = values
        buf = io.BytesIO()
        np.savez_compressed(buf, **arrays)
        data = buf.getvalue()

        if n_boxes:
            bounds = {
                "min": [float(v) for v in mins.min(axis=0)],
                "max": [float(v) for v in maxs.max(axis=0)],
            }
            max_depth = int(depth.max())
        else:
            bounds = {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
            max_depth = 0

        size_bytes = int(mins.nbytes + maxs.nbytes + depth.nbytes)
        if has_values and values is not None:
            size_bytes += int(values.nbytes)

        meta: dict[str, Any] = {
            "n_boxes": n_boxes,
            "max_depth": max_depth,
            "kind": kind,
            "bounds": bounds,
            "size_bytes": size_bytes,
        }
        if has_values and values is not None and n_boxes:
            meta["value_range"] = {
                "min": float(values.min()),
                "max": float(values.max()),
                "mean": float(values.mean()),
            }
        return data, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None
    ) -> dict[str, "np.ndarray"]:
        """Load .npz bytes back into ``{mins, maxs, depth, values?}`` arrays."""
        loaded = np.load(io.BytesIO(data))
        out = {"mins": loaded["mins"], "maxs": loaded["maxs"], "depth": loaded["depth"]}
        if "values" in loaded.files:
            out["values"] = loaded["values"]
        return out
