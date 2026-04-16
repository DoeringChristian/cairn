"""Tensor handler — .npy round-trip + size cap."""

from __future__ import annotations

import io

import numpy as np
import pytest

from cairn.sdk.handlers.tensor import MAX_BYTES, TensorHandler


def test_small_array_roundtrip():
    h = TensorHandler()
    arr = np.arange(100, dtype=np.float32).reshape(10, 10)
    data, meta = h.serialize(arr)
    assert meta["shape"] == [10, 10]
    assert meta["dtype"] == "float32"
    # Read back via np.load
    back = np.load(io.BytesIO(data), allow_pickle=False)
    np.testing.assert_array_equal(back, arr)


def test_oversized_array_rejected():
    h = TensorHandler()
    # 11MB float32 array.
    n = MAX_BYTES // 4 + 10
    arr = np.zeros(n, dtype=np.float32)
    with pytest.raises(ValueError, match="too large"):
        h.serialize(arr)


def test_can_handle_only_via_wrapper():
    h = TensorHandler()
    assert not h.can_handle(np.zeros(10))


def test_metadata_stats():
    h = TensorHandler()
    arr = np.array([1.0, 2.0, 3.0, 4.0])
    _, meta = h.serialize(arr)
    assert meta["min"] == 1.0
    assert meta["max"] == 4.0
    assert meta["mean"] == 2.5
