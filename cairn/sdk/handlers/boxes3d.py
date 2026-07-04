"""Boxes3D handler — box hierarchies (octrees/BVHs) → .npz blob.

Octrees and BVHs share a single object type: both are just axis-aligned
boxes with a depth level and an optional per-box scalar value, and the
renderer treats them identically. ``cairn.Boxes3D``/``cairn.Octree``/
``cairn.BVH`` all serialize here; ``kind`` (``"boxes"``/``"octree"``/
``"bvh"``) is metadata-only, set by the wrapper used at log time.

npz arrays: ``mins`` f4 (N,3), ``maxs`` f4 (N,3), ``depth`` u2 (N,), optional
``values_<name>`` f4 (N,) — named per-box scalar properties. A bare
``values=`` array is canonicalized to a single ``values_value`` property; a
``values={"name": arr, ...}`` dict logs one array per name (see
``handlers/_properties.py``). Every box must satisfy ``mins <= maxs``
elementwise. Box sets larger than ``MAX_BOXES`` raise (no silent truncation —
matches Tensor's ``MAX_BYTES`` behavior). Metadata records ``n_boxes``,
``max_depth``, ``kind``, overall ``bounds``, an optional ``properties``
list (``{name, min, max, mean}`` per property) plus ``value_range`` mirroring
the first property for backward compat, and ``size_bytes`` so the UI can
render a header without loading the blob.
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

        # `values` (via the dict payload or the `values=` kwarg) may be a
        # single array (canonicalized to {"value": arr}) or a dict[str,
        # array] of named per-box properties (spec-3dx-superseded §B).
        properties = normalize_properties(raw_values, n_boxes, "boxes3d")
        property_arrays = properties_arrays(properties)

        arrays: dict[str, np.ndarray] = {"mins": mins, "maxs": maxs, "depth": depth}
        arrays.update(property_arrays)
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
        for arr in property_arrays.values():
            size_bytes += int(arr.nbytes)

        meta: dict[str, Any] = {
            "n_boxes": n_boxes,
            "max_depth": max_depth,
            "kind": kind,
            "bounds": bounds,
            "size_bytes": size_bytes,
        }
        properties_meta = properties_metadata(properties)
        value_range = value_range_from(properties_meta)
        if value_range is not None:
            meta["value_range"] = value_range
        if properties_meta is not None:
            meta["properties"] = properties_meta
        return data, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None
    ) -> dict[str, "np.ndarray"]:
        """Load .npz bytes back into ``{mins, maxs, depth, values_<name>?, values?}``.

        ``values`` (bare) is surfaced for OLD artifacts logged before named
        properties existed; new artifacts carry ``values_<name>`` instead.
        """
        loaded = np.load(io.BytesIO(data))
        out = {"mins": loaded["mins"], "maxs": loaded["maxs"], "depth": loaded["depth"]}
        for key in loaded.files:
            if key == "values" or key.startswith("values_"):
                out[key] = loaded[key]
        return out
