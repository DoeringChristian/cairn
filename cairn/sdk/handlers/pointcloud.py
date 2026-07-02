"""Point-cloud handler — (N,3|4|6) array → float32 .npy blob.

Channel layouts (inferred from column count):

- ``(N, 3)`` → ``xyz``
- ``(N, 4)`` → ``xyzc`` (xyz + integer category id)
- ``(N, 6)`` → ``xyzrgb`` (xyz + rgb; auto-normalized to 0-1)

Clouds with more than ``MAX_POINTS`` rows are uniformly downsampled (seeded)
at log time. Metadata records ``n_points`` (after downsample), ``channels``,
per-axis ``bounds`` (xyz), and the ``original_count``, so the UI can render a
header and fit the camera without loading the blob.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper
from ._optional import try_import

MAX_POINTS = 300_000
_DOWNSAMPLE_SEED = 0

_CHANNELS = {3: "xyz", 4: "xyzc", 6: "xyzrgb"}


class PointCloudHandler:
    object_type = "pointcloud"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        # Only via explicit wrapper; a raw (N, C) ndarray is ambiguous.
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
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

        # Downsample large clouds uniformly (seeded, without replacement).
        if original_count > MAX_POINTS:
            rng = np.random.default_rng(_DOWNSAMPLE_SEED)
            idx = rng.choice(original_count, size=MAX_POINTS, replace=False)
            idx.sort()
            arr = arr[idx]

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

        buf = io.BytesIO()
        np.save(buf, np.ascontiguousarray(arr, dtype=np.float32), allow_pickle=False)
        data = buf.getvalue()

        meta = {
            "n_points": n_points,
            "channels": channels,
            "bounds": bounds,
            "original_count": original_count,
            "downsampled": bool(original_count > MAX_POINTS),
        }
        return data, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None
    ) -> "np.ndarray":
        """Load .npy bytes back into the ``(N, C)`` float32 array."""
        return np.load(io.BytesIO(data), allow_pickle=False)
