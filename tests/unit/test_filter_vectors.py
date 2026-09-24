"""The UI's runs-table filter (cairn-ui ``src/lib/run-filter.ts``) mirrors
``cairn/server/_operators.py``. Both run the same evaluation vectors, committed
in cairn-ui at ``docs/schemas/filter-vectors.json``."""
import json
from pathlib import Path

import pytest

from cairn.server._operators import OPERATORS
from cairn_ui.cards import spec as _cs

_VECTORS = (
    Path(_cs.__file__).resolve().parents[2] / "docs" / "schemas" / "filter-vectors.json"
)
_CASES = json.loads(_VECTORS.read_text())


def test_vectors_cover_every_operator():
    assert {c["op"] for c in _CASES} == set(OPERATORS)


@pytest.mark.parametrize("case", _CASES, ids=lambda c: f"{c['op']}:{c['field_value']!r}:{c['arg']!r}")
def test_operator_matches_vector(case):
    try:
        got = bool(OPERATORS[case["op"]](case["field_value"], case["arg"]))
    except (TypeError, ValueError):
        got = False
    assert got is case["expected"]
