"""Compatibility shim — the pure plot-descriptor pydantic models moved to
:mod:`cairn_plot.spec` (P2-M2 packaging split).

Re-exported here so ``from cairn.sdk.plot_spec import ...`` and
``card_spec.py``'s ``from .plot_spec import *`` (plus the ``_Strict`` /
``_SyncSpec`` privates the app-card models share) keep working unchanged.
"""

from __future__ import annotations

from cairn_plot.spec import *  # noqa: F401,F403
from cairn_plot.spec import (  # noqa: F401 - explicit underscore re-exports
    _Strict,
    _SyncSpec,
)
