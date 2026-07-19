"""Pure display objects for the ``cairn.plot`` path (P2-M1 packaging split).

Factored out of :mod:`cairn.sdk.elements` so the plot-only surface is
**pure** (stdlib + :mod:`cairn.sdk._plot_bundle`, no cairn app/server
coupling) and moves cleanly into the ``cairn-plot`` distribution at M2.

Contains:

* :class:`Element` — the shared display-protocol base (``_repr_html_`` /
  ``_repr_mimebundle_``) every standalone-renderable cairn Python object
  implements, per ``docs/superpowers/specs/2026-07-07-notebook-python-and-
  embed.md`` §5/§11.
* :class:`HtmlElement` — a self-contained HTML snapshot (a Plotly
  ``fig.to_html()``, a rendered table, …). No server round trip, ever.
* :class:`PlotElement` — the plots-only display object that mounts a PURE
  ``cairn-plot`` renderer (WS-PLOT / design spec §6): the default return of
  the ``cairn.plot.*`` builders.

The **server-backed** :class:`~cairn.sdk.elements.CardElement` stays in
:mod:`cairn.sdk.elements` (it needs ``cairn.config`` + server discovery), which
re-exports :class:`Element`/:class:`HtmlElement`/:class:`PlotElement` from here
so every existing ``from cairn.sdk.elements import PlotElement`` keeps working.
"""

from __future__ import annotations

import html as _html
import json
import logging
from typing import Any

log = logging.getLogger(__name__)


