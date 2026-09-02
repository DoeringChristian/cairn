"""Image handler — PIL/u8 → PNG; wider numpy/torch arrays → NPY.

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
    hdr_mime_type = "application/x-npy"

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

    def mime_type_for(self, obj: Any) -> str:
        """Preserve non-u8 arrays as NPY so cairn-plot receives HDR values."""
        arr = self._array_for_storage(obj)
        return self.hdr_mime_type if arr is not None and arr.dtype != np.uint8 else self.mime_type

    @classmethod
    def _to_pil(cls, obj: Any) -> PILImage.Image:
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
            finite = arr[np.isfinite(arr)]
            a_min = float(finite.min()) if finite.size else 0.0
            a_max = float(finite.max()) if finite.size else 1.0
            safe = np.nan_to_num(arr, nan=a_min, posinf=a_max, neginf=a_min)
            if a_max <= 1.0 and a_min >= 0.0:
                arr = (safe * 255.0).clip(0, 255).astype(np.uint8)
            else:
                # Preview only: the artifact keeps the original scene-linear values.
                rng = a_max - a_min if a_max > a_min else 1.0
                arr = ((safe - a_min) / rng * 255.0).clip(0, 255).astype(np.uint8)

        if arr.ndim == 2:
            return PILImage.fromarray(arr, mode="L")
        if arr.shape[-1] == 1:
            return PILImage.fromarray(arr[..., 0], mode="L")
        if arr.shape[-1] == 3:
            return PILImage.fromarray(arr, mode="RGB")
        if arr.shape[-1] == 4:
            return PILImage.fromarray(arr, mode="RGBA")
        raise ValueError(f"Unsupported image shape {arr.shape}")

    def serialize(
        self,
        obj: Any,
        boxes: Any = None,
        masks: Any = None,
        class_labels: Any = None,
        **kwargs: Any,
    ) -> tuple[bytes, dict[str, Any]]:
        arr = self._array_for_storage(obj)
        img = self._to_pil(obj)
        buf = io.BytesIO()
        if arr is not None and arr.dtype != np.uint8:
            # NPY preserves scene-linear/HDR values for cairn-plot's float path.
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

        meta: dict[str, Any] = {
            "width": img.width,
            "height": img.height,
            "channels": len(img.getbands()),
            "mode": img.mode,
            "preview": preview,
        }

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
        """Decode either preserved NPY pixels or legacy PNG bytes."""
        if data.startswith(b"\x93NUMPY"):
            return np.load(io.BytesIO(data), allow_pickle=False)
        return PILImage.open(io.BytesIO(data))
