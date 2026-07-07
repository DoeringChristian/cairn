"""cairn.Report — a notebook-only report container (WS-PYAPI).

**Inline-only — no server push.** `Report` has no `publish()`/reports-API
integration; the notebook itself *is* the report. It is an ordered list of
markdown blocks (`.md(text)`) and display elements (`.add(element)` — any
`cairn.plot` `Element`, or a bare plotly `Figure`) whose `_repr_html_`/
`_repr_mimebundle_` concatenates every block in order, so the whole report
renders inline the moment `r` (or the report expression) is the last thing
in a notebook cell. Sharing = sharing the notebook (or its native Jupyter/
marimo HTML export) — there is no separate cairn-server report object.

The markdown->HTML conversion here is a small, deliberately minimal
CommonMark subset (headers, paragraphs, `**bold**`/`*italic*`/`` `code` ``,
`-`/`*` bullet lists) — cairn has no markdown dependency today, and a report
preview does not need a full parser.
"""

from __future__ import annotations

import html as _html
import re
from typing import Any

from .elements import Element

_HEADER_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*]+?)\*(?!\*)")
_CODE_RE = re.compile(r"`([^`]+?)`")


def _inline_markdown(text: str) -> str:
    escaped = _html.escape(text)
    escaped = _BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    escaped = _ITALIC_RE.sub(r"<em>\1</em>", escaped)
    escaped = _CODE_RE.sub(r"<code>\1</code>", escaped)
    return escaped


def _markdown_to_html(source: str) -> str:
    """Minimal markdown -> HTML: headers, paragraphs, bullet lists, and the
    `**bold**`/`*italic*`/`` `code` `` inline spans. Not a full CommonMark
    implementation — good enough for report-preview prose."""
    lines = source.strip("\n").split("\n")
    parts: list[str] = []
    para: list[str] = []
    items: list[str] = []

    def flush_para() -> None:
        if para:
            parts.append(f"<p>{_inline_markdown(' '.join(para))}</p>")
            para.clear()

    def flush_list() -> None:
        if items:
            rendered = "".join(f"<li>{_inline_markdown(i)}</li>" for i in items)
            parts.append(f"<ul>{rendered}</ul>")
            items.clear()

    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped:
            flush_para()
            flush_list()
            continue
        header = _HEADER_RE.match(stripped)
        if header:
            flush_para()
            flush_list()
            level = len(header.group(1))
            parts.append(f"<h{level}>{_inline_markdown(header.group(2))}</h{level}>")
            continue
        if stripped.startswith("- ") or stripped.startswith("* "):
            flush_para()
            items.append(stripped[2:])
            continue
        flush_list()
        para.append(stripped)

    flush_para()
    flush_list()
    return "\n".join(parts)


def _element_html(element: Any) -> str:
    if hasattr(element, "_repr_html_"):
        return element._repr_html_()
    if hasattr(element, "to_html"):  # a bare plotly Figure
        return element.to_html(include_plotlyjs="inline", full_html=False)
    return f"<pre>{_html.escape(repr(element))}</pre>"


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
