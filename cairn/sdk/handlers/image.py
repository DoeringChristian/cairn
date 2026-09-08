"""Image handler — PIL/u8 → PNG; float/int arrays → OpenEXR (half PIZ by default), npy or PNG on request.

Storage options travel with the value (``cairn.Image(arr, format=...)`` or the
``run.track(..., format=...)`` keywords) and are read by both ``mime_type_for``
and ``serialize`` so the recorded mime type always matches the bytes:

* ``format`` — ``"exr"`` (default for non-u8 arrays), ``"npy"`` (exact bytes,
  any channel count) or ``"png"`` (tone-mapped 8-bit). PIL images, figures and
  uint8 arrays are display values and stay PNG; asking for another format
  raises. A defaulted EXR falls back to npy when the channel count is not
  1, 3 or 4 (``hdr.fallback_reason == "channel-layout"``).
* ``precision`` — ``"auto"`` (half unless values exceed the half range),
  ``"half"`` or ``"float"``; ``format="exr"`` only.
* ``compression`` — ``"piz"`` (default), ``"zip"``, ``"zips"``, ``"none"``, or
  the lossy ``"dwaa"``/``"dwab"``; ``format="exr"`` only.

Non-u8 arrays record an ``hdr`` metadata block describing what was written
(container, precision, compression, source dtype, shape, clamped,
fallback_reason, plus the ``tonemap`` window for PNG).

Optionally carries **overlay annotations** (bounding boxes + segmentation
masks) supplied via ``cairn.Image(img, boxes=..., masks=..., class_labels=...)``.
Overlays live entirely in the artifact *metadata* (never a second blob — one
artifact per point is a hard ingest constraint):

* ``boxes`` — a list of ``{"position": {minX, minY, maxX, maxY}, "domain":
  "pixel"|"fraction", "class_id": int, "label": str|None, "score":
  float|None}`` (capped at 500).
* ``masks`` — ``{name: {"png_b64", "class_labels"}}`` where each mask is a
  grayscale (class-id-per-pixel) PNG, base64-encoded, capped at 2MB.
* ``class_labels`` — ``{int: str}`` shared class-id → name map.
"""

from __future__ import annotations

import base64
import io
from typing import Any

import numpy as np
from PIL import Image as PILImage

from ..wrappers import _TypeWrapper
from ._optional import try_import
from .image_encoding import EXR_MAGIC, decode_exr, encode_exr, image_encoding_for

MAX_BOXES = 500
MAX_MASK_B64_BYTES = 2 * 1024 * 1024


def _normalize_class_labels(class_labels: Any) -> dict[str, str] | None:
    """Coerce a ``{int: str}`` map into JSON-safe ``{str: str}``."""
    if class_labels is None:
        return None
    if not isinstance(class_labels, dict):
        raise TypeError("class_labels must be a dict of {int: str}")
    out: dict[str, str] = {}
    for k, v in class_labels.items():
        out[str(int(k))] = str(v)
    return out


def _build_boxes(boxes: Any) -> list[dict[str, Any]]:
    """Validate + normalize a list of box annotations."""
    if not isinstance(boxes, (list, tuple)):
        raise TypeError("boxes must be a list of box dicts")
    if len(boxes) > MAX_BOXES:
        raise ValueError(
            f"too many boxes ({len(boxes)}); max is {MAX_BOXES}. "
            "Filter before logging."
        )
    out: list[dict[str, Any]] = []
    for i, box in enumerate(boxes):
        if not isinstance(box, dict):
            raise TypeError(f"box[{i}] must be a dict, got {type(box).__name__}")
        pos = box.get("position")
        if not isinstance(pos, dict):
            raise ValueError(f"box[{i}] missing 'position' dict")
        try:
            norm_pos = {
                "minX": float(pos["minX"]),
                "minY": float(pos["minY"]),
                "maxX": float(pos["maxX"]),
                "maxY": float(pos["maxY"]),
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                f"box[{i}] position needs numeric minX/minY/maxX/maxY"
            ) from exc
        domain = box.get("domain", "fraction")
        if domain not in ("pixel", "fraction"):
            raise ValueError(
                f"box[{i}] domain must be 'pixel' or 'fraction', got {domain!r}"
            )
        entry: dict[str, Any] = {
            "position": norm_pos,
            "domain": domain,
            "class_id": int(box.get("class_id", 0)),
        }
        label = box.get("label")
        entry["label"] = None if label is None else str(label)
        score = box.get("score")
        entry["score"] = None if score is None else float(score)
        out.append(entry)
    return out


