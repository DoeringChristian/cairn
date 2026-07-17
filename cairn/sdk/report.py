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
import json as _json
import logging
import re
import uuid as _uuid
from pathlib import Path
from typing import Any

from .elements import Element

log = logging.getLogger(__name__)

_HEADER_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*]+?)\*(?!\*)")
_CODE_RE = re.compile(r"`([^`]+?)`")
# `[text](url)` — url is any non-space, non-`)` run. Applied to already
# HTML-escaped text (so `[`/`]`/`(`/`)` survive `html.escape`, which only
# touches `& < > " '`); the captured url is escaped too, hence attribute-safe.
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")


def _inline_markdown(text: str) -> str:
    escaped = _html.escape(text)
    escaped = _LINK_RE.sub(r'<a href="\2">\1</a>', escaped)
    escaped = _BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    escaped = _ITALIC_RE.sub(r"<em>\1</em>", escaped)
    escaped = _CODE_RE.sub(r"<code>\1</code>", escaped)
    return escaped


def _markdown_to_html(source: str) -> str:
    """Minimal markdown -> HTML: headers, paragraphs, bullet lists, fenced
    ```` ``` ```` code blocks, and the `[text](url)`/`**bold**`/`*italic*`/
    `` `code` `` inline spans. Not a full CommonMark implementation — good
    enough for report-preview prose."""
    lines = source.strip("\n").split("\n")
    parts: list[str] = []
    para: list[str] = []
    items: list[str] = []
    fence: list[str] = []
    in_fence = False

    def flush_para() -> None:
        if para:
            parts.append(f"<p>{_inline_markdown(' '.join(para))}</p>")
            para.clear()

    def flush_list() -> None:
        if items:
            rendered = "".join(f"<li>{_inline_markdown(i)}</li>" for i in items)
            parts.append(f"<ul>{rendered}</ul>")
            items.clear()

    def flush_fence() -> None:
        nonlocal in_fence
        code = _html.escape("\n".join(fence))
        parts.append(f"<pre><code>{code}</code></pre>")
        fence.clear()
        in_fence = False

    for raw_line in lines:
        if in_fence:
            # A closing fence ends the block (any info string is ignored);
            # every other line is verbatim code.
            if raw_line.strip().startswith("```"):
                flush_fence()
            else:
                fence.append(raw_line)
            continue
        stripped = raw_line.strip()
        if stripped.startswith("```"):
            flush_para()
            flush_list()
            in_fence = True
            continue
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
    if in_fence:  # unterminated fence — still emit what we collected
        flush_fence()
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


# ---------------------------------------------------------------------------
# cp.Report — a self-contained cairn-plot report (Q21).
#
# `cairn.Report` (above) is the notebook-inline card container: it concatenates
# markdown with each element's own `_repr_html_`, so a server-backed card
# renders as a live `/embed/card` iframe. `cp.Report` (`PlotReport` below) is a
# DIFFERENT deliverable — a fully self-contained HTML report built on the PURE
# `cairn-plot` renderer emit (`PlotElement`): markdown + raw-HTML + composable
# `cp.*` components, all mounted from ONE inlined renderer bundle + ONE merged
# content-addressed store, with no server round-trip and no CDN. They coexist
# case-insensitively across namespaces (`cairn.Report` vs `cairn.plot.Report`),
# same posture as `cp.Bar` (native composable) vs `cp.bar` (plotly recipe).
# ---------------------------------------------------------------------------


