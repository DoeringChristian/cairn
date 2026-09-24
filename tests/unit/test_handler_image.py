"""Image handler — PNG by default; OpenEXR / npy only when `encoding=` asks."""

from __future__ import annotations

import io
import warnings

import numpy as np
import pytest
from PIL import Image as PILImage

from cairn.sdk.handlers.image import ImageHandler


@pytest.fixture
def handler() -> ImageHandler:
    return ImageHandler()


def test_pil_image_roundtrip(handler):
    src = PILImage.new("RGB", (10, 5), (255, 0, 0))
    data, meta = handler.serialize(src)
    assert meta["width"] == 10
    assert meta["height"] == 5
    assert meta["channels"] == 3
    # PNG magic
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    back = PILImage.open(io.BytesIO(data))
    assert back.size == (10, 5)
    assert meta["preview"].startswith("data:image/png;base64,")


def test_numpy_uint8_hwc(handler):
    arr = np.zeros((4, 6, 3), dtype=np.uint8)
    arr[:, :, 0] = 255
    data, meta = handler.serialize(arr)
    assert meta["width"] == 6
    assert meta["height"] == 4


def test_numpy_grayscale(handler):
    arr = (np.random.rand(8, 8) * 255).astype(np.uint8)
    data, meta = handler.serialize(arr)
    assert meta["channels"] == 1
    assert meta["mode"] == "L"


def test_numpy_float_defaults_to_png(handler):
    arr = np.random.default_rng(1).random((6, 8, 3)).astype(np.float32)
    assert handler.mime_type_for(arr) == "image/png"
    data, meta = handler.serialize(arr)
    assert data.startswith(b"\x89PNG")
    assert meta["encoding"] == "png" and "linear" not in meta
    assert meta["hdr"] == {"source_dtype": "float32", "shape": [6, 8, 3], "clamped": False}
    back = np.asarray(handler.deserialize(data))
    np.testing.assert_allclose(back / 255.0, arr, atol=1 / 255)


def _png_values(handler, arr, **kwargs):
    data, meta = handler.serialize(arr, **kwargs)
    return np.asarray(handler.deserialize(data)), meta


def test_float_is_read_as_unit_range_and_outliers_clip(handler):
    # A render whose content lives below 0.4 plus one specular glint at 7.79: the
    # glint must saturate, not rescale the whole image into the bottom codes.
    arr = np.full((4, 4, 3), 0.374, np.float32)
    arr[0, 0] = 7.79
    arr[3, 3] = -0.2
    back, _ = _png_values(handler, arr)
    assert back[1, 1, 0] == 95  # round(0.374 * 255)
    assert back[0, 0, 0] == 255 and back[3, 3, 0] == 0


def test_integer_dtypes_span_their_range(handler):
    u16 = np.full((2, 2), 32768, np.uint16)
    assert _png_values(handler, u16)[0][0, 0] == 128
    signed = np.array([[-5, 0], [2**31 - 1, 2**30]], np.int32)
    assert _png_values(handler, signed)[0].tolist() == [[0, 0], [255, 128]]
    flags = np.array([[True, False]], bool)
    assert _png_values(handler, flags)[0].tolist() == [[255, 0]]


def test_nan_is_black(handler):
    arr = np.array([[np.nan, 1.0]], np.float32)
    assert _png_values(handler, arr)[0].tolist() == [[0, 255]]


def test_linear_applies_the_srgb_transfer(handler):
    arr = np.array([[0.0, 0.0031308, 0.18, 0.374, 1.0]], np.float32)
    back, meta = _png_values(handler, arr, linear=True)
    assert back.tolist() == [[0, 10, 118, 165, 255]]
    assert meta["linear"] is True
    # uint8 input is display values unless marked linear.
    u8 = np.array([[46]], np.uint8)  # 0.18 * 255
    assert _png_values(handler, u8)[0][0, 0] == 46
    assert _png_values(handler, u8, linear=True)[0][0, 0] == 118


def test_linear_exr_keeps_values_and_srgb_preview(handler):
    arr = np.full((4, 4, 3), 0.18, np.float32)
    data, meta = handler.serialize(arr, encoding="exr", linear=True)
    np.testing.assert_allclose(handler.deserialize(data).astype(np.float32), arr, rtol=2 ** -11)
    import base64
    import io as _io
    preview = PILImage.open(_io.BytesIO(base64.b64decode(meta["preview"].split(",", 1)[1])))
    assert np.asarray(preview)[0, 0, 0] == 118


def test_exr_on_request_keeps_hdr_values(handler):
    arr = np.random.default_rng(1).random((6, 8, 3)).astype(np.float32) * 4
    assert handler.mime_type_for(arr, encoding="exr:dwab") == "image/x-exr"
    data, meta = handler.serialize(arr, encoding="exr")
    assert data.startswith(b"\x76\x2f\x31\x01")
    assert meta["encoding"] == "exr:piz:half"
    assert meta["hdr"] == {"source_dtype": "float32", "shape": [6, 8, 3], "clamped": False}
    back = handler.deserialize(data)
    assert back.dtype == np.float16 and back.shape == (6, 8, 3)
    np.testing.assert_allclose(back.astype(np.float32), arr, rtol=2 ** -11)