def _build_masks(
    masks: Any, class_labels: dict[str, str] | None
) -> dict[str, dict[str, Any]]:
    """PNG-encode + base64 each mask array; enforce the 2MB cap."""
    if not isinstance(masks, dict):
        raise TypeError("masks must be a dict of {name: 2D ndarray of class ids}")
    torch = try_import("torch")
    out: dict[str, dict[str, Any]] = {}
    for name, arr in masks.items():
        if torch is not None and isinstance(arr, torch.Tensor):
            arr = arr.detach().cpu().numpy()
        arr = np.asarray(arr)
        if arr.ndim != 2:
            raise ValueError(
                f"mask {name!r} must be a 2D array of class ids, got shape {arr.shape}"
            )
        if arr.size and (arr.min() < 0 or arr.max() > 255):
            raise ValueError(
                f"mask {name!r} class ids must be in [0, 255] (uint8 palette)"
            )
        arr_u8 = arr.astype(np.uint8)
        buf = io.BytesIO()
        # Grayscale, palette-free: pixel value == class id.
        PILImage.fromarray(arr_u8, mode="L").save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        if len(b64) > MAX_MASK_B64_BYTES:
            raise ValueError(
                f"mask {name!r} is too large ({len(b64)} base64 bytes); "
                f"max is {MAX_MASK_B64_BYTES}. Downsample the mask before logging."
            )
        entry: dict[str, Any] = {"png_b64": b64}
        if class_labels is not None:
            entry["class_labels"] = class_labels
        out[str(name)] = entry
    return out


