"""cp.Report — a self-contained cairn-plot HTML report (pure; P2-M1 split).

Factored out of :mod:`cairn.sdk.report` so the composable, offline report
deliverable is **pure** (stdlib + jinja2 + the pure plot modules, no cairn
app/server coupling) and moves cleanly into the ``cairn-plot`` distribution.

``cairn.Report`` (the notebook-inline, server-backed card container) stays in
:mod:`cairn.sdk.report`, which re-exports :class:`PlotReport` and the shared
markdown helper from here so ``from cairn.sdk.report import PlotReport`` keeps
working unchanged.

Rendering goes through a **Jinja2 template** (see :func:`_resolve_templates`):
``cp.Report(template="cairn")`` is the branded default; ``"minimal"`` reproduces
the historical bare emit. Templates program against a stable **context
contract** — ``{title, blocks:[{kind, html, index}], bundle_html, store_html,
meta:{generated_at, cairn_plot_version}}`` — so a report can be restyled (or
reframed per block kind, via the template's Jinja macros) without touching
Python.

The markdown->HTML conversion here is a small, deliberately dependency-free
CommonMark/GFM subset (see :func:`_markdown_to_html`) — cairn has no markdown
dependency, and a report does not need a full parser.
"""

from __future__ import annotations

import functools
import html as _html
import json as _json
import logging
import re
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_HEADER_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*]+?)\*(?!\*)")
_CODE_RE = re.compile(r"`([^`]+?)`")
# `[text](url)` — url is any non-space, non-`)` run. Applied to already
# HTML-escaped text (so `[`/`]`/`(`/`)` survive `html.escape`, which only
# touches `& < > " '`); the captured url is escaped too, hence attribute-safe.
_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")

# A list item: leading indent (for one-level nesting), a `-`/`*`/`N.` marker,
# whitespace, then the content.
_LIST_ITEM_RE = re.compile(r"^(?P<indent>[ \t]*)(?P<marker>[-*]|\d+\.)[ \t]+(?P<content>.*)$")
_ORDERED_MARKER_RE = re.compile(r"^\d+\.$")
# A horizontal rule: a bare line of 3+ `-`, `*`, or `_` (no pipes — a pipe row
# is a table, handled first).
_HR_RE = re.compile(r"^(-{3,}|\*{3,}|_{3,})$")
# A GFM table separator cell is `-`s with optional leading/trailing `:` for
# alignment; cells are pipe-separated. The `"|" in ...` guard at the call site
# keeps a bare `---` (a horizontal rule) from matching.
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$")


def _inline_markdown(text: str) -> str:
    escaped = _html.escape(text)
    escaped = _LINK_RE.sub(r'<a href="\2">\1</a>', escaped)
    escaped = _BOLD_RE.sub(r"<strong>\1</strong>", escaped)
    escaped = _ITALIC_RE.sub(r"<em>\1</em>", escaped)
    escaped = _CODE_RE.sub(r"<code>\1</code>", escaped)
    return escaped


def _is_table_sep(line: str) -> bool:
    s = line.strip()
    return "|" in s and "-" in s and _TABLE_SEP_RE.match(s) is not None


def _split_table_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in s.split("|")]


def _render_table(header: list[str], rows: list[list[str]]) -> str:
    ncol = len(header)
    thead = "".join(f"<th>{_inline_markdown(c)}</th>" for c in header)
    body = []
    for r in rows:
        cells = (r + [""] * ncol)[:ncol]
        body.append(
            "<tr>" + "".join(f"<td>{_inline_markdown(c)}</td>" for c in cells) + "</tr>"
        )
    return (
        f"<table><thead><tr>{thead}</tr></thead>"
        f"<tbody>{''.join(body)}</tbody></table>"
    )


