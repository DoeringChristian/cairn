"""Compatibility shim — the pure ``cp.Report`` deliverable moved to
:mod:`cairn_plot.report` (P2-M2 packaging split).

Re-exported here so ``from cairn.sdk.plot_report import PlotReport`` and the
markdown helpers (``_markdown_to_html`` / ``_inline_markdown`` /
``_element_html``) that ``cairn.sdk.report`` consumes keep working unchanged.
"""

from __future__ import annotations

from cairn_plot.report import (  # noqa: F401 - re-exported for zero caller changes
    PlotReport,
    _element_html,
    _inline_markdown,
    _markdown_to_html,
)
