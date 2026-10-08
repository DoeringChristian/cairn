"""Run sets (``cairn.server.run_sets``) mirror cairn-ui ``src/lib/run-sets.ts``:
both run the vectors committed in cairn-ui at
``docs/schemas/run-set-vectors.json``."""

import json
from pathlib import Path

import pytest

from cairn.server import run_sets as rs
from cairn_ui.cards import spec as _cs

_VECTORS = Path(_cs.__file__).resolve().parents[2] / "docs" / "schemas" / "run-set-vectors.json"
_DOC = json.loads(_VECTORS.read_text())


@pytest.mark.parametrize("case", _DOC["cases"], ids=lambda c: c["name"])
def test_run_set_vectors(case):
    run_set = rs.parse_run_set(case["set"])
    assert rs.resolve_run_set(run_set, _DOC["pools"][case["pool"]]) == case["expected"]


def test_parse_run_set_defaults():
    assert rs.parse_run_set("nope") is None
    got = rs.parse_run_set({"filter": {"kind": "chip"}, "groupBy": [{"source": "x"}, {"source": "group"}],
                            "sort": [{"column": "", "direction": "asc"}], "eyes": {"r:a": 1, "r:b": False}}, 1)
    assert got == {
        "name": "Run set 2", "filter": {"kind": "group", "op": "and", "children": []},
        "groupBy": [{"source": "group"}], "latestOnly": False,
        "sort": [{"column": "created_at", "direction": "desc"}], "eyes": {"r:b": False},
    }


def test_text_sort_is_numeric_and_case_insensitive():
    assert rs.compare_values("run-2", "run-10") < 0
    assert rs.compare_values("Alpha", "alpha") == 0
    assert rs.compare_values(1, "a") < 0 and rs.compare_values(True, 0.5) > 0