def _render_list(list_lines: list[str]) -> str:
    """Render a contiguous run of list-item lines to ``<ul>``/``<ol>``, with one
    (or more) levels of nesting recognised by indentation."""
    items: list[dict[str, Any]] = []
    base_indent: int | None = None
    for line in list_lines:
        m = _LIST_ITEM_RE.match(line)
        if not m:  # pragma: no cover - callers pass only matched lines
            continue
        indent = len(m.group("indent").expandtabs(4))
        if base_indent is None:
            base_indent = indent
        if indent > base_indent and items:
            items[-1]["children"].append(line)
        else:
            items.append(
                {"marker": m.group("marker"), "content": m.group("content").rstrip(), "children": []}
            )
    if not items:
        return ""
    ordered = _ORDERED_MARKER_RE.match(items[0]["marker"]) is not None
    tag = "ol" if ordered else "ul"
    out = [f"<{tag}>"]
    for it in items:
        inner = _inline_markdown(it["content"])
        if it["children"]:
            out.append(f"<li>{inner}{_render_list(it['children'])}</li>")
        else:
            out.append(f"<li>{inner}</li>")
    out.append(f"</{tag}>")
    return "".join(out)


def _markdown_to_html(source: str) -> str:
    """Minimal, dependency-free markdown -> HTML.

    Block constructs: ATX headers (``#``..``######``), paragraphs, unordered
    (``-``/``*``) and ordered (``1.``) lists with one level of nested
    indentation, fenced ```` ``` ```` code blocks, GFM pipe tables (a header row
    + a ``---|---`` separator row), ``>`` blockquotes, and ``---``/``***``/
    ``___`` horizontal rules. Inline spans: ``[text](url)`` links,
    ``**bold**``, ``*italic*``, and ``` `code` ```. Not a full CommonMark
    implementation — good enough for report prose. Raw HTML is never passed
    through here (use ``cp.Report.html(...)`` for verbatim markup); everything
    is HTML-escaped before inline spans are applied."""
    lines = source.strip("\n").split("\n")
    parts: list[str] = []
    para: list[str] = []
    i = 0
    n = len(lines)

    def flush_para() -> None:
        if para:
            parts.append(f"<p>{_inline_markdown(' '.join(para))}</p>")
            para.clear()

    while i < n:
        raw = lines[i]
        stripped = raw.strip()

        # Fenced code block — verbatim until the closing fence (or EOF).
        if stripped.startswith("```"):
            flush_para()
            i += 1
            code_lines: list[str] = []
            while i < n and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # step past the closing fence (or past EOF)
            code = _html.escape("\n".join(code_lines))
            parts.append(f"<pre><code>{code}</code></pre>")
            continue

        if not stripped:
            flush_para()
            i += 1
            continue

        header = _HEADER_RE.match(stripped)
        if header:
            flush_para()
            level = len(header.group(1))
            parts.append(f"<h{level}>{_inline_markdown(header.group(2))}</h{level}>")
            i += 1
            continue

        # Horizontal rule (checked before tables so a bare `---` never looks
        # like a separator row).
        if _HR_RE.match(stripped):
            flush_para()
            parts.append("<hr>")
            i += 1
            continue

        # GFM table: a pipe-bearing header row immediately followed by a
        # separator row.
        if "|" in stripped and i + 1 < n and _is_table_sep(lines[i + 1]):
            flush_para()
            header_cells = _split_table_row(stripped)
            i += 2  # consume the header + separator rows
            body_rows: list[list[str]] = []
            while i < n and lines[i].strip() and "|" in lines[i]:
                body_rows.append(_split_table_row(lines[i]))
                i += 1
            parts.append(_render_table(header_cells, body_rows))
            continue

        # Blockquote — a run of `>`-prefixed lines.
        if stripped.startswith(">"):
            flush_para()
            quote: list[str] = []
            while i < n and lines[i].strip().startswith(">"):
                q = lines[i].strip()[1:]
                if q.startswith(" "):
                    q = q[1:]
                quote.append(q)
                i += 1
            inner = _inline_markdown(" ".join(q for q in quote if q.strip()))
            parts.append(f"<blockquote><p>{inner}</p></blockquote>")
            continue

        # List (ordered/unordered, possibly nested) — a run of item lines.
        if _LIST_ITEM_RE.match(raw):
            flush_para()
            list_lines: list[str] = []
            while i < n and _LIST_ITEM_RE.match(lines[i]):
                list_lines.append(lines[i])
                i += 1
            parts.append(_render_list(list_lines))
            continue

        para.append(stripped)
        i += 1

    flush_para()
    return "\n".join(parts)


def _element_html(element: Any) -> str:
    if hasattr(element, "_repr_html_"):
        return element._repr_html_()
    if hasattr(element, "to_html"):  # a bare plotly Figure
        return element.to_html(include_plotlyjs="inline", full_html=False)
    return f"<pre>{_html.escape(repr(element))}</pre>"


