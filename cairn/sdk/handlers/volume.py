"""Volume handler — dense ``(D, H, W)`` scalar grid → float32 .npz blob.

Rendered by the UI as a WebGL2 raymarched volume (MIP / isosurface). Stats
(``vmin``/``vmax``/``mean``) and physical placement (``spacing``/``origin``/
``bounds``) are computed at log time so the UI never needs to load the blob
to render a header or fit a camera.

``bounds`` is the physical axis-aligned box the grid occupies: ``min ==
origin`` and ``max == origin + shape * spacing`` (elementwise, in ``[D, H,
W]`` axis order — same order as ``shape``/``spacing``/``origin`` themselves).
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper
from ._optional import try_import

# Pre-compression size cap (as float32), like the spec's other 3D handlers.
# ``np.savez_compressed`` shrinks the actual blob further; metadata always
# records the true (pre-compression) size so the cap is meaningful even
# though the on-disk artifact is usually smaller.
MAX_BYTES = 128 * 1024 * 1024


class VolumeHandler:
    object_type = "volume"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        # Only via explicit cairn.Volume(...) wrapper — a raw 3D ndarray is
        # ambiguous (could be a small image stack, a batch of 2D arrays, etc).
        return False

    def serialize(
        self,
        obj: Any,
        spacing: Any = None,
        origin: Any = None,
        **kwargs: Any,
    ) -> tuple[bytes, dict[str, Any]]:
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            arr = obj.detach().cpu().numpy()
        else:
            arr = np.asarray(obj)

        if arr.ndim != 3:
            raise ValueError(
                f"volume must be a (D, H, W) array; got shape {tuple(arr.shape)}"
            )

        dtype_str = str(arr.dtype)
        arr32 = np.ascontiguousarray(arr, dtype=np.float32)
        nbytes = int(arr32.nbytes)
        if nbytes > MAX_BYTES:
            raise ValueError(
                f"volume is too large ({nbytes} bytes pre-compression); "
                f"max is {MAX_BYTES}"
            )

        d, h, w = (int(x) for x in arr32.shape)

        sp = [1.0, 1.0, 1.0] if spacing is None else [float(x) for x in spacing]
        og = [0.0, 0.0, 0.0] if origin is None else [float(x) for x in origin]
        if len(sp) != 3:
            raise ValueError(f"spacing must have 3 elements; got {len(sp)}")
        if len(og) != 3:
            raise ValueError(f"origin must have 3 elements; got {len(og)}")

        shape = [d, h, w]
        bounds = {
            "min": og,
            "max": [og[i] + shape[i] * sp[i] for i in range(3)],
        }

        buf = io.BytesIO()
        np.savez_compressed(buf, data=arr32)
        data = buf.getvalue()

        vmin = float(arr32.min()) if arr32.size else 0.0
        vmax = float(arr32.max()) if arr32.size else 0.0
        mean = float(arr32.mean()) if arr32.size else 0.0

        meta = {
            "shape": shape,
            "dtype": dtype_str,
            "vmin": vmin,
            "vmax": vmax,
            "mean": mean,
            "spacing": sp,
            "origin": og,
            "bounds": bounds,
            "size_bytes": nbytes,
            # Volume has a single implicit scalar field (unlike mesh/
            # pointcloud/boxes3d, which support a named-properties dict) —
            # this metadata shape still lets the UI's shared property
            # selector/Colorbar code treat it uniformly with the other three
            # 3D types (spec-3dx-superseded §B: "at least keep consistent
            # metadata" for volume).
            "properties": [{"name": "value", "min": vmin, "max": vmax, "mean": mean}],
        }
        return data, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None
    ) -> "np.ndarray":
        """Load the ``.npz`` bytes back into the ``(D, H, W)`` float32 array."""
        loaded = np.load(io.BytesIO(data))
        return loaded["data"]
