"""Unit tests for LTTB + uniform downsampling."""

from __future__ import annotations

import math

from cairn.server.downsample import downsample, lttb, uniform_bucket


def _sine(n: int) -> list[tuple[float, float]]:
    return [(float(i), math.sin(i / 10.0)) for i in range(n)]


def test_lttb_short_input_passes_through():
    pts = _sine(5)
    assert lttb(pts, 10) == pts
    assert lttb(pts, 2) == pts


def test_lttb_output_length():
    pts = _sine(10_000)
    out = lttb(pts, 500)
    assert len(out) == 500


def test_lttb_preserves_endpoints():
    pts = _sine(1000)
    out = lttb(pts, 100)
    assert out[0] == pts[0]
    assert out[-1] == pts[-1]


def test_lttb_preserves_extrema_approximately():
    """The global max of a sine should survive downsampling to ~100 points."""
    pts = _sine(1000)
    out = lttb(pts, 100)
    out_max = max(y for _, y in out)
    full_max = max(y for _, y in pts)
    assert full_max - out_max < 0.05


def test_uniform_bucket_length_matches_threshold():
    pts = _sine(1000)
    out = uniform_bucket(pts, 100)
    # Uniform guarantees at most threshold points, endpoints included.
    assert 98 <= len(out) <= 100


def test_uniform_bucket_keeps_endpoints():
    pts = _sine(1000)
    out = uniform_bucket(pts, 100)
    assert out[0] == pts[0]
    assert out[-1] == pts[-1]


def test_uniform_short_input_passes_through():
    pts = _sine(5)
    assert uniform_bucket(pts, 10) == pts


def test_downsample_none_threshold_is_noop():
    pts = _sine(100)
    assert downsample(pts, None) == pts
    assert downsample(pts, 0) == pts
    assert downsample(pts, -5) == pts


def test_downsample_dispatch_lttb_default():
    pts = _sine(1000)
    out = downsample(pts, 50)
    assert len(out) == 50
    assert out[0] == pts[0]


def test_downsample_uniform_method():
    pts = _sine(1000)
    out = downsample(pts, 50, method="uniform")
    assert 48 <= len(out) <= 50
    assert out[0] == pts[0]


def test_lttb_handles_duplicate_x():
    # All points at x=0; LTTB should still emit a length-respecting output.
    pts = [(0.0, float(i)) for i in range(100)]
    out = lttb(pts, 20)
    assert len(out) == 20
    assert out[0] == pts[0]
    assert out[-1] == pts[-1]


def test_lttb_threshold_equals_len_returns_all():
    pts = _sine(50)
    assert lttb(pts, 50) == pts
