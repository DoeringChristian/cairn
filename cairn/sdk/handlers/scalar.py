"""Scalar handler — stores values inline in the ``sequences`` table."""

from __future__ import annotations

from typing import Any

import numpy as np

from ..wrappers import _TypeWrapper


class ScalarHandler:
    object_type = "scalar"
    mime_type = "application/json"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        if isinstance(obj, bool):
            return True
        if isinstance(obj, (int, float)):
            return True
        if isinstance(obj, (np.integer, np.floating)):
            return True
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        """Return an empty blob + metadata containing the scalar value.

        Callers should detect ``object_type == 'scalar'`` and write directly
        to ``sequences.scalar_value`` instead of round-tripping through the
        artifact store. This serialize() is only used if a caller insists on
        treating scalars as artifacts.
        """
        value = float(obj)
        import json

        return json.dumps({"value": value}).encode("utf-8"), {"value": value}

    def to_scalar(self, obj: Any) -> float:
        """Normalize to a Python float for DB storage."""
        return float(obj)
