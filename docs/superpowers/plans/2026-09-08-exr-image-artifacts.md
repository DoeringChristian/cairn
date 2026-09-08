# EXR Image Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Non-uint8 images logged through the SDK are stored as OpenEXR (half PIZ by default), selectable per call with `format`/`precision`/`compression`, and the UI card maps the `image/x-exr` mime to cairn-plot's EXR decoder.

**Architecture:** A pure policy module (`image_encoding.py`) decides container/precision/channels from the array and options; `ImageHandler` applies it with the official `OpenEXR` binding; the mime hook receives the call options so `resolve_mime_type` agrees with `serialize`. WAL, blob store and artifact route are untouched (mime verbatim). The UI's mime→format mapping becomes a table in its own module.

**Tech Stack:** Python 3.10+, numpy, `openexr>=3.3` (official binding, numpy-native `OpenEXR.File`), pytest; TypeScript (`node --experimental-strip-types --test`) for the UI unit test.

**Spec:** `docs/superpowers/specs/2026-09-08-exr-artifacts-decode-pool-design.md` (sections 3, 4, 6 cairn part, 7).

## Global Constraints

- Options: `format ∈ {"exr","npy","png"}` default EXR; `precision ∈ {"half","float","auto"}` default `"auto"`; `compression ∈ {"piz","zip","zips","none","dwaa","dwab"}` default `"piz"`. `precision`/`compression` with a non-EXR format → `ValueError`; unknown values → `ValueError`.
- PIL images, figures and `uint8` arrays are always PNG; an explicit `format="exr"` or `"npy"` on them → `ValueError`.
- Defaulted EXR on a channel count ∉ {1,3,4} → npy with `fallback_reason="channel-layout"`; explicit `format="exr"` on it → `ValueError`.
- `precision="auto"`: integer/bool dtype → `float`; float dtype with all finite `|v| <= 65504` → `half`, else `float`. `float64` is cast to `float32` first.
- Mime: png `image/png`, exr `image/x-exr`, npy `application/x-npy`.
- Metadata gains `hdr: {container, precision, compression, source_dtype, shape, clamped, fallback_reason}` for every non-PNG artifact (and `container:"png"` with `tonemap: {min,max}` when `format="png"` was applied to a float array).
- `deserialize` sniffs EXR magic `76 2f 31 01`, npy magic `93 4e 55 4d 50 59`, else PIL.
- No change to `wal.py`, `transport.py`, `ingest_ops.py`, `blobs.py`, `routes/artifacts.py`, `migrations.py`.
- `uv run pytest tests/unit tests/integration -q` passes; `cd cairn/ui && npm run test:unit && npm run build` passes; the pre-commit hook rebuilds `cairn/ui/dist`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_018R6F9Ys9R5Htmq6K7oL6gf`.
- Never `git add -A`; add named files only. Do not touch `vendor/cairn-plot` (the submodule bump is done by the controller after the cairn-plot plan merges).

---

### Task 1: Mime resolution receives the call options; `openexr` dependency

**Files:**
- Modify: `cairn/sdk/handlers/registry.py:22-27`
- Modify: `cairn/sdk/run.py:438`, `:498`, `:525`
- Modify: `pyproject.toml` (dependencies list, after `"numpy>=1.24",`)
- Test: `tests/unit/test_registry.py` (append)

**Interfaces:**
- Produces: `resolve_mime_type(handler, obj, kwargs: dict[str, Any] | None = None) -> str` calling `handler.mime_type_for(obj, **(kwargs or {}))` when the hook exists.

- [ ] **Step 1: Failing test**

```python
# append to tests/unit/test_registry.py
from cairn.sdk.handlers.registry import resolve_mime_type


class _OptionAware:
    object_type = "x"
    mime_type = "application/octet-stream"

    def can_handle(self, obj):
        return True

    def serialize(self, obj, **kwargs):
        return b"", {}

    def mime_type_for(self, obj, **kwargs):
        return "text/plain" if kwargs.get("format") == "txt" else self.mime_type


