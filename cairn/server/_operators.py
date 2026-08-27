"""Authoritative operator comparators (see query_grammar.py's module doc).

MIRRORED by ``cairn.sdk.reader._OPERATORS`` — pinned by
``schema/query-vectors.json``; change all mirrors together.
"""
from typing import Any, Callable

OPERATORS: dict[str, Callable[[Any, Any], bool]] = {
    "exact": lambda a, b: a == b,
    "iexact": lambda a, b: isinstance(a, str) and isinstance(b, str) and a.lower() == b.lower(),
    "gt": lambda a, b: a is not None and a > b,
    "gte": lambda a, b: a is not None and a >= b,
    "lt": lambda a, b: a is not None and a < b,
    "lte": lambda a, b: a is not None and a <= b,
    "in": lambda a, b: a in b,
    "contains": lambda a, b: (
        b in a if isinstance(a, (str, list, tuple, set)) else False
    ),
    "icontains": lambda a, b: (
        isinstance(a, str) and isinstance(b, str) and b.lower() in a.lower()
    ),
    "startswith": lambda a, b: isinstance(a, str) and a.startswith(b),
    "endswith": lambda a, b: isinstance(a, str) and a.endswith(b),
    "isnull": lambda a, b: (a is None) == bool(b),
}
