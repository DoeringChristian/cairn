"""Table handler — JSON serialization, type inference, row cap."""

from __future__ import annotations

import json

import pytest

from cairn.sdk.handlers import default_registry
from cairn.sdk.handlers.table import MAX_ROWS, TableHandler
from cairn.sdk.wrappers import Table


def _serialize(**kwargs):
    h = TableHandler()
    wrapper = Table(**kwargs)
    return h.serialize(wrapper.obj)


def test_wrapper_finds_table_handler():
    h = default_registry.find_handler(Table(columns=["a"], data=[[1]]))
    assert h is not None and h.object_type == "table"


def test_columns_data_roundtrip():
    data, meta = _serialize(
        columns=["epoch", "loss", "ok"],
        data=[[0, 1.5, False], [1, 0.5, True]],
    )
    payload = json.loads(data)
    assert [c["name"] for c in payload["columns"]] == ["epoch", "loss", "ok"]
    assert payload["data"] == [[0, 1.5, False], [1, 0.5, True]]
    assert meta["n_rows"] == 2
    assert meta["n_cols"] == 3
    assert meta["columns"] == ["epoch", "loss", "ok"]
    assert meta["truncated"] is False


def test_type_inference():
    _, _ = _serialize(columns=["a"], data=[[1]])
    data, _ = _serialize(
        columns=["ints", "floats", "strs", "bools", "mixed"],
        data=[
            [1, 1.0, "x", True, 1],
            [2, 2.5, "y", False, "z"],
        ],
    )
    types = {c["name"]: c["type"] for c in json.loads(data)["columns"]}
    assert types["ints"] == "number"
    assert types["floats"] == "number"
    assert types["strs"] == "string"
    assert types["bools"] == "bool"
    assert types["mixed"] == "other"


def test_non_native_values_stringified():
    class Weird:
        def __str__(self) -> str:
            return "weird!"

    data, _ = _serialize(columns=["obj"], data=[[Weird()]])
    payload = json.loads(data)
    assert payload["data"] == [["weird!"]]
    assert payload["columns"][0]["type"] == "other"


def test_nan_and_inf_become_null():
    data, _ = _serialize(columns=["x"], data=[[float("nan")], [float("inf")], [1.0]])
    payload = json.loads(data)
    assert payload["data"] == [[None], [None], [1.0]]
    # A column of numbers with nulls is still a number column.
    assert payload["columns"][0]["type"] == "number"


def test_row_cap_truncates():
    n = MAX_ROWS + 500
    data, meta = _serialize(columns=["i"], data=[[i] for i in range(n)])
    payload = json.loads(data)
    assert len(payload["data"]) == MAX_ROWS
    assert payload["truncated"] is True
    assert meta["truncated"] is True
    assert meta["n_rows"] == MAX_ROWS
    assert meta["original_n_rows"] == n


def test_metadata_caps_column_names_at_20():
    cols = [f"c{i}" for i in range(30)]
    _, meta = _serialize(columns=cols, data=[list(range(30))])
    assert meta["columns"] == cols[:20]
    assert meta["n_cols"] == 30


def test_dataframe_input():
    pd = pytest.importorskip("pandas")
    df = pd.DataFrame({"a": [1, 2], "b": ["x", "y"]})
    data, meta = _serialize(dataframe=df)
    payload = json.loads(data)
    assert [c["name"] for c in payload["columns"]] == ["a", "b"]
    assert payload["data"] == [[1, "x"], [2, "y"]]
    assert meta["n_rows"] == 2


def test_can_handle_only_via_wrapper():
    h = TableHandler()
    assert not h.can_handle([[1, 2], [3, 4]])
    assert not h.can_handle({"columns": [], "data": []})


def test_deserialize_roundtrip():
    h = TableHandler()
    data, _ = _serialize(columns=["a"], data=[[1], [2]])
    back = h.deserialize(data)
    assert back["data"] == [[1], [2]]