class _Plain:
    object_type = "y"
    mime_type = "application/y"

    def can_handle(self, obj):
        return True

    def serialize(self, obj, **kwargs):
        return b"", {}


def test_resolve_mime_type_passes_call_options_to_hook():
    assert resolve_mime_type(_OptionAware(), object(), {"format": "txt"}) == "text/plain"
    assert resolve_mime_type(_OptionAware(), object(), {}) == "application/octet-stream"
    assert resolve_mime_type(_OptionAware(), object()) == "application/octet-stream"


def test_resolve_mime_type_without_hook_ignores_options():
    assert resolve_mime_type(_Plain(), object(), {"format": "txt"}) == "application/y"
```

- [ ] **Step 2: Run** — `uv run pytest tests/unit/test_registry.py -q` → FAIL (`TypeError: resolve_mime_type() takes 2 positional arguments`).

- [ ] **Step 3: Implement**

```python
def resolve_mime_type(handler: TypeHandler, obj: Any, kwargs: dict[str, Any] | None = None) -> str:
    """Return a handler's MIME type, allowing content- and option-dependent formats."""
    resolver = getattr(handler, "mime_type_for", None)
    if callable(resolver):
        return str(resolver(obj, **(kwargs or {})))
    return handler.mime_type
```

`run.py`: line 438 → `resolve_mime_type(handler, payload, merged_kwargs)`; line 498 → pass the same merged kwargs dict that `serialize` received on line 497 (read the surrounding code: it is the kwargs variable used in `handler.serialize(payload, **...)` there); line 525 → the kwargs used by the `serialize` call directly above it. Every other handler's `mime_type_for` (grep `def mime_type_for` under `cairn/sdk/handlers/`) gains `**kwargs: Any` in its signature so the extra options never raise.

`pyproject.toml`: add `"openexr>=3.3",` after `"numpy>=1.24",`. Run `uv lock` and `uv sync`; commit `uv.lock`.

- [ ] **Step 4: Run** — `uv run pytest tests/unit -q` → PASS; `uv run python -c "import OpenEXR; print(OpenEXR.__version__)"` prints ≥ 3.3.

- [ ] **Step 5: Commit**

```bash
git add cairn/sdk/handlers/registry.py cairn/sdk/run.py tests/unit/test_registry.py pyproject.toml uv.lock $(git diff --name-only cairn/sdk/handlers)
git commit -m "Pass call options to mime resolution; add openexr dependency"
```

---

### Task 2: Encoding policy and EXR codec module

**Files:**
- Create: `cairn/sdk/handlers/image_encoding.py`
- Test: `tests/unit/test_image_encoding.py`

**Interfaces:**
- Produces:
  ```python
  FORMATS = ("exr", "npy", "png"); PRECISIONS = ("half", "float", "auto")
  COMPRESSIONS = {"piz": OpenEXR.PIZ_COMPRESSION, "zip": OpenEXR.ZIP_COMPRESSION, "zips": OpenEXR.ZIPS_COMPRESSION,
                  "none": OpenEXR.NO_COMPRESSION, "dwaa": OpenEXR.DWAA_COMPRESSION, "dwab": OpenEXR.DWAB_COMPRESSION}
  HALF_MAX = 65504.0
  @dataclass(frozen=True)
  class ImageEncoding:
      container: str; precision: str | None; channels: str | None; compression: str | None
      fallback_reason: str | None; clamped: bool
  def image_encoding_for(arr, *, format=None, precision="auto", compression="piz") -> ImageEncoding
  def encode_exr(arr: np.ndarray, enc: ImageEncoding) -> bytes
  def decode_exr(data: bytes) -> np.ndarray
  EXR_MAGIC = b"\x76\x2f\x31\x01"
  ```

- [ ] **Step 1: Failing tests**

```python
# tests/unit/test_image_encoding.py
import numpy as np
import pytest

from cairn.sdk.handlers.image_encoding import (
    EXR_MAGIC, ImageEncoding, decode_exr, encode_exr, image_encoding_for,
)


def rgb(dtype=np.float32, scale=1.0, h=4, w=5):
    return (np.random.default_rng(0).random((h, w, 3)) * scale).astype(dtype)