class ImageHandler:
    object_type = "image"
    mime_type = "image/png"
    exr_mime_type = "image/x-exr"
    npy_mime_type = "application/x-npy"

    _OPTION_KEYS = ("format", "precision", "compression")
    _MIME_BY_CONTAINER = {
        "png": mime_type,
        "exr": exr_mime_type,
        "npy": npy_mime_type,
    }

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
    def _array_for_storage(obj: Any) -> np.ndarray | None:
        """Return image arrays in HWC layout without changing their values."""
        torch = try_import("torch")
        if torch is not None and isinstance(obj, torch.Tensor):
            arr = obj.detach().cpu().numpy()
        elif isinstance(obj, np.ndarray):
            arr = obj
        else:
            return None
        if arr.ndim == 3 and arr.shape[0] in (1, 3, 4) and arr.shape[-1] not in (1, 3, 4):
            arr = np.transpose(arr, (1, 2, 0))
        return np.ascontiguousarray(arr)

    @classmethod
    def _encoding_options(cls, kwargs: dict[str, Any]) -> dict[str, Any]:
        """The storage keywords `image_encoding_for` understands, if supplied."""
        return {k: kwargs[k] for k in cls._OPTION_KEYS if k in kwargs}

    @staticmethod
    def _reject_png_channels(arr: np.ndarray | None) -> None:
        """Refuse channel counts PNG cannot hold — as the artifact it must keep them all."""
        if arr is not None and arr.ndim == 3 and arr.shape[-1] not in (1, 3, 4):
            raise ValueError(f"PNG cannot store {arr.shape[-1]} channels; use format='npy'")

    def mime_type_for(self, obj: Any, **kwargs: Any) -> str:
        """Announce the container `serialize` will write for these same options."""
        arr = self._array_for_storage(obj)
        enc = image_encoding_for(arr, **self._encoding_options(kwargs))
        if enc.container == "png":
            self._reject_png_channels(arr)
        return self._MIME_BY_CONTAINER[enc.container]

    @staticmethod
    def _tonemap_window(arr: np.ndarray) -> tuple[float, float]:
        """The value window the preview tone-map stretches onto [0, 255]."""
        finite = arr[np.isfinite(arr)]
        a_min = float(finite.min()) if finite.size else 0.0
        a_max = float(finite.max()) if finite.size else 1.0
        if a_max <= 1.0 and a_min >= 0.0:
            return 0.0, 1.0
        return (a_min, a_max) if a_max > a_min else (a_min, a_min + 1.0)

    @classmethod
    def _tonemap_range(cls, arr: np.ndarray) -> dict[str, float]:
        """`_tonemap_window` as metadata, so preview and `hdr` cannot drift."""
        lo, hi = cls._tonemap_window(arr)
        return {"min": lo, "max": hi}

    @classmethod
    def _to_pil(cls, obj: Any, *, preview_only: bool = False) -> PILImage.Image:
        """Render `obj` as a PIL image; `preview_only` when the PNG is not the artifact."""
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
        arr = cls._array_for_storage(obj)
        if arr is None:
            raise TypeError(f"Cannot coerce {type(obj)!r} to an image")

        if arr.dtype != np.uint8:
            # Preview only: the artifact keeps the original scene-linear values.
            lo, hi = cls._tonemap_window(arr)
            # A constant array too large for `lo + 1.0` to move (>= 2**53) leaves a
            # zero-width window; render it flat rather than dividing by zero.
            rng = (hi - lo) or 1.0
            safe = np.nan_to_num(arr, nan=lo, posinf=hi, neginf=lo)
            arr = ((safe - lo) / rng * 255.0).clip(0, 255).astype(np.uint8)

        if arr.ndim == 2:
            return PILImage.fromarray(arr, mode="L")
        if arr.ndim != 3 or arr.shape[-1] < 1:
            raise ValueError(f"Unsupported image shape {arr.shape}")
        if arr.shape[-1] == 3:
            return PILImage.fromarray(arr, mode="RGB")
        if arr.shape[-1] == 4:
            return PILImage.fromarray(arr, mode="RGBA")
        if arr.shape[-1] != 1 and not preview_only:
            # The PNG *is* the artifact here, so dropping channels would lose data.
            cls._reject_png_channels(arr)
        # 1 channel, or a preview of a count no image format displays (the artifact is
        # npy): show band 0 rather than guess a colour meaning for the rest.
        return PILImage.fromarray(np.ascontiguousarray(arr[..., 0]), mode="L")

    def serialize(
        self,
        obj: Any,
        boxes: Any = None,
        masks: Any = None,
        class_labels: Any = None,
        format: str | None = None,
        precision: str = "auto",
        compression: str = "piz",
        **kwargs: Any,
    ) -> tuple[bytes, dict[str, Any]]:
        arr = self._array_for_storage(obj)
        enc = image_encoding_for(arr, format=format, precision=precision, compression=compression)
        if enc.container == "png":
            self._reject_png_channels(arr)
        img = self._to_pil(obj, preview_only=enc.container != "png")
        if enc.container == "exr":
            # OpenEXR keeps scene-linear/HDR values for cairn-plot's float path.
            data = encode_exr(arr, enc)
        else:
            buf = io.BytesIO()
            if enc.container == "npy":
                np.save(buf, arr, allow_pickle=False)
            else:
                img.save(buf, format="PNG")
            data = buf.getvalue()

        # 128-px tone-mapped thumbnail preview remains browser-native.
        thumb = img.copy()
        thumb.thumbnail((128, 128))
        tbuf = io.BytesIO()
        thumb.save(tbuf, format="PNG")
        preview = (
            "data:image/png;base64,"
            + base64.b64encode(tbuf.getvalue()).decode("ascii")
        )

        # These describe the PREVIEW image; `hdr.shape` carries the stored array's shape.
        meta: dict[str, Any] = {
            "width": img.width,
            "height": img.height,
            "channels": len(img.getbands()),
            "mode": img.mode,
            "preview": preview,
        }

        if arr is not None and arr.dtype != np.uint8:
            meta["hdr"] = {
                "container": enc.container,
                "precision": enc.precision,
                "compression": enc.compression,
                "source_dtype": str(arr.dtype),
                "shape": list(arr.shape),
                "clamped": enc.clamped,
                "fallback_reason": enc.fallback_reason,
            }
            if enc.container == "png":
                meta["hdr"]["tonemap"] = self._tonemap_range(arr)

        # Optional overlay annotations — stored inline in metadata (the sidecar),
        # since one artifact per point is a hard ingest constraint.
        norm_labels = _normalize_class_labels(class_labels)
        if boxes is not None:
            meta["boxes"] = _build_boxes(boxes)
            if norm_labels is not None:
                meta["class_labels"] = norm_labels
        if masks is not None:
            meta["masks"] = _build_masks(masks, norm_labels)

        return data, meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> Any:
        """Decode preserved EXR or NPY pixels, or PNG bytes."""
        if data.startswith(EXR_MAGIC):
            arr = decode_exr(data)
            # EXR has no 1-channel-with-axis type: (H, W, 1) is written as the `Y`
            # channel and decodes to (H, W). `hdr.shape` restores the caller's layout.
            shape = ((metadata or {}).get("hdr") or {}).get("shape")
            if shape is not None and tuple(shape) == arr.shape + (1,):
                arr = arr.reshape(tuple(shape))
            return arr
        if data.startswith(b"\x93NUMPY"):
            return np.load(io.BytesIO(data), allow_pickle=False)
        return PILImage.open(io.BytesIO(data))
