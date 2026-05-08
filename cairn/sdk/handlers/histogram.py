"""Histogram handler — 1D numpy array → .npz with bins + counts.

Spec says Parquet; we store as ``.npz`` because numpy is already required and
``pyarrow`` would be a heavy dependency. The artifact ``mime_type`` is
``application/octet-stream`` and the metadata records ``{num_bins, min, max,
count}`` so the UI has everything it needs without loading the blob.
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper
from ._optional import try_import


class HistogramHandler:
    object_type = "histogram"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        # Only explicit via wrapper — 1D arrays often mean "time series", so
        # don't auto-dispatch here unless clearly a histogram intent.
        return False

    def serialize(
        self, obj: Any, bins: int = 64, **kwargs: Any
    ) -> tuple[bytes, dict[str, Any]]:
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            arr = obj.detach().cpu().numpy()
        else:
            arr = np.asarray(obj)
        flat = arr.reshape(-1).astype(np.float64)
        counts, edges = np.histogram(flat, bins=bins)
        buf = io.BytesIO()
        np.savez_compressed(buf, counts=counts, edges=edges)
        data = buf.getvalue()
        meta = {
            "num_bins": int(len(counts)),
            "min": float(flat.min()) if flat.size else 0.0,
            "max": float(flat.max()) if flat.size else 0.0,
            "count": int(flat.size),
            "mean": float(flat.mean()) if flat.size else 0.0,
        }
        return data, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Load .npz bytes into ``(counts, edges)`` numpy arrays."""
        loaded = np.load(io.BytesIO(data))
        return loaded["counts"], loaded["edges"]
