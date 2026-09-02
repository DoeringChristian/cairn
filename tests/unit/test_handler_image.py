"""Image handler — u8 images use PNG; wider arrays retain HDR values in NPY."""

from __future__ import annotations

import io

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


def test_numpy_float_preserves_hdr_values(handler):
    arr = np.array([[[-2.0, 0.5, 8.0]]], dtype=np.float32)
    data, meta = handler.serialize(arr)

    assert handler.mime_type_for(arr) == "application/x-npy"
    assert data.startswith(b"\x93NUMPY")
    assert meta["preview"].startswith("data:image/png;base64,")
    np.testing.assert_array_equal(np.load(io.BytesIO(data)), arr)
    np.testing.assert_array_equal(handler.deserialize(data), arr)


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
