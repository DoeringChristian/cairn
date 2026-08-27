"""The query grammar's mirrors may never drift (refactor spec §1b).

The server owns the grammar (cairn.server.query_grammar / _operators);
cairn-track's reader carries a marked mirror. Both are pinned to the shared
vectors fixture. The TS mirror is pinned by the same file from the UI's test
suite.
"""
import json
from pathlib import Path

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "schema" / "query-vectors.json").read_text())


def test_server_operator_names_match_vectors():
    from cairn.server.query_grammar import OPERATOR_NAMES

    assert list(OPERATOR_NAMES) == VECTORS["operators"]


def test_server_comparators_cover_exactly_the_vocabulary():
    from cairn.server._operators import OPERATORS
    from cairn.server.query_grammar import OPERATOR_NAMES

    assert set(OPERATORS) == set(OPERATOR_NAMES)


def test_track_mirror_matches_server_vocabulary():
    from cairn.sdk.reader import _OPERATORS

    assert set(_OPERATORS) == set(VECTORS["operators"])
