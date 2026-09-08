import warnings

import numpy as np
import pytest

from cairn.sdk.handlers.image_encoding import (
    EXR_MAGIC, HALF_MAX, ImageEncoding, decode_exr, encode_exr, image_encoding_for,
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


def test_forced_half_clamps_finite_values_without_warning():
    a = np.full((4, 4, 3), 1e5, np.float32)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        enc = image_encoding_for(a, precision="half")
        back = decode_exr(encode_exr(a, enc))
    assert enc.precision == "half" and enc.clamped is True
    np.testing.assert_array_equal(back.astype(np.float32), np.full((4, 4, 3), HALF_MAX, np.float32))


def test_forced_half_preserves_inf_and_nan():
    a = np.tile(np.array([np.inf, np.nan, -np.inf], np.float32), (2, 3, 1))
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        back = decode_exr(encode_exr(a, image_encoding_for(a, precision="half")))
    back = back.astype(np.float32)
    assert np.isposinf(back[..., 0]).all()
    assert np.isnan(back[..., 1]).all()
    assert np.isneginf(back[..., 2]).all()
