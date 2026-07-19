"""cairn.Report — a notebook-only report container (WS-PYAPI).

**Inline-only — no server push.** `Report` has no `publish()`/reports-API
integration; the notebook itself *is* the report. It is an ordered list of
markdown blocks (`.md(text)`) and display elements (`.add(element)` — any
`cairn.plot` `Element`, or a bare plotly `Figure`) whose `_repr_html_`/
`_repr_mimebundle_` concatenates every block in order, so the whole report
renders inline the moment `r` (or the report expression) is the last thing
in a notebook cell. Sharing = sharing the notebook (or its native Jupyter/
marimo HTML export) — there is no separate cairn-server report object.

The markdown->HTML conversion (a small, deliberately minimal CommonMark
subset) and the self-contained :class:`~cairn.sdk.plot_report.PlotReport`
(``cp.Report``) now live in the app-decoupled :mod:`cairn.sdk.plot_report`
(P2-M1 packaging split); both are re-exported here so ``from
cairn.sdk.report import PlotReport`` and the notebook ``Report`` below keep
working unchanged.
"""

from __future__ import annotations

import html as _html
from typing import Any

from .plot_elements import Element

# Re-export the pure markdown helper + self-contained report (factored out to
# plot_report.py for the cairn-plot packaging split).
from .plot_report import (  # noqa: F401  - re-exported for zero caller changes
    PlotReport,
    _element_html,
    _inline_markdown,
    _markdown_to_html,
)


class Report(Element):
    """An ordered, notebook-inline collection of markdown + card elements.

    `name`/`project` are display-only metadata (no server identity — see
    module docstring). Renders via the standard display protocol
    (`_repr_html_`/`_repr_mimebundle_`), same as any other `Element`.
    """

    def __init__(self, name: str | None = None, *, project: str | None = None) -> None:
        self.name = name
        self.project = project
        self._blocks: list[tuple[str, Any]] = []

    def md(self, text: str) -> "Report":
        """Append a markdown prose block."""
        self._blocks.append(("md", text))
        return self

    def add(self, element: Any) -> "Report":
        """Append a display element (a `cairn.plot` `Element`, or anything
        with `_repr_html_`/`to_html`, e.g. a bare plotly `Figure`)."""
        self._blocks.append(("element", element))
        return self

    @property
    def blocks(self) -> list[tuple[str, Any]]:
        """The raw ordered ``(kind, payload)`` block list — ``kind`` is
        ``"md"`` (payload: the markdown string) or ``"element"`` (payload:
        the added object)."""
        return list(self._blocks)

    def _repr_html_(self) -> str:
        parts: list[str] = []
        if self.name:
            parts.append(f"<h1>{_html.escape(self.name)}</h1>")
        for kind, payload in self._blocks:
            parts.append(_markdown_to_html(payload) if kind == "md" else _element_html(payload))
        if not parts:
            return "<p><em>(empty cairn.Report)</em></p>"
        return "\n".join(parts)

    def __repr__(self) -> str:
        return f"Report(name={self.name!r}, project={self.project!r}, blocks={len(self._blocks)})"
