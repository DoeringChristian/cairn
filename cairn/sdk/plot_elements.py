"""Compatibility shim — the pure display objects moved to
:mod:`cairn_plot.elements` (P2-M2 packaging split).

Re-exported here so ``from cairn.sdk.plot_elements import Element/HtmlElement/
PlotElement`` (used by ``cairn.sdk.elements`` and ``cairn.sdk.report``) keeps
working unchanged.
"""

from __future__ import annotations

from cairn_plot.elements import (  # noqa: F401 - re-exported for zero caller changes
    Element,
    HtmlElement,
    PlotElement,
)
