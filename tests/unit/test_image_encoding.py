import warnings

import numpy as np
import pytest

from cairn.sdk.handlers.image_encoding import (
    EXR_MAGIC, FLOAT_MAX, HALF_MAX, HALF_MIN_NORMAL, ImageEncoding, decode_exr, encode_exr, image_encoding_for,
)


def rgb(dtype=np.float32, scale=1.0, h=4, w=5):
    return (np.random.default_rng(0).random((h, w, 3)) * scale).astype(dtype)


@pytest.mark.parametrize(
    "arr,encoding,expect",
    [
        # PNG is the default for everything that has an image channel layout.
        (rgb(), None, ("png", None, None, None)),
        (rgb(np.uint16), None, ("png", None, None, None)),
        (rgb()[..., 0], None, ("png", None, None, None)),
        (rgb(np.uint8), None, ("png", None, None, None)),
        (None, None, ("png", None, None, None)),
        (rgb(), "npy", ("npy", None, None, None)),
        (rgb()[..., :2], "npy", ("npy", None, None, None)),
        # EXR on request, with compression/precision defaults filled in.
        (rgb(), "exr", ("exr", "half", "RGB", "piz")),
        (rgb(np.float64), "exr", ("exr", "half", "RGB", "piz")),
        (rgb(scale=1e6), "exr", ("exr", "float", "RGB", "piz")),
        (rgb(np.uint16), "exr", ("exr", "float", "RGB", "piz")),
        (rgb(np.int32), "exr", ("exr", "float", "RGB", "piz")),
        (rgb().astype(bool), "exr", ("exr", "float", "RGB", "piz")),
        (rgb()[..., 0], "exr", ("exr", "half", "Y", "piz")),
        (rgb()[..., :1], "exr", ("exr", "half", "Y", "piz")),
        (np.concatenate([rgb(), rgb()[..., :1]], -1), "exr", ("exr", "half", "RGBA", "piz")),
        (rgb(), "exr:dwab", ("exr", "half", "RGB", "dwab")),
        (rgb(), "EXR:DWAA", ("exr", "half", "RGB", "dwaa")),
        (rgb(), "exr::float", ("exr", "float", "RGB", "piz")),
        (rgb(), "exr:zip:float", ("exr", "float", "RGB", "zip")),
    ],
)
def test_policy_table(arr, encoding, expect):
    enc = image_encoding_for(arr) if encoding is None else image_encoding_for(arr, encoding)
    assert (enc.container, enc.precision, enc.channels, enc.compression) == expect


@pytest.mark.parametrize(
    "encoding,name",
    [("png", "png"), ("npy", "npy"), ("exr", "exr:piz:half"), ("exr:dwab", "exr:dwab:half"),
     ("exr:zip:float", "exr:zip:float")],
)
def test_canonical_name(encoding, name):
    assert image_encoding_for(rgb(), encoding).name == name


def test_forced_half_marks_clamped():
    enc = image_encoding_for(rgb(scale=1e6), "exr:piz:half")
    assert enc.precision == "half" and enc.clamped is True
    assert image_encoding_for(rgb(), "exr:piz:half").clamped is False


def test_nan_and_inf_do_not_force_float():
    a = rgb(); a[0, 0, 0] = np.nan; a[0, 0, 1] = np.inf
    assert image_encoding_for(a, "exr").precision == "half"


@pytest.mark.parametrize(
    "arr,encoding,match",
    [
        (rgb()[..., :2], "png", "channel"),
        (rgb()[..., :2], "exr", "channel"),
        (rgb(np.uint8), "exr", "uint8|display"),
        (rgb(np.uint8), "npy", "uint8|display"),
        (None, "exr", "PIL|display"),
        (rgb(), "npy:zip", "no options"),
        (rgb(), "png:zip", "no options"),
        (rgb(), "tiff", "start with"),
        (rgb(), "exr:piz:double", "precision"),
        (rgb(), "exr:lzw", "compression"),
        (rgb(), "exr:piz:half:x", "exr\\["),
    ],
)
def test_invalid_encodings_raise(arr, encoding, match):
    with pytest.raises(ValueError, match=match):
        image_encoding_for(arr, encoding)