def _element_is_grid(element: Any) -> bool:
    """Whether a ``PlotElement``'s descriptor is a grid tree (its ``root`` node
    has ``kind == "grid"``) — used to tag its report block ``"grid"`` vs
    ``"component"`` for the template context."""
    try:
        root = element._descriptor_dict().get("root")
    except Exception:  # noqa: BLE001 - never break the display path
        return False
    return isinstance(root, dict) and root.get("kind") == "grid"


def _cairn_plot_version() -> str:
    try:
        from . import __version__

        return str(__version__)
    except Exception:  # noqa: BLE001 - version is cosmetic (meta line)
        return "unknown"


# ---------------------------------------------------------------------------
# Templating (Jinja2)
# ---------------------------------------------------------------------------

_BUILTIN_TEMPLATES = ("cairn", "minimal")


@functools.lru_cache(maxsize=1)
def _package_env() -> Any:
    """The shared Jinja2 environment over the packaged ``cairn_plot/templates``
    tree (built-in ``cairn`` + ``minimal`` themes). ``autoescape`` is OFF: block
    HTML in the context is already rendered+escaped (markdown / raw-HTML / mount
    emit), and templates escape plain-text fields (``title``, ``meta``)
    explicitly with ``| e``."""
    import jinja2

    return jinja2.Environment(
        loader=jinja2.PackageLoader("cairn_plot", "templates"),
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
    )


def _resolve_templates(template: Any) -> tuple[Any, Any]:
    """Resolve ``template`` to a ``(page, fragment)`` pair of Jinja2 templates.

    Accepts a built-in name (``"cairn"``/``"minimal"``), a filesystem path to a
    directory holding ``page.html.j2`` + ``fragment.html.j2``, a
    ``jinja2.Environment`` (loaded from its loader), or a single
    ``jinja2.Template`` (used for both page and fragment)."""
    import jinja2

    if isinstance(template, jinja2.Environment):
        return (
            template.get_template("page.html.j2"),
            template.get_template("fragment.html.j2"),
        )
    if isinstance(template, jinja2.Template):
        return template, template

    name = str(template)
    if name in _BUILTIN_TEMPLATES:
        env = _package_env()
        return (
            env.get_template(f"{name}/page.html.j2"),
            env.get_template(f"{name}/fragment.html.j2"),
        )

    path = Path(name).expanduser()
    if path.is_dir():
        env = jinja2.Environment(
            loader=jinja2.FileSystemLoader(str(path)),
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
        )
        try:
            return (
                env.get_template("page.html.j2"),
                env.get_template("fragment.html.j2"),
            )
        except jinja2.TemplateNotFound as exc:
            raise ValueError(
                f"report template directory {path} is missing "
                f"{exc.name!r} (a template dir must contain page.html.j2 "
                "and fragment.html.j2)."
            ) from exc

    raise ValueError(
        f"unknown report template {name!r}: expected a built-in name "
        f"({', '.join(_BUILTIN_TEMPLATES)}), a path to a template directory "
        "containing page.html.j2 + fragment.html.j2, or a jinja2 "
        "Environment/Template."
    )


# ---------------------------------------------------------------------------
# cp.Report — a self-contained cairn-plot report (Q21).
#
# `cairn.Report` (in ``report.py``) is the notebook-inline card container: it
# concatenates markdown with each element's own `_repr_html_`, so a
# server-backed card renders as a live `/embed/card` iframe. `cp.Report`
# (`PlotReport` below) is a DIFFERENT deliverable — a fully self-contained HTML
# report built on the PURE `cairn-plot` renderer emit (`PlotElement`): markdown
# + raw-HTML + composable `cp.*` components, all mounted from ONE inlined
# renderer bundle + ONE merged content-addressed store, with no server
# round-trip and no CDN. They coexist case-insensitively across namespaces
# (`cairn.Report` vs `cairn.plot.Report`), same posture as `cp.Bar` (native
# composable) vs `cp.bar` (plotly recipe).
# ---------------------------------------------------------------------------