class PlotReport:
    """A composable, self-contained HTML report over pure ``cairn-plot`` plots.

    Chainable builders (each returns ``self``):

    * ``.md(text)`` / ``.markdown(text)`` — a markdown block (headings,
      bold/italic, inline + fenced code, lists, links), rendered to HTML at
      emit time.
    * ``.html(raw_html)`` — inject raw HTML verbatim.
    * ``.add(component)`` — append any ``cp.*`` :class:`Component`
      (Image/Line/Figure/Table/Grid/Compare/3D leaves…) or an already-built
      :class:`~cairn.sdk.elements.PlotElement`.
    * ``.grid(children, **grid_kwargs)`` — sugar for ``.add(cp.Grid(children,
      …))`` (a row/grid of components).

    Emit (``_repr_html_`` / ``_repr_mimebundle_`` / :meth:`show` / :meth:`save`)
    produces ONE self-contained document. The renderer bundle (core + only the
    figure/three/gpu-image addons any component actually needs) is inlined
    ONCE, guarded include-once; every component's baked blob is merged into ONE
    content-addressed store (deduped by content hash); then the markdown /
    raw-HTML / per-component mount ``<div>``s are interleaved in insertion
    order. A display hook NEVER raises — a missing dist or serialization
    failure degrades to a visible inline message.
    """

    def __init__(self, title: str | None = None) -> None:
        self.title = title
        # Ordered blocks: ("md", str) | ("html", str) | ("element", PlotElement).
        self._blocks: list[tuple[str, Any]] = []

    # ---- chainable builders ----

    def md(self, text: str) -> "PlotReport":
        """Append a markdown block (rendered to HTML at emit time)."""
        self._blocks.append(("md", str(text)))
        return self

    def markdown(self, text: str) -> "PlotReport":
        """Alias for :meth:`md`."""
        return self.md(text)

    def html(self, raw_html: str) -> "PlotReport":
        """Append a raw-HTML block, injected verbatim into the report."""
        self._blocks.append(("html", str(raw_html)))
        return self

    def add(self, component: Any) -> "PlotReport":
        """Append a ``cp.*`` component (or a ready ``PlotElement``)."""
        self._blocks.append(("element", self._coerce(component)))
        return self

    def grid(self, children: Any, **grid_kwargs: Any) -> "PlotReport":
        """Append a row/grid of components — sugar for ``.add(cp.Grid(...))``."""
        from .plot_components import Grid

        return self.add(Grid(children, **grid_kwargs))

    @property
    def blocks(self) -> list[tuple[str, Any]]:
        """The raw ordered ``(kind, payload)`` block list — ``kind`` is one of
        ``"md"`` / ``"html"`` / ``"element"``."""
        return list(self._blocks)

    @staticmethod
    def _coerce(component: Any) -> Any:
        """A ``cp.*`` component → the ``PlotElement`` that carries its
        bundle/store/mount; a ``PlotElement`` passes through unchanged."""
        from .elements import PlotElement
        from .plot_components import Component

        if isinstance(component, PlotElement):
            return component
        if isinstance(component, Component):
            return component._build_element()
        raise TypeError(
            "cp.Report.add(...) expects a cairn.plot Component (cp.Image / "
            "cp.Line / cp.Figure / cp.Table / cp.Grid / cp.Compare / a 3D "
            "leaf …) or a PlotElement; got "
            f"{type(component).__name__}. For prose use .md(...); for arbitrary "
            "markup use .html(...)."
        )

    # ---- emit ----

    def _elements(self) -> list[Any]:
        return [payload for kind, payload in self._blocks if kind == "element"]

    def _merged_store(self) -> dict[str, dict[str, str]]:
        """Every component's baked blobs merged into one content-addressed
        store. Keyed by content hash, so a blob shared across components (e.g.
        the same image in two cells) is stored EXACTLY once."""
        store: dict[str, dict[str, str]] = {}
        for el in self._elements():
            store.update(getattr(el, "_store", None) or {})
        return store

    def _bundle_html(self) -> str:
        """The inlined renderer bundle: the core IIFE + design-token CSS
        (always, once), plus ONLY the addons some component needs — figure
        (Plotly), three (3D), gpu-image (image/compare) — each guarded
        include-once. Nothing is emitted for a report with no components."""
        from . import _plot_bundle as pb

        els = self._elements()
        if not els:
            return ""
        css_js = pb.json_script_safe(pb.inline_core_css())
        core = pb.inline_core_js()
        parts = [
            "<script>if(!window.__cairnPlotBundleLoaded){"
            "(function(){var s=document.createElement('style');"
            f"s.textContent={css_js};document.head.appendChild(s);}})();\n"
            f"{core}\n}}</script>"
        ]
        if any(el._descriptor_has_figure() for el in els):
            parts.append(
                "<script>if(!window.__cairnPlotFigureLoaded){\n"
                f"{pb.inline_figure_addon_js()}\n}}</script>"
            )
        if any(el._descriptor_has_three() for el in els):
            parts.append(
                "<script>if(!window.__cairnPlotThreeLoaded){\n"
                f"{pb.inline_three_addon_js()}\n}}</script>"
            )
        if any(el._descriptor_has_image() for el in els):
            parts.append(
                "<script>if(!window.__cairnPlotGpuImageLoaded){\n"
                f"{pb.inline_gpu_image_addon_js()}\n}}</script>"
            )
        return "".join(parts)

    def _store_html(self) -> str:
        """The single merged content-addressed store, injected once and
        additively merged into ``window.__cairnPlotStore``."""
        from . import _plot_bundle as pb

        store = self._merged_store()
        if not store:
            return ""
        store_id = "__cairn_report_store__" + _uuid.uuid4().hex[:12]
        blob = pb.json_script_safe(store)
        eid = _json.dumps(store_id)
        return (
            f'<script type="application/cairn-plot-store+json" id="{_html.escape(store_id)}">'
            f"{blob}</script>"
            "<script>window.__cairnPlotStore=window.__cairnPlotStore||{};"
            f"Object.assign(window.__cairnPlotStore,JSON.parse(document.getElementById({eid}).textContent));"
            "</script>"
        )

    def _body_html(self) -> str:
        """The report body fragment: bundle + merged store (once, up front),
        then the interleaved markdown / raw-HTML / per-component mounts in
        insertion order. Reused verbatim by ``_repr_html_`` and :meth:`save`."""
        parts: list[str] = [self._bundle_html(), self._store_html()]
        if self.title:
            parts.append(f"<h1>{_html.escape(self.title)}</h1>")
        for kind, payload in self._blocks:
            if kind == "md":
                parts.append(_markdown_to_html(payload))
            elif kind == "html":
                parts.append(payload)
            else:  # element — reuse the PlotElement's own mount emit.
                uid = _uuid.uuid4().hex[:12]
                parts.append(
                    payload._mount_html(f"cairn-plot-{uid}", f"cairn-plot-desc-{uid}")
                )
        return "\n".join(p for p in parts if p)

    def _repr_html_(self) -> str:
        try:
            body = self._body_html()
        except Exception as exc:  # noqa: BLE001 - display hooks must never raise
            log.debug("cairn.plot report render failed: %s", exc)
            return (
                "<pre>cairn-plot: could not render this report "
                f"({_html.escape(type(exc).__name__)}: {_html.escape(str(exc))}).</pre>"
            )
        return body or "<p><em>(empty cairn.plot report)</em></p>"

    def _repr_mimebundle_(
        self, include: Any = None, exclude: Any = None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        return ({"text/html": self._repr_html_(), "text/plain": repr(self)}, {})

    def show(self) -> Any:
        """Display in a notebook (via ``IPython.display``) if available, else
        return ``self`` (so a plain-Python REPL still gets the object back)."""
        try:
            from IPython.display import display
        except Exception:  # noqa: BLE001 - not in a notebook
            return self
        display(self)
        return None

    def _full_document(self) -> str:
        """The report wrapped in a complete standalone HTML document (for
        :meth:`save`). The body fragment already carries the inlined bundle +
        store, so the file opens with no server and no network."""
        title = _html.escape(self.title) if self.title else "cairn report"
        return (
            '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f"<title>{title}</title></head><body>\n{self._body_html()}\n"
            "</body></html>\n"
        )

    def save(self, path: str | Path) -> Path:
        """Write the report as ONE self-contained ``.html`` file and return the
        path. The file is fully offline (inlined bundle, baked data, no CDN)."""
        out = Path(path)
        out.write_text(self._full_document(), encoding="utf-8")
        return out

    def __repr__(self) -> str:
        return f"<cairn.plot.Report title={self.title!r}, blocks={len(self._blocks)}>"
