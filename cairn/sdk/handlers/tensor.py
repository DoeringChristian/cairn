"""Tensor handler — numpy/torch arrays ≤ 10MB → .npy blob."""

from __future__ import annotations

import io
from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper
from ._optional import try_import

MAX_BYTES = 10 * 1024 * 1024


class TensorHandler:
    object_type = "tensor"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        # Only via explicit wrapper; a raw ndarray is ambiguous.
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            arr = obj.detach().cpu().numpy()
        else:
            arr = np.asarray(obj)
        if arr.nbytes > MAX_BYTES:
            raise ValueError(
                f"tensor is too large ({arr.nbytes} bytes); max is {MAX_BYTES}"
            )
        buf = io.BytesIO()
        np.save(buf, arr, allow_pickle=False)
        data = buf.getvalue()
        meta = {
            "shape": list(arr.shape),
            "dtype": str(arr.dtype),
            "min": float(arr.min()) if arr.size else 0.0,
            "max": float(arr.max()) if arr.size else 0.0,
            "mean": float(arr.mean()) if arr.size else 0.0,
            "size_bytes": int(arr.nbytes),
        }
        return data, meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> "np.ndarray":
        """Load .npy bytes back into a numpy array."""
        return np.load(io.BytesIO(data), allow_pickle=False)
