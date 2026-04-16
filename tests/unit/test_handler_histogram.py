"""Histogram handler."""

from __future__ import annotations

import io

import numpy as np

from cairn.sdk.handlers.histogram import HistogramHandler


def test_histogram_roundtrip():
    h = HistogramHandler()
    rng = np.random.default_rng(0)
    data_in = rng.normal(size=1000)
    blob, meta = h.serialize(data_in, bins=32)
    assert meta["num_bins"] == 32
    assert meta["count"] == 1000
    # Read back
    npz = np.load(io.BytesIO(blob))
    counts = npz["counts"]
    edges = npz["edges"]
    assert len(counts) == 32
    assert len(edges) == 33
    assert counts.sum() == 1000


def test_empty_input():
    h = HistogramHandler()
    blob, meta = h.serialize(np.zeros(0))
    assert meta["count"] == 0
    assert meta["min"] == 0.0


def test_can_handle_only_via_wrapper():
    # Auto-dispatch returns False (1D arrays could be time series).
    h = HistogramHandler()
    assert not h.can_handle(np.zeros(100))
