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
        # List/tuple of images (numpy HxWxC, PIL Image, or torch 3D tensor)
        if isinstance(obj, (list, tuple)) and len(obj) > 0:
            first = obj[0]
            if isinstance(first, PILImage.Image):
                return True
            if isinstance(first, np.ndarray) and first.ndim == 3:
                return True
            if torch is not None and isinstance(first, torch.Tensor) and first.ndim == 3:
                return True
        return False

    @staticmethod
    def _to_frames(obj: Any) -> np.ndarray:
        """Convert various input formats to a TxHxWxC uint8 numpy array."""
        torch = try_import("torch")

        # Already a 4D array
        if torch is not None and isinstance(obj, torch.Tensor) and obj.ndim == 4:
            return obj.detach().cpu().numpy()
        if isinstance(obj, np.ndarray) and obj.ndim == 4:
            return obj

        # List/tuple of frames
        if isinstance(obj, (list, tuple)):
            frames: list[np.ndarray] = []
            for item in obj:
                if isinstance(item, PILImage.Image):
                    frames.append(np.array(item))
                elif isinstance(item, np.ndarray) and item.ndim == 3:
                    frames.append(item)
                elif torch is not None and isinstance(item, torch.Tensor):
                    frames.append(item.detach().cpu().numpy())
                else:
                    raise TypeError(
                        f"Cannot convert {type(item).__name__} to video frame; "
                        "expected PIL Image, numpy HxWxC, or torch tensor"
                    )
            return np.stack(frames)

        return np.asarray(obj)

    def serialize(
        self, obj: Any, fps: int = 30, **kwargs: Any
    ) -> tuple[bytes, dict[str, Any]]:
        imageio = try_import("imageio")
        if imageio is None:
            raise ImportError(
                "video tracking requires `cairn-track[media]` (imageio + imageio-ffmpeg)"
            )
        arr = self._to_frames(obj)
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
