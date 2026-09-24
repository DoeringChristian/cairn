"""Video handler — frames → MP4 via imageio-ffmpeg, or an existing video file as-is.

Frames: a ``T×H×W×C`` array/tensor (``T×C×H×W``, the torch layout, is
transposed), ``T×H×W`` grayscale, or a list of HWC/CHW frames / PIL images.
Values map like images (float [0, 1], uint8 [0, 255]). A path (``str`` or
``Path``) to an existing video file is stored byte-for-byte.
"""

from __future__ import annotations

import base64
import io
import mimetypes
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image as PILImage

from ..wrappers import _TypeWrapper
from ._optional import try_import
from .image_encoding import to_display_uint8


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
    def _hwc(frame: np.ndarray) -> np.ndarray:
        """One frame to HWC: CHW (channels first, 1/3/4) is transposed; HW gains an axis."""
        if frame.ndim == 2:
            return frame[..., None]
        if frame.shape[0] in (1, 3, 4) and frame.shape[-1] not in (1, 3, 4):
            return np.transpose(frame, (1, 2, 0))
        return frame

    @classmethod
    def _to_frames(cls, obj: Any) -> np.ndarray:
        """Any supported input → a T×H×W×3 array (values not yet mapped)."""
        arr = cls._raw_frames(obj)
        if arr.ndim == 3:  # T×H×W grayscale
            arr = arr[..., None]
        if arr.ndim != 4:
            raise ValueError(f"video frames must be T×H×W(×C), got shape {arr.shape}")
        if arr.shape[1] in (1, 3, 4) and arr.shape[-1] not in (1, 3, 4):
            arr = np.transpose(arr, (0, 2, 3, 1))  # T×C×H×W → T×H×W×C
        channels = arr.shape[-1]
        if channels == 1:
            arr = np.repeat(arr, 3, axis=-1)
        elif channels == 4:
            arr = arr[..., :3]  # H.264 carries no alpha
        elif channels != 3:
            raise ValueError(f"video frames need 1, 3 or 4 channels, got {channels}")
        return arr

    @classmethod
    def _raw_frames(cls, obj: Any) -> np.ndarray:
        """Stack the input into one array, frames in HWC where they arrive one by one."""
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
                    frames.append(cls._hwc(np.array(item.convert("RGB"))))
                elif isinstance(item, np.ndarray) and item.ndim in (2, 3):
                    frames.append(cls._hwc(item))
                elif torch is not None and isinstance(item, torch.Tensor):
                    frames.append(cls._hwc(item.detach().cpu().numpy()))
                else:
                    raise TypeError(
                        f"Cannot convert {type(item).__name__} to video frame; "
                        "expected PIL Image, numpy HxWxC, or torch tensor"
                    )
            return np.stack(frames)

        return np.asarray(obj)

    def serialize(
        self, obj: Any, fps: int = 30, linear: bool = False, **kwargs: Any
    ) -> tuple[bytes, dict[str, Any]]:
        if isinstance(obj, (str, Path)):
            return self._serialize_file(Path(obj))
        imageio = try_import("imageio")
        if imageio is None:
            raise ImportError(
                "video tracking requires `cairn-track[media]` (imageio + imageio-ffmpeg)"
            )
        # Same value rules as images: float [0, 1], uint8 [0, 255].
        arr = to_display_uint8(self._to_frames(obj), linear=linear)

        # imageio expects frames as a sequence; write to an in-memory buffer.
        # Use mpeg4 codec + libx264 via imageio-ffmpeg plugin.
        import tempfile

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

    def mime_type_for(self, obj: Any, **kwargs: Any) -> str:
        if isinstance(obj, (str, Path)):
            return mimetypes.guess_type(str(obj))[0] or "application/octet-stream"
        return self.mime_type

    def _serialize_file(self, path: Path) -> tuple[bytes, dict[str, Any]]:
        """Store an existing video file unchanged; describe it when imageio can read it."""
        if not path.is_file():
            raise FileNotFoundError(f"video file not found: {path}")
        meta: dict[str, Any] = {"filename": path.name}
        imageio = try_import("imageio")
        if imageio is not None:
            try:
                reader = imageio.get_reader(str(path))
                info = reader.get_meta_data()
                first = np.asarray(reader.get_data(0))
                reader.close()
                thumb = PILImage.fromarray(first[..., :3] if first.ndim == 3 else first)
                thumb.thumbnail((128, 128))
                tbuf = io.BytesIO()
                thumb.save(tbuf, format="PNG")
                meta.update({
                    "fps": info.get("fps"),
                    "width": int(first.shape[1]),
                    "height": int(first.shape[0]),
                    "preview": "data:image/png;base64," + base64.b64encode(tbuf.getvalue()).decode("ascii"),
                })
                if info.get("duration") and info.get("fps"):
                    meta["num_frames"] = int(round(info["duration"] * info["fps"]))
            except Exception:  # noqa: BLE001 - an unreadable file is still stored
                pass
        return path.read_bytes(), meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> "np.ndarray":
        """Decode MP4 bytes back into a (T, H, W, C) uint8 numpy array."""
        imageio = try_import("imageio")
        if imageio is None:
            raise ImportError(
                "Reading video artifacts requires `cairn-track[media]` (imageio + imageio-ffmpeg)"
            )
        import tempfile
        suffix = Path((metadata or {}).get("filename") or "clip.mp4").suffix or ".mp4"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp_path = Path(tmp.name)
        try:
            tmp_path.write_bytes(data)
            reader = imageio.get_reader(str(tmp_path))
            frames = [np.asarray(f) for f in reader]
            reader.close()
        finally:
            tmp_path.unlink(missing_ok=True)
        return np.stack(frames) if frames else np.zeros((0, 0, 0, 3), dtype=np.uint8)