class Element:
    """Base class for standalone-renderable cairn Python objects.

    Subclasses implement ``_repr_html_``; the mimebundle/marimo hooks are
    thin wrappers around it (marimo and modern Jupyter both understand
    ``_repr_mimebundle_``; classic/nbconvert falls back to ``_repr_html_``
    directly).
    """

    def _repr_html_(self) -> str:  # pragma: no cover - abstract
        raise NotImplementedError

    def _repr_mimebundle_(
        self, include: Any = None, exclude: Any = None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        return (
            {"text/html": self._repr_html_(), "text/plain": repr(self)},
            {},
        )


class HtmlElement(Element):
    """A self-contained HTML snapshot. No server round trip, ever.

    Used for the raw-data fallback path (a plain Plotly ``Figure``, a
    rendered table, ...) — see the module docstring and ``cairn/plot.py``.
    """

    def __init__(self, html_str: str, *, label: str = "element") -> None:
        self._html = html_str
        self._label = label

    def _repr_html_(self) -> str:
        return self._html

    def __repr__(self) -> str:
        return f"<cairn.plot.{self._label} (self-contained HTML, no server needed)>"


def _node_has_figure(node: Any) -> bool:
    """Recursively: does this ``PlotNode`` dict (leaf/grid/compare) contain a
    ``figure`` renderer? Only ``plot`` leaves carry a renderer; ``compare`` frames
    are images, never figures."""
    if not isinstance(node, dict):
        return False
    if node.get("kind") == "plot":
        return node.get("renderer") == "figure"
    if node.get("kind") == "grid":
        return any(_node_has_figure(c) for c in node.get("children", []))
    return False


# The three.js renderer names (the 3D types the `three` addon carries).
_THREE_RENDERERS = frozenset({"mesh", "volume", "pointcloud", "boxes3d"})


def _node_has_three(node: Any) -> bool:
    """Recursively: does this ``PlotNode`` dict contain a three.js 3D renderer?
    ``plot`` leaves carry a ``renderer``; ``grid`` recurses its children;
    ``compare`` frames are ``DataSpec``s — a 3D compare (G3c) carries ``npz``
    frames, so check ``a``/``b`` kinds (forward-looking; harmless today)."""
    if not isinstance(node, dict):
        return False
    kind = node.get("kind")
    if kind == "plot":
        return node.get("renderer") in _THREE_RENDERERS
    if kind == "grid":
        return any(_node_has_three(c) for c in node.get("children", []))
    if kind == "compare":
        return any(
            isinstance(node.get(f), dict) and node[f].get("kind") == "npz"
            for f in ("a", "b")
        )
    return False


# The 2D image renderer names (the types the `gpu-image` engine addon can
# accelerate — Task 8 of the WebGPU engine, Sub-project 1).
_IMAGE_RENDERERS = frozenset({"image", "imagehdr"})


def _node_has_image(node: Any) -> bool:
    """Recursively: does this ``PlotNode`` dict need the WebGPU/WebGL2 image
    engine addon? True for a ``plot`` leaf whose renderer is
    ``image``/``imagehdr``, for ANY ``compare`` node (split/blend/diff compare
    always renders two images — via ``CompositeMediaPane``, which routes to
    the engine-backed ``GpuComparePane`` the same addon carries, once it's
    loaded), and recursively through ``grid`` children. Mirrors
    ``_node_has_figure``/``_node_has_three``'s shape."""
    if not isinstance(node, dict):
        return False
    kind = node.get("kind")
    if kind == "plot":
        return node.get("renderer") in _IMAGE_RENDERERS
    if kind == "grid":
        return any(_node_has_image(c) for c in node.get("children", []))
    if kind == "compare":
        return True
    return False


class PlotElement(Element):
    """A plots-only display object that mounts a PURE ``cairn-plot`` renderer
    (WS-PLOT / design spec §6) — the default return of the ``cairn.plot.*``
    builders, replacing the ``/embed/card`` iframe (``CardElement``).

    It emits, plotly-``include_plotlyjs``-style, three include-once-guarded
    pieces per page (design spec §5–§7):

      1. the **renderer bundle** — the self-contained IIFE + design-token CSS
         inlined ONCE (LOCAL default, ``bundle="inline"``, offline), guarded by
         ``window.__cairnPlotBundleLoaded``; or a ``<script type=module
         src=…/assets/plot-*.js>`` linked from a reachable server
         (``bundle="link"``, the ENDPOINT companion, deduped by module URL);
      2. the **content-addressed store** (LOCAL only) — the baked binary blobs
         (image/npz bytes) merged additively into ``window.__cairnPlotStore``;
      3. the **mount** — a ``<div>`` + the descriptor
         ``<script application/cairn-plot+json>`` + a queue ``push`` so N plots
         mount independently on one page.

    A display hook NEVER raises: a missing dist / serialization failure
    degrades to a visible inline message.
    """

    def __init__(
        self,
        spec: Any,
        *,
        store: dict[str, dict[str, str]] | None = None,
        bundle: str = "inline",
        server: str | None = None,
        label: str = "plot",
        height: int | None = None,
    ) -> None:
        self.spec = spec  # a PlotSpec (plot_spec.PlotSpec) or a plain dict
        self._store = store or {}
        self._bundle = bundle
        self._server = server
        self._label = label
        self._height = height

    # ---- serialization ----

    def _descriptor_dict(self) -> dict[str, Any]:
        spec = self.spec
        if hasattr(spec, "model_dump"):
            return spec.model_dump(exclude_none=True, mode="json")
        return dict(spec)

    def _renderer_name(self) -> str:
        try:
            return str(self._descriptor_dict().get("renderer", ""))
        except Exception:  # noqa: BLE001 - never break the display path
            return ""

    def _descriptor_has_figure(self) -> bool:
        """Whether the descriptor carries a ``figure`` renderer ANYWHERE — a flat
        leaf (``renderer=="figure"``) OR a ``figure`` leaf nested in the recursive
        ``root`` tree (grid/compare). Gates the Plotly figure addon so a tree that
        contains a figure still inlines Plotly, while a scalar/table/image tree
        never does."""
        try:
            desc = self._descriptor_dict()
        except Exception:  # noqa: BLE001 - never break the display path
            return False
        if desc.get("renderer") == "figure":
            return True
        root = desc.get("root")
        return _node_has_figure(root) if isinstance(root, dict) else False

    def _descriptor_has_three(self) -> bool:
        """Whether the descriptor carries a three.js 3D renderer ANYWHERE — a
        flat leaf OR a 3D leaf nested in the recursive ``root`` tree. Gates the
        three.js addon so a 2D/table/image tree never inlines three."""
        try:
            desc = self._descriptor_dict()
        except Exception:  # noqa: BLE001 - never break the display path
            return False
        if desc.get("renderer") in _THREE_RENDERERS:
            return True
        root = desc.get("root")
        return _node_has_three(root) if isinstance(root, dict) else False

    def _descriptor_has_image(self) -> bool:
        """Whether the descriptor needs the ``gpu-image`` engine addon
        (Task 8): a flat ``image``/``imagehdr`` leaf, OR an ``image``/
        ``imagehdr``/``compare`` node nested ANYWHERE in the recursive
        ``root`` tree. Gates the WebGPU/WebGL2 addon so a scalar/table/
        figure/3D-only tree never carries it."""
        try:
            desc = self._descriptor_dict()
        except Exception:  # noqa: BLE001 - never break the display path
            return False
        if desc.get("renderer") in _IMAGE_RENDERERS:
            return True
        root = desc.get("root")
        return _node_has_image(root) if isinstance(root, dict) else False

    # ---- rendering ----

    def _bundle_html(self) -> str:
        from . import bundle as pb

        if self._bundle == "link":
            server = (self._server or "").rstrip("/")
            if not server:
                raise ValueError("PlotElement(bundle='link') requires a server URL")
            js_url, css_url = pb.link_asset_urls(server)
            css_tag = (
                f'<link rel="stylesheet" href="{_html.escape(css_url)}">' if css_url else ""
            )
            # A module is evaluated once per URL per realm, so repeating this
            # across cells is naturally include-once.
            return (
                f"{css_tag}"
                f'<script type="module" src="{_html.escape(js_url)}" crossorigin></script>'
            )

        # inline (default): one guarded classic <script> injects the CSS as a
        # <style> then runs the CORE IIFE (which sets __cairnPlotBundleLoaded).
        # O2: this is the CORE bundle only — NO Plotly. The figure addon is
        # emitted separately (see `_figure_addon_html`) and only for `figure`.
        css_js = pb.json_script_safe(pb.inline_core_css())
        js = pb.inline_core_js()
        return (
            "<script>if(!window.__cairnPlotBundleLoaded){"
            "(function(){var s=document.createElement('style');"
            f"s.textContent={css_js};document.head.appendChild(s);}})();\n"
            f"{js}\n}}</script>"
        )

    def _figure_addon_html(self) -> str:
        """The Plotly `figure` addon IIFE, guarded include-once by
        `window.__cairnPlotFigureLoaded`. Emitted ONLY for a `figure` element
        (inline mode) — so a scalar/table/image plot never carries Plotly. The
        addon reuses core's React (`window.__cairnPlotReact`), so it MUST come
        after `_bundle_html` (the core script) in the emitted HTML."""
        if self._bundle != "inline" or not self._descriptor_has_figure():
            return ""
        from . import bundle as pb

        js = pb.inline_figure_addon_js()
        return f"<script>if(!window.__cairnPlotFigureLoaded){{\n{js}\n}}</script>"

    def _three_addon_html(self) -> str:
        """The three.js 3D addon IIFE, guarded include-once by
        `window.__cairnPlotThreeLoaded`. Emitted ONLY for a 3D element (inline
        mode) — so 2D/table/image plots never carry three. Like the figure
        addon, it reuses core's React (`window.__cairnPlotReact`), so it MUST
        come after `_bundle_html` (the core script) in the emitted HTML."""
        if self._bundle != "inline" or not self._descriptor_has_three():
            return ""
        from . import bundle as pb

        js = pb.inline_three_addon_js()
        return f"<script>if(!window.__cairnPlotThreeLoaded){{\n{js}\n}}</script>"

    def _gpu_image_addon_html(self) -> str:
        """The engine-backed image/compare addon IIFE (WebGPU/WebGL2 RHI +
        ``GpuImagePane``/``GpuComparePane``, Task 8 of the WebGPU engine
        Sub-project), guarded include-once by
        ``window.__cairnPlotGpuImageLoaded``. Emitted ONLY when the
        descriptor contains an ``image``/``imagehdr`` leaf or a ``compare``
        node ANYWHERE — so a scalar/table/figure/3D-only tree never carries
        it. Like the figure/three addons, it reuses core's React, so it MUST
        come after `_bundle_html` (the core script).

        The addon is CAPABILITY-GATED at runtime (see
        ``plot-gpu-image-addon.tsx``): if ``getSharedDevice()`` finds neither
        WebGPU nor WebGL2 (or the page opts out via
        ``window.__cairnPlotUseGpuImage = false``), the legacy CPU
        ``ImagePane``/``HdrImagePane``/compositor path core already
        registered stays in place — this script never throws, it just
        no-ops."""
        if self._bundle != "inline" or not self._descriptor_has_image():
            return ""
        from . import bundle as pb

        js = pb.inline_gpu_image_addon_js()
        return f"<script>if(!window.__cairnPlotGpuImageLoaded){{\n{js}\n}}</script>"

    def _store_html(self, store_id: str) -> str:
        from . import bundle as pb

        if self._bundle != "inline" or not self._store:
            return ""
        blob = pb.json_script_safe(self._store)
        eid = json.dumps(store_id)
        return (
            f'<script type="application/cairn-plot-store+json" id="{_html.escape(store_id)}">'
            f"{blob}</script>"
            "<script>window.__cairnPlotStore=window.__cairnPlotStore||{};"
            f"Object.assign(window.__cairnPlotStore,JSON.parse(document.getElementById({eid}).textContent));"
            "</script>"
        )

    def _mount_html(self, div_id: str, desc_id: str) -> str:
        from . import bundle as pb

        descriptor = pb.json_script_safe(self._descriptor_dict())
        min_h = self._height if self._height is not None else 60
        did, sid = json.dumps(div_id), json.dumps(desc_id)
        return (
            f'<div id="{_html.escape(div_id)}" class="cairn-plot-mount" '
            f'style="min-height:{int(min_h)}px"></div>'
            f'<script type="application/cairn-plot+json" id="{_html.escape(desc_id)}">'
            f"{descriptor}</script>"
            f"<script>(window.__cairnPlotQueue=window.__cairnPlotQueue||[]).push([{did},{sid}]);</script>"
        )

    def _repr_html_(self) -> str:
        try:
            import uuid as _uuid

            uid = _uuid.uuid4().hex[:12]
            div_id = f"cairn-plot-{uid}"
            desc_id = f"cairn-plot-desc-{uid}"
            store_id = f"__cairn_plot_store__{uid}"
            return (
                self._bundle_html()
                + self._figure_addon_html()
                + self._three_addon_html()
                + self._gpu_image_addon_html()
                + self._store_html(store_id)
                + self._mount_html(div_id, desc_id)
            )
        except Exception as exc:  # noqa: BLE001 - display hooks must never raise
            log.debug("cairn PlotElement render failed: %s", exc)
            return (
                "<pre>cairn-plot: could not render this plot "
                f"({_html.escape(type(exc).__name__)}: {_html.escape(str(exc))}).</pre>"
            )

    def __repr__(self) -> str:
        renderer = self._descriptor_dict().get("renderer", "?") if self.spec else "?"
        return f"<cairn.plot.{self._label} (renderer={renderer!r}, mode={self._bundle})>"
