"""Table handler — columns + rows → compact JSON blob.

Dispatches only via the ``cairn.Table`` wrapper (a bare ``list``/``dict`` is
ambiguous and already claimed by other handlers, so ``can_handle`` is always
False). The blob is::

    {"columns": [{"name": str, "type": "number"|"string"|"bool"|"other"}],
     "data": [[...], ...],
     "truncated": bool}   # only present when the row cap was hit

Values are coerced to JSON-native types; anything else is ``str()``-ed. Rows are
capped at ``MAX_ROWS`` at log time (the original count lands in metadata). The
metadata carries everything the card header needs without fetching the blob:
``n_rows``, ``n_cols`` and the first 20 column names.
"""

from __future__ import annotations

import json
import math
from typing import Any

import numpy as np

from ._optional import try_import

MAX_ROWS = 10_000


def _classify(value: Any) -> str:
    """Classify a single non-null value into a column-type bucket."""
    # bool must be checked before int (bool is an int subclass).
    if isinstance(value, (bool, np.bool_)):
        return "bool"
    if isinstance(value, (int, float, np.integer, np.floating)):
        return "number"
    if isinstance(value, str):
        return "string"
    return "other"


def _coerce(value: Any) -> Any:
    """Coerce a value to something json-native, matching its classification."""
    if value is None:
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        f = float(value)
        # JSON has no NaN/Inf — drop them to null so the blob stays valid.
        return f if math.isfinite(f) else None
    if isinstance(value, str):
        return value
    return str(value)


def _is_null(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, np.floating) and np.isnan(value):
        return True
    return False


class TableHandler:
    object_type = "table"
    mime_type = "application/json"

    def can_handle(self, obj: Any) -> bool:
        # Explicit via cairn.Table only — list/dict are ambiguous/claimed.
        return False

    def _normalize(self, obj: Any) -> tuple[list[str], list[list[Any]]]:
        """Return ``(column_names, rows)`` from the wrapper's stored inputs."""
        if not isinstance(obj, dict):
            raise TypeError(
                "Table handler expects a cairn.Table wrapper; got "
                f"{type(obj).__name__}"
            )
        dataframe = obj.get("dataframe")
        columns = obj.get("columns")
        data = obj.get("data")

        if dataframe is not None:
            pd = try_import("pandas")
            if pd is None or not isinstance(dataframe, pd.DataFrame):
                raise TypeError(
                    "cairn.Table(dataframe=...) requires a pandas DataFrame "
                    "(install pandas)."
                )
            names = [str(c) for c in dataframe.columns]
            rows = [list(row) for row in dataframe.itertuples(index=False, name=None)]
            return names, rows

        if data is None:
            data = []
        rows = [list(r) for r in data]
        if columns is not None:
            names = [str(c) for c in columns]
        else:
            width = max((len(r) for r in rows), default=0)
            names = [f"col{i}" for i in range(width)]
        return names, rows

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        names, rows = self._normalize(obj)

        total_rows = len(rows)
        truncated = total_rows > MAX_ROWS
        if truncated:
            rows = rows[:MAX_ROWS]

        # Infer one type per column from its non-null values.
        col_types: list[str] = []
        for c in range(len(names)):
            seen: set[str] = set()
            for row in rows:
                v = row[c] if c < len(row) else None
                if _is_null(v):
                    continue
                seen.add(_classify(v))
                if len(seen) > 1:
                    break
            col_types.append(next(iter(seen)) if len(seen) == 1 else "other")

        json_rows = [
            [_coerce(row[c] if c < len(row) else None) for c in range(len(names))]
            for row in rows
        ]

        payload: dict[str, Any] = {
            "columns": [
                {"name": n, "type": t} for n, t in zip(names, col_types)
            ],
            "data": json_rows,
        }
        if truncated:
            payload["truncated"] = True

        blob = json.dumps(payload, separators=(",", ":")).encode("utf-8")

        meta: dict[str, Any] = {
            "n_rows": len(json_rows),
            "n_cols": len(names),
            "columns": names[:20],
            "truncated": truncated,
        }
        if truncated:
            meta["original_n_rows"] = total_rows
        return blob, meta

    def deserialize(
        self, data: bytes, metadata: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Parse JSON bytes back into the ``{columns, data}`` dict."""
        return json.loads(data.decode("utf-8"))
