"""Point-cloud handler — (N,3|4|6) array → float32 blob.

Channel layouts (inferred from column count):

- ``(N, 3)`` → ``xyz``
- ``(N, 4)`` → ``xyzc`` (xyz + integer category id)
- ``(N, 6)`` → ``xyzrgb`` (xyz + rgb; auto-normalized to 0-1)

Clouds with more than ``MAX_POINTS`` rows are uniformly downsampled (seeded)
at log time. Metadata records ``n_points`` (after downsample), ``channels``,
per-axis ``bounds`` (xyz), and the ``original_count``, so the UI can render a
header and fit the camera without loading the blob.

Optional named per-point properties (spec-3dx-superseded §B, in ADDITION to
the channel layouts above) via ``values=`` — a single array (canonicalized to
one ``"value"`` property) or a ``dict[str, array]`` of named per-point
scalars, downsampled with the same index set as the cloud itself. When
present, the blob switches from a bare ``.npy`` array to an ``.npz`` archive
with a ``points`` member (the same ``(N, C)`` array as the plain-array
format) plus one ``values_<name>`` member per property, and metadata gains a
``properties: [{name, min, max, mean}]`` list (``value_range`` mirrors the
first property for backward compat). With no ``values=``, the blob is
byte-for-byte the same plain ``.npy`` format as before this feature existed.
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

MAX_POINTS = 300_000
_DOWNSAMPLE_SEED = 0

_CHANNELS = {3: "xyz", 4: "xyzc", 6: "xyzrgb"}


class PointCloudHandler:
    object_type = "pointcloud"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        # Only via explicit wrapper; a raw (N, C) ndarray is ambiguous.
        return False

    def serialize(
        self, obj: Any, values: Any = None, **kwargs: Any
    ) -> tuple[bytes, dict[str, Any]]:
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            arr = obj.detach().cpu().numpy()
        else:
            arr = np.asarray(obj)

        if arr.ndim != 2 or arr.shape[1] not in _CHANNELS:
            raise ValueError(
                "point cloud must be an (N, 3), (N, 4) or (N, 6) array; "
                f"got shape {tuple(arr.shape)}"
            )

        channels = _CHANNELS[arr.shape[1]]
        arr = arr.astype(np.float32, copy=True)
        original_count = int(arr.shape[0])

        # Named per-point properties, validated against the PRE-downsample
        # count (they must line up with the caller's original rows).
        properties = normalize_properties(values, original_count, "pointcloud")

        # Downsample large clouds uniformly (seeded, without replacement) —
        # any properties are carried through the same index set so they stay
        # aligned with the (possibly reduced) point rows.
        if original_count > MAX_POINTS:
            rng = np.random.default_rng(_DOWNSAMPLE_SEED)
            idx = rng.choice(original_count, size=MAX_POINTS, replace=False)
            idx.sort()
            arr = arr[idx]
            if properties is not None:
                properties = {name: v[idx] for name, v in properties.items()}

        # Normalize rgb to 0-1 (auto-detect 0-255 vs 0-1).
        if channels == "xyzrgb":
            rgb = arr[:, 3:6]
            if rgb.size and float(rgb.max()) > 1.0:
                rgb = rgb / 255.0
            arr[:, 3:6] = np.clip(rgb, 0.0, 1.0)

        n_points = int(arr.shape[0])
        xyz = arr[:, :3]
        if xyz.size:
            bounds = {
                "min": [float(v) for v in xyz.min(axis=0)],
                "max": [float(v) for v in xyz.max(axis=0)],
            }
        else:
            bounds = {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}

        points_f4 = np.ascontiguousarray(arr, dtype=np.float32)
        property_arrays = properties_arrays(properties)

        buf = io.BytesIO()
        if property_arrays:
            # Only switch to the .npz container when properties are actually
            # present — the common (no-properties) case stays byte-for-byte
            # the plain .npy format from before this feature existed.
            np.savez_compressed(buf, points=points_f4, **property_arrays)
        else:
            np.save(buf, points_f4, allow_pickle=False)
        data = buf.getvalue()

        meta: dict[str, Any] = {
            "n_points": n_points,
            "channels": channels,
            "bounds": bounds,
            "original_count": original_count,
            "downsampled": bool(original_count > MAX_POINTS),
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
    ) -> "np.ndarray | dict[str, np.ndarray]":
        """Load the point-cloud blob back into an array (or a dict when the
        artifact carries named properties).

        Format is content-sniffed: a ``.npz`` archive (named-property
        artifacts) starts with the ZIP magic ``PK``; otherwise it's the plain
        ``.npy`` array (every artifact logged without ``values=``, including
        all pre-named-properties artifacts).
        """
        if data[:2] == b"PK":
            loaded = np.load(io.BytesIO(data))
            out: dict[str, np.ndarray] = {"points": loaded["points"]}
            for key in loaded.files:
                if key.startswith("values_"):
                    out[key] = loaded[key]
            return out
        return np.load(io.BytesIO(data), allow_pickle=False)