@pytest.mark.parametrize(
    "arr,kw,expect",
    [
        (rgb(), {}, ("exr", "half", "RGB", "piz", None)),
        (rgb(np.float64), {}, ("exr", "half", "RGB", "piz", None)),
        (rgb(scale=1e6), {}, ("exr", "float", "RGB", "piz", None)),
        (rgb(np.uint16), {}, ("exr", "float", "RGB", "piz", None)),
        (rgb(np.int32), {}, ("exr", "float", "RGB", "piz", None)),
        (rgb().astype(bool), {}, ("exr", "float", "RGB", "piz", None)),
        (rgb()[..., 0], {}, ("exr", "half", "Y", "piz", None)),
        (rgb()[..., :1], {}, ("exr", "half", "Y", "piz", None)),
        (np.concatenate([rgb(), rgb()[..., :1]], -1), {}, ("exr", "half", "RGBA", "piz", None)),
        (rgb()[..., :2], {}, ("npy", None, None, None, "channel-layout")),
        (rgb(), {"format": "npy"}, ("npy", None, None, None, None)),
        (rgb(), {"format": "png"}, ("png", None, None, None, None)),
        (rgb(), {"precision": "float"}, ("exr", "float", "RGB", "piz", None)),
        (rgb(), {"compression": "dwaa"}, ("exr", "half", "RGB", "dwaa", None)),
        (rgb(np.uint8), {}, ("png", None, None, None, None)),
        (None, {}, ("png", None, None, None, None)),
    ],
)
def test_policy_table(arr, kw, expect):
    enc = image_encoding_for(arr, **kw)
    assert (enc.container, enc.precision, enc.channels, enc.compression, enc.fallback_reason) == expect


def test_forced_half_marks_clamped():
    enc = image_encoding_for(rgb(scale=1e6), precision="half")
    assert enc.precision == "half" and enc.clamped is True
    assert image_encoding_for(rgb(), precision="half").clamped is False


def test_nan_and_inf_do_not_force_float():
    a = rgb(); a[0, 0, 0] = np.nan; a[0, 0, 1] = np.inf
    assert image_encoding_for(a).precision == "half"


@pytest.mark.parametrize(
    "arr,kw,match",
    [
        (rgb()[..., :2], {"format": "exr"}, "channel"),
        (rgb(np.uint8), {"format": "exr"}, "uint8|display"),
        (rgb(np.uint8), {"format": "npy"}, "uint8|display"),
        (None, {"format": "exr"}, "PIL|display"),
        (rgb(), {"format": "npy", "precision": "half"}, "precision"),
        (rgb(), {"format": "png", "compression": "zip"}, "compression"),
        (rgb(), {"format": "tiff"}, "format"),
        (rgb(), {"precision": "double"}, "precision"),
        (rgb(), {"compression": "lzw"}, "compression"),
    ],
)
def test_invalid_options_raise(arr, kw, match):
    with pytest.raises(ValueError, match=match):
        image_encoding_for(arr, **kw)


@pytest.mark.parametrize("compression", ["piz", "zip", "zips", "none"])
def test_exr_roundtrip_half_lossless_within_half_precision(compression):
    a = rgb(h=16, w=24)
    enc = image_encoding_for(a, compression=compression)
    data = encode_exr(a, enc)
    assert data.startswith(EXR_MAGIC)
    back = decode_exr(data)
    assert back.dtype == np.float16 and back.shape == a.shape
    np.testing.assert_allclose(back.astype(np.float32), a, rtol=2 ** -11, atol=0)


def test_exr_roundtrip_float_exact():
    a = (np.arange(16 * 24 * 3, dtype=np.uint16).reshape(16, 24, 3) * 3).astype(np.uint16)
    enc = image_encoding_for(a)
    back = decode_exr(encode_exr(a, enc))
    assert back.dtype == np.float32
    np.testing.assert_array_equal(back, a.astype(np.float32))


