"""cairn.Image(x, colormap=...) bakes a colormap into an RGB PNG over a fixed range."""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image as PILImage

from cairn.sdk.handlers.colormaps import COLORMAPS, apply_colormap
from cairn.sdk.handlers.image import ImageHandler


@pytest.fixture
def handler() -> ImageHandler:
    return ImageHandler()


def _png(handler, arr, **kwargs):
    data, meta = handler.serialize(arr, **kwargs)
    return np.asarray(PILImage.open(io.BytesIO(data))), meta


def test_the_four_colormaps_exist():
    assert set(COLORMAPS) == {"turbo", "magma", "red-blue", "red-green"}


def test_diverging_maps_span_minus_one_to_one_with_white_at_zero():
    rgb = apply_colormap(np.array([[-1.0, 0.0, 1.0, 5.0]]), "red-blue")
    assert rgb.tolist() == [[[215, 25, 28], [255, 255, 255], [44, 123, 182], [44, 123, 182]]]


def test_sequential_maps_span_zero_to_one():
    rgb = apply_colormap(np.array([[-0.5, 0.0, 1.0, 3.0]]), "magma")
    ends = apply_colormap(np.array([[0.0, 1.0]]), "magma")
    assert rgb[0, 0].tolist() == rgb[0, 1].tolist() == ends[0, 0].tolist()
    assert rgb[0, 2].tolist() == rgb[0, 3].tolist() == ends[0, 1].tolist()


def test_range_is_fixed_across_images():
    # The same value is the same colour whatever else the image holds.
    small = apply_colormap(np.array([[0.25, 0.3]]), "turbo")
    wide = apply_colormap(np.array([[0.25, 0.9]]), "turbo")
    assert small[0, 0].tolist() == wide[0, 0].tolist()


def test_vmin_vmax_override_the_range():
    rgb = apply_colormap(np.array([[-0.05, 0.0, 0.05]]), "red-green", vmin=-0.05, vmax=0.05)
    assert rgb.tolist() == [[[215, 25, 28], [255, 255, 255], [26, 150, 65]]]


def test_handler_stores_an_rgb_png_and_records_the_colormap(handler):
    arr = np.linspace(-1, 1, 16, dtype=np.float32).reshape(4, 4, 1)
    assert handler.mime_type_for(arr, colormap="red-blue") == "image/png"
    png, meta = _png(handler, arr, colormap="red-blue", vmax=0.5, vmin=-0.5)
    assert png.shape == (4, 4, 3)
    assert meta["colormap"] == {"name": "red-blue", "vmin": -0.5, "vmax": 0.5}
    assert meta["hdr"]["shape"] == [4, 4, 1]


@pytest.mark.parametrize(
    "arr,kwargs,match",
    [
        (np.zeros((4, 4, 3), np.float32), {"colormap": "turbo"}, "single-channel"),
        (np.zeros((4, 4), np.float32), {"colormap": "viridis"}, "one of"),
        (np.zeros((4, 4), np.float32), {"colormap": "turbo", "encoding": "exr"}, "PNG"),
        (np.zeros((4, 4), np.float32), {"colormap": "turbo", "linear": True}, "linear"),
        (np.zeros((4, 4), np.float32), {"colormap": "turbo", "vmin": 1, "vmax": 1}, "vmax > vmin"),
        (np.zeros((4, 4), np.float32), {"vmin": 0, "vmax": 1}, "colormap="),
    ],
)
def test_invalid_colormap_use_raises(handler, arr, kwargs, match):
    with pytest.raises(ValueError, match=match):
        handler.serialize(arr, **kwargs)
