"""Video handler — numpy TxHxWxC → MP4 via imageio-ffmpeg."""

from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np
from PIL import Image as PILImage

from ..wrappers import _TypeWrapper
from ._optional import try_import


class VideoHandler:
    object_type = "video"
    mime_type = "video/mp4"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        if try_import("imageio_ffmpeg") is None:
            return False
        if isinstance(obj, np.ndarray) and obj.ndim == 4:
            return True
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor) and obj.ndim == 4:
            return True
        return False

    def serialize(
        self, obj: Any, fps: int = 30, **kwargs: Any
    ) -> tuple[bytes, dict[str, Any]]:
        imageio = try_import("imageio")
        if imageio is None:
            raise ImportError(
                "video tracking requires `cairn-track[media]` (imageio + imageio-ffmpeg)"
            )
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            arr = obj.detach().cpu().numpy()
        else:
            arr = np.asarray(obj)
        if arr.dtype != np.uint8:
            arr = arr.clip(0, 255).astype(np.uint8)

        # imageio expects frames as a sequence; write to an in-memory buffer.
        # Use mpeg4 codec + libx264 via imageio-ffmpeg plugin.
        import tempfile
        from pathlib import Path

        # imageio's ffmpeg writer needs a real file path.
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            writer = imageio.get_writer(str(tmp_path), fps=fps, codec="libx264", quality=5)
            for frame in arr:
                writer.append_data(frame)
            writer.close()
            data = tmp_path.read_bytes()
        finally:
            tmp_path.unlink(missing_ok=True)

        # First-frame thumbnail as data URI.
        first = PILImage.fromarray(arr[0])
        first.thumbnail((128, 128))
        tbuf = io.BytesIO()
        first.save(tbuf, format="PNG")
        preview = (
            "data:image/png;base64,"
            + base64.b64encode(tbuf.getvalue()).decode("ascii")
        )

        meta = {
            "fps": fps,
            "num_frames": int(arr.shape[0]),
            "width": int(arr.shape[2]),
            "height": int(arr.shape[1]),
            "channels": int(arr.shape[3]),
            "preview": preview,
        }
        return data, meta