def test_exr_roundtrip_gray_and_rgba():
    g = rgb(h=8, w=8)[..., 0]
    assert decode_exr(encode_exr(g, image_encoding_for(g))).shape == (8, 8)
    r = np.concatenate([rgb(h=8, w=8), np.ones((8, 8, 1), np.float32)], -1)
    assert decode_exr(encode_exr(r, image_encoding_for(r))).shape == (8, 8, 4)


def test_exr_dwaa_is_lossy_but_close():
    a = rgb(h=32, w=32)
    back = decode_exr(encode_exr(a, image_encoding_for(a, compression="dwaa")))
    np.testing.assert_allclose(back.astype(np.float32), a, rtol=0.02, atol=0.02)
```

- [ ] **Step 2: Run** — `uv run pytest tests/unit/test_image_encoding.py -q` → FAIL (module not found).

- [ ] **Step 3: Implement**

```python
"""Image artifact encoding policy and the OpenEXR codec (spec §3.1–3.4).

Pure: decides container/precision/channels from the array and the call
options, and encodes/decodes OpenEXR through the official binding. The
handler (`image.py`) applies it; nothing here touches PIL or metadata.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from typing import Any

import numpy as np
import OpenEXR

FORMATS = ("exr", "npy", "png")
PRECISIONS = ("half", "float", "auto")
COMPRESSIONS: dict[str, Any] = {
    "piz": OpenEXR.PIZ_COMPRESSION,
    "zip": OpenEXR.ZIP_COMPRESSION,
    "zips": OpenEXR.ZIPS_COMPRESSION,
    "none": OpenEXR.NO_COMPRESSION,
    "dwaa": OpenEXR.DWAA_COMPRESSION,
    "dwab": OpenEXR.DWAB_COMPRESSION,
}
HALF_MAX = 65504.0
EXR_MAGIC = b"\x76\x2f\x31\x01"
_CHANNELS_BY_COUNT = {1: "Y", 3: "RGB", 4: "RGBA"}


@dataclass(frozen=True)
class ImageEncoding:
    container: str
    precision: str | None = None
    channels: str | None = None
    compression: str | None = None
    fallback_reason: str | None = None
    clamped: bool = False


def _channel_count(arr: np.ndarray) -> int:
    return 1 if arr.ndim == 2 else int(arr.shape[-1])


def _exceeds_half(arr: np.ndarray) -> bool:
    finite = arr[np.isfinite(arr)]
    return bool(finite.size) and float(np.abs(finite).max()) > HALF_MAX


def image_encoding_for(
    arr: np.ndarray | None,
    *,
    format: str | None = None,
    precision: str = "auto",
    compression: str = "piz",
) -> ImageEncoding:
    """Decide how an image array is stored. `format=None` means "not given"."""
    if format is not None and format not in FORMATS:
        raise ValueError(f"format must be one of {FORMATS}, got {format!r}")
    if precision not in PRECISIONS:
        raise ValueError(f"precision must be one of {PRECISIONS}, got {precision!r}")
    if compression not in COMPRESSIONS:
        raise ValueError(f"compression must be one of {tuple(COMPRESSIONS)}, got {compression!r}")
    explicit = format is not None
    fmt = format or "exr"
    if fmt != "exr" and (precision != "auto" or compression != "piz"):
        if precision != "auto":
            raise ValueError("precision applies to format='exr' only")
        raise ValueError("compression applies to format='exr' only")

    display_only = arr is None or arr.dtype == np.uint8
    if display_only:
        if explicit and fmt != "png":
            what = "PIL/figure images" if arr is None else "uint8 arrays"
            raise ValueError(f"{what} hold display values and are stored as PNG; format={fmt!r} is not allowed")
        return ImageEncoding(container="png")

    if fmt == "png":
        return ImageEncoding(container="png")
    if fmt == "npy":
        return ImageEncoding(container="npy")

    channels = _CHANNELS_BY_COUNT.get(_channel_count(arr))
    if channels is None:
        if explicit:
            raise ValueError(
                f"format='exr' needs 1, 3 or 4 channels, got {_channel_count(arr)}; use format='npy'"
            )
        return ImageEncoding(container="npy", fallback_reason="channel-layout")

    clamped = False
    if precision == "auto":
        if arr.dtype.kind in "iub":
            precision = "float"
        else:
            precision = "float" if _exceeds_half(arr.astype(np.float32, copy=False)) else "half"
    elif precision == "half" and arr.dtype.kind == "f":
        clamped = _exceeds_half(arr.astype(np.float32, copy=False))
    elif precision == "half":
        clamped = _exceeds_half(arr.astype(np.float32))
    return ImageEncoding(
        container="exr", precision=precision, channels=channels, compression=compression, clamped=clamped
    )


def encode_exr(arr: np.ndarray, enc: ImageEncoding) -> bytes:
    """Encode an HWC (or HW) array as a scanline OpenEXR with `enc`'s settings."""
    assert enc.container == "exr" and enc.channels and enc.precision and enc.compression
    pixels = arr.astype(np.float16 if enc.precision == "half" else np.float32)
    if pixels.ndim == 3 and pixels.shape[-1] == 1:
        pixels = pixels[..., 0]
    pixels = np.ascontiguousarray(pixels)
    header = {"compression": COMPRESSIONS[enc.compression], "type": OpenEXR.scanlineimage}
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "image.exr")
        OpenEXR.File(header, {enc.channels: pixels}).write(path)
        with open(path, "rb") as fh:
            return fh.read()


