"""Scalar handler."""

from __future__ import annotations

import numpy as np

from cairn.sdk.handlers.scalar import ScalarHandler


def test_accepts_py_scalars():
    h = ScalarHandler()
    assert h.can_handle(1)
    assert h.can_handle(1.5)
    assert h.can_handle(True)
    assert not h.can_handle("str")
    assert not h.can_handle([1, 2])


def test_accepts_numpy_scalars():
    h = ScalarHandler()
    assert h.can_handle(np.int32(3))
    assert h.can_handle(np.float64(1.5))


def test_to_scalar_roundtrip():
    h = ScalarHandler()
    assert h.to_scalar(np.float32(3.14)) == np.float32(3.14)
    assert h.to_scalar(True) == 1.0
    assert h.to_scalar(42) == 42.0
