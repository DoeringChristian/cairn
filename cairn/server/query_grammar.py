"""The query grammar's AUTHORITATIVE vocabulary (refactor spec §1b/§5).

The server side OWNS the grammar — it is the endpoint that decodes and evaluates
queries. Clients carry small MIRRORS of this vocabulary (cairn-track's
``cairn.sdk.reader._OPERATORS``; cairn-ui's TS grammar), pinned by the shared
conformance vectors (``schema/query-vectors.json``) — change all of them
together.
"""

# Filter-suffix operators: ``field[.sub]__<op>=value`` on the wire,
# ``field__op=value`` kwargs in the python client.
OPERATOR_NAMES: tuple[str, ...] = (
    "exact", "iexact",
    "gt", "gte", "lt", "lte",
    "in",
    "contains", "icontains",
    "startswith", "endswith",
    "isnull",
)