def decode_exr(data: bytes) -> np.ndarray:
    """Decode EXR bytes written by `encode_exr` back to HWC (Y → HW), dtype as stored."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "image.exr")
        with open(path, "wb") as fh:
            fh.write(data)
        channels = OpenEXR.File(path).channels()
    for name in ("RGBA", "RGB", "Y"):
        if name in channels:
            return np.asarray(channels[name].pixels)
    raise ValueError(f"unsupported EXR channel set {sorted(channels)}; expected Y, RGB or RGBA")
```

Note: the binding returns the `Y` channel as a 2-D array and RGB/RGBA as HWC (verified with OpenEXR 3.4.15); `float16` inputs are stored as HALF without conversion.

- [ ] **Step 4: Run** — `uv run pytest tests/unit/test_image_encoding.py -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cairn/sdk/handlers/image_encoding.py tests/unit/test_image_encoding.py
git commit -m "Add image encoding policy and OpenEXR codec"
```

---

### Task 3: `ImageHandler` writes EXR by default

**Files:**
- Modify: `cairn/sdk/handlers/image.py` (`mime_type_for`, `serialize`, `deserialize`, class constants, module docstring)
- Modify: `cairn/sdk/wrappers.py:27-47` (`Image` docstring)
- Test: `tests/unit/test_handler_image.py` (update `test_numpy_float_preserves_hdr_values`; add the tests below)

**Interfaces:**
- Consumes: `image_encoding_for`, `encode_exr`, `decode_exr`, `EXR_MAGIC` (Task 2); `resolve_mime_type(handler, obj, kwargs)` (Task 1).
- Produces: `ImageHandler.mime_type_for(obj, **kwargs)`; `serialize(obj, boxes=None, masks=None, class_labels=None, format=None, precision="auto", compression="piz", **kwargs)`.

- [ ] **Step 1: Tests**

Replace `test_numpy_float_preserves_hdr_values` with:

```python
def test_numpy_float_defaults_to_exr_half():
    handler = ImageHandler()
    arr = np.random.default_rng(1).random((6, 8, 3)).astype(np.float32) * 4
    assert handler.mime_type_for(arr) == "image/x-exr"
    data, meta = handler.serialize(arr)
    assert data.startswith(b"\x76\x2f\x31\x01")
    assert meta["hdr"] == {
        "container": "exr", "precision": "half", "compression": "piz",
        "source_dtype": "float32", "shape": [6, 8, 3], "clamped": False, "fallback_reason": None,
    }
    back = handler.deserialize(data)
    assert back.dtype == np.float16 and back.shape == (6, 8, 3)
    np.testing.assert_allclose(back.astype(np.float32), arr, rtol=2 ** -11)


def test_uint16_becomes_exr_float_exact():
    handler = ImageHandler()
    arr = (np.arange(6 * 8, dtype=np.uint16).reshape(6, 8) * 900).astype(np.uint16)
    data, meta = handler.serialize(arr)
    assert meta["hdr"]["precision"] == "float" and meta["hdr"]["source_dtype"] == "uint16"
    np.testing.assert_array_equal(handler.deserialize(data), arr.astype(np.float32))


def test_out_of_half_range_promotes_to_float():
    handler = ImageHandler()
    arr = np.full((4, 4, 3), 1e5, np.float32)
    _, meta = handler.serialize(arr)
    assert meta["hdr"]["precision"] == "float" and meta["hdr"]["clamped"] is False


def test_forced_half_records_clamped():
    handler = ImageHandler()
    arr = np.full((4, 4, 3), 1e5, np.float32)
    _, meta = handler.serialize(arr, precision="half")
    assert meta["hdr"]["precision"] == "half" and meta["hdr"]["clamped"] is True


def test_two_channel_float_falls_back_to_npy():
    handler = ImageHandler()
    arr = np.zeros((4, 4, 2), np.float32)
    assert handler.mime_type_for(arr) == "application/x-npy"
    data, meta = handler.serialize(arr)
    assert data.startswith(b"\x93NUMPY")
    assert meta["hdr"]["container"] == "npy" and meta["hdr"]["fallback_reason"] == "channel-layout"
    with pytest.raises(ValueError, match="channel"):
        handler.serialize(arr, format="exr")


def test_format_npy_and_png_are_honoured():
    handler = ImageHandler()
    arr = np.random.default_rng(2).random((4, 4, 3)).astype(np.float32)
    assert handler.mime_type_for(arr, format="npy") == "application/x-npy"
    data, meta = handler.serialize(arr, format="npy")
    assert data.startswith(b"\x93NUMPY") and meta["hdr"]["container"] == "npy"
    assert handler.mime_type_for(arr, format="png") == "image/png"
    data, meta = handler.serialize(arr, format="png")
    assert data.startswith(b"\x89PNG") and meta["hdr"]["container"] == "png"
    assert set(meta["hdr"]["tonemap"]) == {"min", "max"}


def test_uint8_rejects_hdr_formats_and_stays_png():
    handler = ImageHandler()
    arr = np.zeros((4, 4, 3), np.uint8)
    assert handler.mime_type_for(arr) == "image/png"
    with pytest.raises(ValueError):
        handler.serialize(arr, format="exr")
    data, meta = handler.serialize(arr)
    assert data.startswith(b"\x89PNG") and "hdr" not in meta


def test_options_with_wrong_format_raise():
    handler = ImageHandler()
    arr = np.zeros((4, 4, 3), np.float32)
    with pytest.raises(ValueError, match="precision"):
        handler.serialize(arr, format="npy", precision="half")
    with pytest.raises(ValueError, match="compression"):
        handler.mime_type_for(arr, format="png", compression="zip")


def test_grayscale_float_roundtrips_2d():
    handler = ImageHandler()
    arr = np.random.default_rng(3).random((5, 7)).astype(np.float32)
    data, meta = handler.serialize(arr)
    assert meta["hdr"]["shape"] == [5, 7]
    assert handler.deserialize(data).shape == (5, 7)


def test_track_call_keyword_overrides_wrapper_keyword():
    # merged_kwargs = {**wrapper_kwargs, **call_kwargs} in Run.track
    from cairn.sdk.handlers.registry import resolve_mime_type
    handler = ImageHandler()
    arr = np.zeros((4, 4, 3), np.float32)
    merged = {**{"format": "npy"}, **{"format": "exr"}}
    assert resolve_mime_type(handler, arr, merged) == "image/x-exr"
```

Existing `test_numpy_uint8_stays_png`, `test_numpy_grayscale`, `test_torch_tensor_chw` etc. keep passing; if `test_numpy_grayscale` or `test_torch_tensor_chw` serialize float arrays and assert npy bytes, update them to the EXR expectations above (same shape assertions, `hdr.container == "exr"`).

- [ ] **Step 2: Run** — `uv run pytest tests/unit/test_handler_image.py -q` → FAIL.

- [ ] **Step 3: Implement**

`image.py`:

```python
from .image_encoding import EXR_MAGIC, decode_exr, encode_exr, image_encoding_for

class ImageHandler:
    object_type = "image"
    mime_type = "image/png"
    exr_mime_type = "image/x-exr"
    npy_mime_type = "application/x-npy"

    _OPTION_KEYS = ("format", "precision", "compression")

    @classmethod
    def _encoding_options(cls, kwargs: dict[str, Any]) -> dict[str, Any]:
        return {k: kwargs[k] for k in cls._OPTION_KEYS if k in kwargs}

    def mime_type_for(self, obj: Any, **kwargs: Any) -> str:
        enc = image_encoding_for(self._array_for_storage(obj), **self._encoding_options(kwargs))
        return {"png": self.mime_type, "exr": self.exr_mime_type, "npy": self.npy_mime_type}[enc.container]
```

`serialize(self, obj, boxes=None, masks=None, class_labels=None, format=None, precision="auto", compression="piz", **kwargs)`:

```python
        arr = self._array_for_storage(obj)
        enc = image_encoding_for(arr, format=format, precision=precision, compression=compression)
        img = self._to_pil(obj)
        buf = io.BytesIO()
        if enc.container == "exr":
            data = encode_exr(arr, enc)
        elif enc.container == "npy":
            np.save(buf, arr, allow_pickle=False)
            data = buf.getvalue()
        else:
            img.save(buf, format="PNG")
            data = buf.getvalue()
        ...
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
```

`_tonemap_range(arr)` returns `{"min": a_min, "max": a_max}` using the same finite min/max `_to_pil` computes (factor the two lines in `_to_pil` lines 191-196 into a shared static helper so the preview and the metadata agree).

`deserialize`:

```python
        if data.startswith(EXR_MAGIC):
            return decode_exr(data)
        if data.startswith(b"\x93NUMPY"):
            return np.load(io.BytesIO(data), allow_pickle=False)
        return PILImage.open(io.BytesIO(data))
```

Module docstring line 1: `"""Image handler — PIL/u8 → PNG; float/int arrays → OpenEXR (half PIZ by default), npy or PNG on request.` and a short options paragraph. `wrappers.Image` docstring: add the `format=`, `precision=`, `compression=` keywords with one line each and the defaults, noting `dwaa`/`dwab` are lossy.

- [ ] **Step 4: Run** — `uv run pytest tests/unit -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add cairn/sdk/handlers/image.py cairn/sdk/wrappers.py tests/unit/test_handler_image.py
git commit -m "Store float images as OpenEXR by default with format options"
```

---

### Task 4: End-to-end test through WAL and server; UI mime table

**Files:**
- Create: `tests/integration/test_image_exr_e2e.py`
- Create: `cairn/ui/src/lib/artifact-format.ts`, `cairn/ui/src/lib/artifact-format.test.ts`
- Modify: `cairn/ui/src/components/CairnPlotCard.tsx:95-100` (delete `artifactFormat`, import it)

**Interfaces:**
- Produces: `export function artifactFormat(mime: string | null | undefined): "exr" | "npy" | undefined`.

- [ ] **Step 1: Integration test**

```python
"""A float image logged through Run.track arrives as image/x-exr end to end."""

