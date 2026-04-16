"""Type wrapper dispatch."""

from __future__ import annotations

import numpy as np

from cairn.sdk.handlers import default_registry
from cairn.sdk.wrappers import (
    Audio,
    Figure,
    Histogram,
    Image,
    Tensor,
    Text,
    Video,
)


def test_image_wrapper_finds_image_handler():
    h = default_registry.find_handler(Image(np.zeros((4, 4, 3), dtype=np.uint8)))
    assert h is not None and h.object_type == "image"


def test_tensor_wrapper_finds_tensor_handler():
    h = default_registry.find_handler(Tensor(np.zeros(5)))
    assert h is not None and h.object_type == "tensor"


def test_histogram_wrapper_finds_histogram_handler():
    h = default_registry.find_handler(Histogram(np.zeros(100)))
    assert h is not None and h.object_type == "histogram"


def test_text_wrapper_finds_text_handler():
    h = default_registry.find_handler(Text("x" * 2000))
    assert h is not None and h.object_type == "text"


def test_audio_wrapper_finds_audio_handler():
    h = default_registry.find_handler(Audio(np.zeros(100), sample_rate=8000))
    assert h is not None and h.object_type == "audio"


def test_video_wrapper_finds_video_handler():
    # Video might fail can_handle on auto-dispatch (4D array required) but
    # the wrapper forces the handler lookup by object_type regardless.
    h = default_registry.find_handler(Video(np.zeros((3, 4, 4, 3), dtype=np.uint8)))
    assert h is not None and h.object_type == "video"


def test_figure_wrapper_finds_figure_handler():
    # Wrapping an arbitrary object still routes to figure handler.
    h = default_registry.find_handler(Figure(object()))
    assert h is not None and h.object_type == "figure"


def test_wrappers_carry_kwargs():
    w = Audio(np.zeros(10), sample_rate=44100)
    assert w.kwargs == {"sample_rate": 44100}