def test_uint16_exr_is_float_exact(handler):
    arr = (np.arange(6 * 8, dtype=np.uint16).reshape(6, 8) * 900).astype(np.uint16)
    data, meta = handler.serialize(arr, encoding="exr")
    assert meta["encoding"] == "exr:piz:float" and meta["hdr"]["source_dtype"] == "uint16"
    np.testing.assert_array_equal(handler.deserialize(data), arr.astype(np.float32))


def test_exr_out_of_half_range_promotes_to_float(handler):
    arr = np.full((4, 4, 3), 1e5, np.float32)
    _, meta = handler.serialize(arr, encoding="exr")
    assert meta["encoding"] == "exr:piz:float" and meta["hdr"]["clamped"] is False


def test_exr_forced_half_records_clamped(handler):
    arr = np.full((4, 4, 3), 1e5, np.float32)
    _, meta = handler.serialize(arr, encoding="exr:piz:half")
    assert meta["encoding"] == "exr:piz:half" and meta["hdr"]["clamped"] is True


def test_two_channel_float_needs_npy(handler):
    # (5, 7, 2): shape[0] ∉ {1,3,4}, so _array_for_storage's CHW heuristic leaves it alone.
    arr = np.zeros((5, 7, 2), np.float32)
    for encoding in ("png", "exr"):
        with pytest.raises(ValueError, match="channel"):
            handler.mime_type_for(arr, encoding=encoding)
        with pytest.raises(ValueError, match="channel"):
            handler.serialize(arr, encoding=encoding)
    assert handler.mime_type_for(arr, encoding="npy") == "application/x-npy"
    data, meta = handler.serialize(arr, encoding="npy")
    assert data.startswith(b"\x93NUMPY") and meta["encoding"] == "npy"
    np.testing.assert_array_equal(handler.deserialize(data), arr)


def test_uint8_two_channel_is_rejected_not_flattened(handler):
    arr = np.zeros((5, 7, 2), np.uint8)
    with pytest.raises(ValueError, match="channel"):
        handler.mime_type_for(arr)
    with pytest.raises(ValueError, match="channel"):
        handler.serialize(arr)


def test_uint8_rejects_other_encodings_and_stays_png(handler):
    arr = np.zeros((4, 4, 3), np.uint8)
    assert handler.mime_type_for(arr) == "image/png"
    with pytest.raises(ValueError, match="display"):
        handler.serialize(arr, encoding="exr")
    data, meta = handler.serialize(arr)
    assert data.startswith(b"\x89PNG") and "hdr" not in meta and meta["encoding"] == "png"


def test_invalid_encoding_raises(handler):
    arr = np.zeros((4, 4, 3), np.float32)
    with pytest.raises(ValueError, match="start with"):
        handler.serialize(arr, encoding="tiff")
    with pytest.raises(ValueError, match="compression"):
        handler.mime_type_for(arr, encoding="exr:lzw")


def test_grayscale_float_exr_roundtrips_2d(handler):
    arr = np.random.default_rng(3).random((5, 7)).astype(np.float32)
    data, meta = handler.serialize(arr, encoding="exr")
    assert meta["hdr"]["shape"] == [5, 7]
    assert handler.deserialize(data).shape == (5, 7)


def test_numpy_uint8_stays_png(handler):
    arr = np.zeros((2, 3, 4), dtype=np.uint8)
    data, _ = handler.serialize(arr)

    assert handler.mime_type_for(arr) == "image/png"
    assert data.startswith(b"\x89PNG\r\n\x1a\n")


def test_can_handle_rejects_1d(handler):
    assert not handler.can_handle(np.zeros(10))


def test_can_handle_accepts_pil(handler):
    assert handler.can_handle(PILImage.new("RGB", (1, 1)))


@pytest.mark.torch
def test_torch_tensor_chw(handler):
    torch = pytest.importorskip("torch")
    t = torch.zeros((3, 8, 8), dtype=torch.uint8)
    data, meta = handler.serialize(t)
    assert meta["width"] == 8
    assert meta["height"] == 8


def test_large_constant_array_previews_without_dividing_by_zero(handler):
    # 1e16 >= 2**53, so the tone-map window's degenerate-range guard cannot widen it.
    arr = np.full((4, 4, 3), 1e16, np.float32)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        _, meta = handler.serialize(arr)
    assert meta["preview"].startswith("data:image/png;base64,")


def test_single_channel_shape_is_restored_from_metadata(handler):
    arr = np.random.default_rng(5).random((5, 7, 1)).astype(np.float32)
    data, meta = handler.serialize(arr, encoding="exr")
    assert meta["hdr"]["shape"] == [5, 7, 1]
    # EXR stores (H, W, 1) as the `Y` channel, so the axis only comes back with metadata.
    assert handler.deserialize(data).shape == (5, 7)
    assert handler.deserialize(data, meta).shape == (5, 7, 1)