from __future__ import annotations

import numpy as np
import pytest

import cairn
from cairn.sdk.transport import Transport


@pytest.fixture
def transport(live_server, tmp_path):
    t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
    yield t
    t.close()


@pytest.fixture
def reader(live_server):
    import httpx

    with httpx.Client(base_url=live_server, timeout=10.0) as c:
        yield c


def _run(transport):
    return cairn.Run(project="exr", name="r", capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False, transport=transport)


def test_float_image_is_exr_from_track_to_artifact_route(transport, reader):
    run = _run(transport)
    arr = np.random.default_rng(0).random((16, 24, 3)).astype(np.float32)
    try:
        run.track(arr, name="render", step=0)
        run.track(arr, name="raw", step=0, format="npy")
        run.track(cairn.Image(arr[..., 0], precision="float"), name="gray", step=0)
    finally:
        run.finish()
    seqs = reader.get(f"/api/runs/{run.id}/sequences").json()["sequences"]
    by_name = {s["name"]: s for s in seqs}
    for name, mime, magic in [
        ("render", "image/x-exr", b"\x76\x2f\x31\x01"),
        ("raw", "application/x-npy", b"\x93NUMPY"),
        ("gray", "image/x-exr", b"\x76\x2f\x31\x01"),
    ]:
        point = reader.get(f"/api/runs/{run.id}/sequences/{by_name[name]['id']}").json()["points"][0]
        assert point["artifact_mime"] == mime
        r = reader.get(f"/api/artifacts/{point['artifact_hash']}")
        assert r.status_code == 200 and r.headers["content-type"].startswith(mime)
        assert r.content.startswith(magic)
        assert r.headers["cache-control"].startswith("public")
    gray_meta = reader.get(f"/api/runs/{run.id}/sequences/{by_name['gray']['id']}").json()["points"][0]["artifact_metadata"]
    assert '"precision": "float"' in gray_meta or '"precision":"float"' in gray_meta