class PlotReport:
    """A composable, self-contained HTML report over pure ``cairn-plot`` plots.

    Chainable builders (each returns ``self``):

    * ``.md(text)`` / ``.markdown(text)`` — a markdown block (headings,
      bold/italic, inline + fenced code, ordered/unordered/nested lists, GFM
      tables, blockquotes, rules, links), rendered to HTML at emit time.
    * ``.html(raw_html)`` — inject raw HTML verbatim.
    * ``.add(component)`` — append any ``cp.*`` :class:`Component`
      (Image/Line/Figure/Table/Grid/Compare/3D leaves…) or an already-built
      :class:`~cairn.sdk.plot_elements.PlotElement`.
    * ``.grid(children, **grid_kwargs)`` — sugar for ``.add(cp.Grid(children,
      …))`` (a row/grid of components).

    Emit (``_repr_html_`` / ``_repr_mimebundle_`` / :meth:`show` / :meth:`save`)
    renders through a **Jinja2 template** (``template=`` — default ``"cairn"``,
    the branded theme; ``"minimal"`` for a bare, embedding-friendly emit; or a
    template dir / ``jinja2.Environment``/``Template`` for full control). The
    renderer bundle (core + only the figure/three/gpu-image addons any component
    actually needs) is inlined ONCE, guarded include-once; every component's
    baked blob is merged into ONE content-addressed store (deduped by content
    hash); markdown / raw-HTML / per-component mounts are handed to the template
    as ordered blocks. A display hook NEVER raises — a missing dist or
    serialization failure degrades to a visible inline message.
    """

    def __init__(self, title: str | None = None, template: Any = "cairn") -> None:
        self.title = title
        self.template = template
        # Ordered blocks: ("md", str) | ("html", str) | ("element", PlotElement).
        self._blocks: list[tuple[str, Any]] = []
        # Resolve eagerly so a bad template name/dir fails at construction with
        # a clear error (not deep inside a display hook).
        self._page_template, self._fragment_template = _resolve_templates(template)

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
        from .components import Grid

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
        from .components import Component
        from .elements import PlotElement

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
        from . import bundle as pb

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
        from . import bundle as pb

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

    def _block_contexts(self) -> list[dict[str, Any]]:
        """The ordered blocks as template context: each ``{kind, html, index}``
        where ``kind`` is ``"md"``/``"html"``/``"component"``/``"grid"`` and
        ``html`` is the already-rendered inner HTML (markdown → HTML, raw markup
        verbatim, or a component's mount ``<div>`` + descriptor script)."""
        out: list[dict[str, Any]] = []
        for index, (kind, payload) in enumerate(self._blocks):
            if kind == "md":
                out.append({"kind": "md", "html": _markdown_to_html(payload), "index": index})
            elif kind == "html":
                out.append({"kind": "html", "html": payload, "index": index})
            else:  # element — reuse the PlotElement's own mount emit.
                uid = _uuid.uuid4().hex[:12]
                mount = payload._mount_html(f"cairn-plot-{uid}", f"cairn-plot-desc-{uid}")
                block_kind = "grid" if _element_is_grid(payload) else "component"
                out.append({"kind": block_kind, "html": mount, "index": index})
        return out

    def _context(self) -> dict[str, Any]:
        """The stable template context contract (see module docstring)."""
        return {
            "title": self.title,
            "blocks": self._block_contexts(),
            "bundle_html": self._bundle_html(),
            "store_html": self._store_html(),
            "meta": {
                "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                "cairn_plot_version": _cairn_plot_version(),
            },
        }

    def _repr_html_(self) -> str:
        try:
            return self._fragment_template.render(**self._context())
        except Exception as exc:  # noqa: BLE001 - display hooks must never raise
            log.debug("cairn.plot report render failed: %s", exc)
            return (
                "<pre>cairn-plot: could not render this report "
                f"({_html.escape(type(exc).__name__)}: {_html.escape(str(exc))}).</pre>"
            )

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
        """The report rendered as a complete standalone HTML document (for
        :meth:`save`), via the active template's ``page.html.j2``. The body
        already carries the inlined bundle + store, so the file opens with no
        server and no network."""
        return self._page_template.render(**self._context())

    def save(self, path: str | Path) -> Path:
        """Write the report as ONE self-contained ``.html`` file and return the
        path. The file is fully offline (inlined bundle, baked data, no CDN)."""
        out = Path(path)
        out.write_text(self._full_document(), encoding="utf-8")
        return out

    def __repr__(self) -> str:
        return f"<cairn.plot.Report title={self.title!r}, blocks={len(self._blocks)}>"
