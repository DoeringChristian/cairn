"""Image handler — PIL / numpy / torch → PNG."""

from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np
from PIL import Image as PILImage

from ..wrappers import _TypeWrapper
from ._optional import try_import


class ImageHandler:
    object_type = "image"
    mime_type = "image/png"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        if isinstance(obj, PILImage.Image):
            return True
        if isinstance(obj, np.ndarray):
            return obj.ndim in (2, 3)
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            return obj.ndim in (2, 3)
        return False

    @staticmethod
    def _to_pil(obj: Any) -> PILImage.Image:
        if isinstance(obj, PILImage.Image):
            return obj
        # Rasterize matplotlib / plotly figures when forced via cairn.Image(...).
        mpl = try_import("matplotlib")
        if mpl is not None:
            from matplotlib.figure import Figure as MplFigure

            if isinstance(obj, MplFigure):
                import io as _io

                buf = _io.BytesIO()
                obj.savefig(buf, format="png", bbox_inches="tight")
                buf.seek(0)
                return PILImage.open(buf).convert("RGB")
        plotly = try_import("plotly")
        if plotly is not None:
            import plotly.graph_objects as go

            if isinstance(obj, go.Figure):
                import io as _io

                png_bytes = obj.to_image(format="png")
                return PILImage.open(_io.BytesIO(png_bytes)).convert("RGB")
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            arr = obj.detach().cpu().numpy()
        elif isinstance(obj, np.ndarray):
            arr = obj
        else:
            raise TypeError(f"Cannot coerce {type(obj)!r} to an image")

        # Accept CHW (torch convention) and convert to HWC.
        if arr.ndim == 3 and arr.shape[0] in (1, 3, 4) and arr.shape[-1] not in (1, 3, 4):
            arr = np.transpose(arr, (1, 2, 0))

        if arr.dtype != np.uint8:
            a_min = float(arr.min())
            a_max = float(arr.max())
            if a_max <= 1.0 and a_min >= 0.0:
                arr = (arr * 255.0).clip(0, 255).astype(np.uint8)
            else:
                # generic min-max normalize
                rng = a_max - a_min if a_max > a_min else 1.0
                arr = ((arr - a_min) / rng * 255.0).clip(0, 255).astype(np.uint8)

        if arr.ndim == 2:
            return PILImage.fromarray(arr, mode="L")
        if arr.shape[-1] == 1:
            return PILImage.fromarray(arr[..., 0], mode="L")
        if arr.shape[-1] == 3:
            return PILImage.fromarray(arr, mode="RGB")
        if arr.shape[-1] == 4:
            return PILImage.fromarray(arr, mode="RGBA")
        raise ValueError(f"Unsupported image shape {arr.shape}")

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        img = self._to_pil(obj)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()

        # 128-px thumbnail preview as data URI.
        thumb = img.copy()
        thumb.thumbnail((128, 128))
        tbuf = io.BytesIO()
        thumb.save(tbuf, format="PNG")
        preview = (
            "data:image/png;base64,"
            + base64.b64encode(tbuf.getvalue()).decode("ascii")
        )

        meta = {
            "width": img.width,
            "height": img.height,
            "channels": len(img.getbands()),
            "mode": img.mode,
            "preview": preview,
        }
        return data, meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> Any:
        """Decode the PNG bytes back into a PIL Image."""
        return PILImage.open(io.BytesIO(data))