```

The exact JSON field names for the sequence id, `artifact_hash`, `artifact_mime` and `artifact_metadata` must be taken from `cairn/ui/src/api/types.ts` (`SequencePoint`) and `cairn/server/routes/sequences.py`; adjust the test to the real names, keeping the three assertions (mime column, `Content-Type`, magic bytes). If the WAL is on by default in `cairn.Run`, this exercises it; if it is opt-in, enable it via the `Run` argument that turns it on (grep `wal` in `cairn/sdk/run.py`) so the artifact spills through `append_artifact`.

- [ ] **Step 2: Run** — `uv run pytest tests/integration/test_image_exr_e2e.py -q` → PASS (after fixing field names).

- [ ] **Step 3: UI table and test**

```ts
// cairn/ui/src/lib/artifact-format.ts
/** Map an artifact mime type to cairn-plot's raw-buffer `format` hint. */
const FORMAT_BY_MIME: Record<string, "exr" | "npy"> = {
  "image/x-exr": "exr",
  "image/aces": "exr",
  "application/x-npy": "npy",
};

export function artifactFormat(mime: string | null | undefined): "exr" | "npy" | undefined {
  const value = mime?.toLowerCase() ?? "";
  const exact = FORMAT_BY_MIME[value];
  if (exact) return exact;
  if (value.includes("openexr") || value.endsWith("/exr")) return "exr";
  if (value.includes("numpy") || value.includes("npy")) return "npy";
  return undefined;
}
```

```ts
// cairn/ui/src/lib/artifact-format.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactFormat } from "./artifact-format.ts";

