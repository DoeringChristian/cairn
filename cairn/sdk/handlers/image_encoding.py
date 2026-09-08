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
HALF_MIN_NORMAL = 6.103515625e-05
FLOAT_MAX = float(np.finfo(np.float32).max)
EXR_MAGIC = b"\x76\x2f\x31\x01"
_CHANNELS_BY_COUNT = {1: "Y", 3: "RGB", 4: "RGBA"}


@dataclass(frozen=True)
class ImageEncoding:
    """How one image array is stored.

    ``clamped`` means half could not represent the array's range and a forced
    ``precision="half"`` lost values to it — by overflow above ``HALF_MAX``, or by
    underflow when every value sits below ``HALF_MIN_NORMAL``.
    """

    container: str
    precision: str | None = None
    channels: str | None = None
    compression: str | None = None
    fallback_reason: str | None = None
    clamped: bool = False


def _channel_count(arr: np.ndarray) -> int:
    return 1 if arr.ndim == 2 else int(arr.shape[-1])


def _to_float32(arr: np.ndarray) -> np.ndarray:
    """Cast to float32, clamping finite values that overflow it (never in place).

    float32 is EXR's widest pixel type, so a float64 value beyond its range has
    to become *something*: the nearest representable number, rather than the
    ``inf`` (plus a RuntimeWarning) an unguarded cast produces. NaN and ±Inf are
    representable and pass through untouched.
    """
    if arr.dtype == np.float32:
        return arr
    if arr.dtype.kind == "f" and arr.itemsize > 4:
        # Clamp in the wider dtype so the cast itself can never overflow.
        arr = np.where(np.isfinite(arr), np.clip(arr, -FLOAT_MAX, FLOAT_MAX), arr)
    return arr.astype(np.float32)


def _max_abs_finite(arr: np.ndarray) -> float:
    """Largest finite magnitude in `arr` (0.0 when it has none)."""
    values = _to_float32(arr)
    finite = values[np.isfinite(values)]
    return float(np.abs(finite).max()) if finite.size else 0.0


def _exceeds_half(arr: np.ndarray) -> bool:
    return _max_abs_finite(arr) > HALF_MAX


def _underflows_half(arr: np.ndarray) -> bool:
    """True when the whole image sits inside half's subnormal range."""
    return 0.0 < _max_abs_finite(arr) < HALF_MIN_NORMAL


def _half_loses_range(arr: np.ndarray) -> bool:
    """Half cannot carry these values: they overflow it, or all of them underflow it.

    A 1e-7-scale radiance image is entirely subnormal in half — representable in
    name only, at a handful of mantissa bits — so it belongs in float, exactly as
    a >65504 image does. An all-zero image is fine: zero is exact in half.
    """
    return _exceeds_half(arr) or _underflows_half(arr)


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
            precision = "float" if _half_loses_range(arr) else "half"
    elif precision == "half":
        clamped = _half_loses_range(arr)
    return ImageEncoding(
        container="exr", precision=precision, channels=channels, compression=compression, clamped=clamped
    )


def encode_exr(arr: np.ndarray, enc: ImageEncoding) -> bytes:
    """Encode an HWC (or HW) array as a scanline OpenEXR with `enc`'s settings."""
    assert enc.container == "exr" and enc.channels and enc.precision and enc.compression
    pixels = _to_float32(arr)
    if enc.precision == "half":
        # Spec §3.1 rule 6: forced half CLAMPS out-of-range finite values (an
        # unguarded cast would overflow them to ±inf and warn). NaN/±Inf are
        # representable in half and pass through untouched.
        pixels = np.where(np.isfinite(pixels), np.clip(pixels, -HALF_MAX, HALF_MAX), pixels)
        pixels = pixels.astype(np.float16)
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
