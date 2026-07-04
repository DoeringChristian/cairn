"""Shared named-property normalization helper (`handlers/_properties.py`) —
used by mesh/pointcloud/boxes3d so this canonicalization lives in ONE place
(spec-visual-compare.md quality bar #3)."""

from __future__ import annotations

import numpy as np
import pytest

from cairn.sdk.handlers._properties import (
    normalize_properties,
    properties_arrays,
    properties_metadata,
    value_range_from,
)


def test_none_stays_none():
    assert normalize_properties(None, 5, "test") is None


def test_bare_array_canonicalized_to_value():
    props = normalize_properties([0.0, 1.0, 2.0], 3, "test")
    assert props is not None
    assert list(props.keys()) == ["value"]
    np.testing.assert_allclose(props["value"], [0.0, 1.0, 2.0])
    assert props["value"].dtype == np.float32


def test_dict_preserves_insertion_order_and_casts_f32():
    props = normalize_properties({"b": [1, 2], "a": [3, 4]}, 2, "test")
    assert list(props.keys()) == ["b", "a"]
    assert props["b"].dtype == np.float32


def test_empty_dict_is_none():
    assert normalize_properties({}, 5, "test") is None


def test_bare_array_bad_length_raises():
    with pytest.raises(ValueError, match="test values must have length 5"):
        normalize_properties([0.0, 1.0], 5, "test")


def test_dict_entry_bad_length_raises_with_name():
    with pytest.raises(ValueError, match=r"property 'loss'"):
        normalize_properties({"loss": [0.0, 1.0]}, 5, "test")


def test_properties_arrays_prefixed():
    props = normalize_properties({"a": [1.0], "b": [2.0]}, 1, "test")
    arrays = properties_arrays(props)
    assert set(arrays.keys()) == {"values_a", "values_b"}


def test_properties_arrays_empty_for_none():
    assert properties_arrays(None) == {}


def test_properties_metadata_order_and_stats():
    props = {"a": np.array([1.0, 2.0, 3.0], dtype=np.float32), "b": np.array([10.0, 20.0], dtype=np.float32)}
    meta = properties_metadata(props)
    assert meta == [
        {"name": "a", "min": 1.0, "max": 3.0, "mean": 2.0},
        {"name": "b", "min": 10.0, "max": 20.0, "mean": 15.0},
    ]


def test_properties_metadata_none_for_falsy():
    assert properties_metadata(None) is None
    assert properties_metadata({}) is None


def test_value_range_from_mirrors_first_property():
    meta = [
        {"name": "a", "min": 1.0, "max": 3.0, "mean": 2.0},
        {"name": "b", "min": 10.0, "max": 20.0, "mean": 15.0},
    ]
    assert value_range_from(meta) == {"min": 1.0, "max": 3.0, "mean": 2.0}


def test_value_range_from_none_for_falsy():
    assert value_range_from(None) is None
    assert value_range_from([]) is None
