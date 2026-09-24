"""Histogram handler."""

from __future__ import annotations

import io

import numpy as np
import pytest

import cairn
from cairn.sdk.handlers.histogram import HistogramHandler
from cairn.sdk.wrappers import Histogram


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


# --------------------------------------------------------------------------
# Precomputed histograms (counts + edges)
# --------------------------------------------------------------------------

def test_precomputed_stores_bins_as_given():
    h = HistogramHandler()
    counts = np.array([1, 3, 0, 4])
    edges = np.array([0.0, 1.0, 2.0, 3.0, 4.0])
    blob, meta = h.serialize(None, counts=counts, edges=edges)
    got_counts, got_edges = h.deserialize(blob)
    np.testing.assert_array_equal(got_counts, counts)
    np.testing.assert_array_equal(got_edges, edges)
    assert meta["num_bins"] == 4
    assert meta["count"] == 8
    assert (meta["min"], meta["max"]) == (0.0, 4.0)
    # Mean from the bin midpoints: (0.5*1 + 1.5*3 + 3.5*4) / 8.
    assert meta["mean"] == pytest.approx((0.5 + 4.5 + 14.0) / 8)


def test_precomputed_empty_counts_have_zero_mean():
    _, meta = HistogramHandler().serialize(None, counts=[0, 0], edges=[0.0, 1.0, 2.0])
    assert meta["count"] == 0 and meta["mean"] == 0.0


def test_precomputed_rejects_mismatched_edges():
    with pytest.raises(ValueError, match="len\\(counts\\) \\+ 1"):
        HistogramHandler().serialize(None, counts=[1, 2], edges=[0.0, 1.0])


def test_precomputed_accepts_torch_tensors():
    torch = pytest.importorskip("torch")
    counts = torch.histc(torch.tensor([0.1, 0.2, 0.9]), bins=2, min=0.0, max=1.0)
    blob, meta = HistogramHandler().serialize(
        None, counts=counts, edges=torch.linspace(0.0, 1.0, 3)
    )
    assert meta["count"] == 3
    c, e = HistogramHandler().deserialize(blob)
    assert list(c) == [2.0, 1.0] and list(e) == [0.0, 0.5, 1.0]


def test_wrapper_takes_values_or_counts_and_edges():
    assert Histogram(np.zeros(3), bins=8).kwargs == {"bins": 8}
    w = Histogram(counts=[1], edges=[0.0, 1.0])
    assert w.obj is None and set(w.kwargs) == {"counts", "edges"}
    with pytest.raises(ValueError):
        Histogram()
    with pytest.raises(ValueError):
        Histogram(counts=[1])
    with pytest.raises(ValueError):
        Histogram(np.zeros(3), counts=[1], edges=[0.0, 1.0])


def test_run_tracks_a_precomputed_histogram(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(project="h", repo=repo, capture_source=False, capture_stdout=False,
                   capture_env=False, capture_system_metrics=False) as run:
        run.track(Histogram(counts=[2, 5], edges=[-1.0, 0.0, 1.0]), name="grads", step=3)
    reader = cairn.Reader(repo=repo)
    try:
        counts, edges = reader.runs("h").list()[0].artifact("grads", step=3)
    finally:
        reader.close()
    assert list(counts) == [2, 5] and list(edges) == [-1.0, 0.0, 1.0]