@pytest.mark.parametrize("compression", ["piz", "zip", "zips", "none"])
def test_exr_roundtrip_half_lossless_within_half_precision(compression):
    a = rgb(h=16, w=24)
    enc = image_encoding_for(a, f"exr:{compression}")
    data = encode_exr(a, enc)
    assert data.startswith(EXR_MAGIC)
    back = decode_exr(data)
    assert back.dtype == np.float16 and back.shape == a.shape
    np.testing.assert_allclose(back.astype(np.float32), a, rtol=2 ** -11, atol=0)


def test_exr_roundtrip_float_exact():
    a = (np.arange(16 * 24 * 3, dtype=np.uint16).reshape(16, 24, 3) * 3).astype(np.uint16)
    enc = image_encoding_for(a, "exr")
    back = decode_exr(encode_exr(a, enc))
    assert back.dtype == np.float32
    np.testing.assert_array_equal(back, a.astype(np.float32))


def test_exr_roundtrip_gray_and_rgba():
    g = rgb(h=8, w=8)[..., 0]
    assert decode_exr(encode_exr(g, image_encoding_for(g, "exr"))).shape == (8, 8)
    r = np.concatenate([rgb(h=8, w=8), np.ones((8, 8, 1), np.float32)], -1)
    assert decode_exr(encode_exr(r, image_encoding_for(r, "exr"))).shape == (8, 8, 4)


def test_exr_dwaa_is_lossy_but_close():
    a = rgb(h=32, w=32)
    back = decode_exr(encode_exr(a, image_encoding_for(a, "exr:dwaa")))
    np.testing.assert_allclose(back.astype(np.float32), a, rtol=0.02, atol=0.02)


def test_forced_half_clamps_finite_values_without_warning():
    a = np.full((4, 4, 3), 1e5, np.float32)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        enc = image_encoding_for(a, "exr:piz:half")
        back = decode_exr(encode_exr(a, enc))
    assert enc.precision == "half" and enc.clamped is True
    np.testing.assert_array_equal(back.astype(np.float32), np.full((4, 4, 3), HALF_MAX, np.float32))


def test_forced_half_preserves_inf_and_nan():
    a = np.tile(np.array([np.inf, np.nan, -np.inf], np.float32), (2, 3, 1))
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        back = decode_exr(encode_exr(a, image_encoding_for(a, "exr:piz:half")))
    back = back.astype(np.float32)
    assert np.isposinf(back[..., 0]).all()
    assert np.isnan(back[..., 1]).all()
    assert np.isneginf(back[..., 2]).all()


def test_float64_beyond_float32_range_clamps_without_warning():
    a = np.full((4, 4, 3), 1e300, np.float64)
    a[0, 0] = -1e300
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        enc = image_encoding_for(a, "exr")
        back = decode_exr(encode_exr(a, enc))
    assert enc.precision == "float" and back.dtype == np.float32
    np.testing.assert_array_equal(back[0, 0], np.full(3, -FLOAT_MAX, np.float32))
    np.testing.assert_array_equal(back[1], np.full((4, 3), FLOAT_MAX, np.float32))
    np.testing.assert_array_equal(a, np.where(a < 0, -1e300, 1e300))  # caller's array untouched


def test_float64_specials_round_trip():
    a = np.tile(np.array([np.inf, np.nan, -np.inf], np.float64), (2, 3, 1))
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        back = decode_exr(encode_exr(a, image_encoding_for(a, "exr")))
    assert np.isposinf(back[..., 0]).all()
    assert np.isnan(back[..., 1]).all()
    assert np.isneginf(back[..., 2]).all()


def test_all_subnormal_half_range_promotes_to_float():
    a = (np.random.default_rng(4).random((8, 8, 3)) * 1e-7).astype(np.float32)
    enc = image_encoding_for(a, "exr")
    assert enc.precision == "float" and enc.clamped is False
    np.testing.assert_array_equal(decode_exr(encode_exr(a, enc)), a)


def test_forced_half_on_subnormal_range_records_clamped():
    a = (np.random.default_rng(4).random((8, 8, 3)) * 1e-7).astype(np.float32)
    assert image_encoding_for(a, "exr:piz:half").clamped is True


def test_all_zero_image_stays_half():
    a = np.zeros((8, 8, 3), np.float32)
    enc = image_encoding_for(a, "exr")
    assert enc.precision == "half" and enc.clamped is False


def test_normal_range_image_is_unaffected_by_the_underflow_rule():
    a = np.full((8, 8, 3), HALF_MIN_NORMAL, np.float32)
    assert image_encoding_for(a, "exr").precision == "half"
    assert image_encoding_for(rgb(), "exr").precision == "half"