test("artifactFormat maps mimes to cairn-plot format hints", () => {
  assert.equal(artifactFormat("image/x-exr"), "exr");
  assert.equal(artifactFormat("IMAGE/X-EXR"), "exr");
  assert.equal(artifactFormat("image/aces"), "exr");
  assert.equal(artifactFormat("image/openexr"), "exr");
  assert.equal(artifactFormat("application/x-npy"), "npy");
  assert.equal(artifactFormat("application/numpy"), "npy");
  assert.equal(artifactFormat("image/png"), undefined);
  assert.equal(artifactFormat(null), undefined);
});
```

`CairnPlotCard.tsx`: remove the local `artifactFormat`, add `import { artifactFormat } from "@/lib/artifact-format";` (match the alias style of the file's other `lib/` imports).

- [ ] **Step 4: Run** — `cd cairn/ui && npm run test:unit && npm run build` → PASS.

- [ ] **Step 5: Commit** (the pre-commit hook rebuilds `cairn/ui/dist`; include its changes)

```bash
git add tests/integration/test_image_exr_e2e.py cairn/ui/src/lib/artifact-format.ts cairn/ui/src/lib/artifact-format.test.ts cairn/ui/src/components/CairnPlotCard.tsx
git commit -m "Test EXR images end to end; table-driven artifact format in the card"
git status --short   # if the hook changed cairn/ui/dist, `git add cairn/ui/dist` and amend
```
