"""Lazy-import helpers for optional handler dependencies."""

from __future__ import annotations

import importlib
from typing import Any


def try_import(name: str) -> Any | None:
    """Return the module, or ``None`` if it can't be imported for any reason.

    Some optional deps (``pynvml``, ``torch`` on some systems) raise at import
    time rather than ``ImportError``, so we broaden the except clause.
    """
    try:
        return importlib.import_module(name)
    except Exception:  # noqa: BLE001
        return None
