"""WS-PYAPI display protocol — the base classes ``cairn.plot`` builders and
``cairn.Report`` compose.

An **element** is anything a builder in :mod:`cairn.plot` returns (see that
module for the ``scalar``/``image``/``mesh``/``media_compare``/... factory
functions) or that gets ``report.add(el)``-ed into a :class:`cairn.Report`.
Every element implements the standard Jupyter/marimo display protocol —
``_repr_html_`` and ``_repr_mimebundle_`` — so it renders inline the moment
it's the last expression in a cell, per
``docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md`` §5/§11.

Two concrete shapes, matching the design's "reuse the existing viewer, no
new render path" constraint:

* :class:`CardElement` — a **server-backed** card spec (built from one or
  more ``run[tag]`` lazy handles). Rendering POSTs the spec to the existing
  ``/api/embed/specs`` route (WS-EMBED) to get a short-lived ``sid``, then
  returns an ``<iframe src=".../embed/card?sid=...">`` pointed at the
  existing ``/embed/card`` SPA entry — the *same* React ``CardRenderer``
  every other card in the app uses. Zero card reimplementation.
* :class:`HtmlElement` — a **self-contained** HTML snapshot (a Plotly
  ``fig.to_html()``, a rendered table, ...). No server round trip at all;
  this is the fallback path for raw (non-``run[tag]``) data and for when no
  cairn server is reachable (design spec §5's "degradation contract").

Raw, non-plot MEDIA (an in-memory image/mesh/volume array with no run to
anchor a ``SeriesRef`` to) has **no** self-contained render path today — the
card-spec schema (``cairn/sdk/card_spec.py``) has no inline-data variant.
That is WS-INLINE (design spec §6.3, deferred); builders that hit this case
raise a clear ``NotImplementedError`` rather than silently doing something
half-right (see ``cairn/plot.py``'s ``_resolve_series``).
"""

from __future__ import annotations

import html as _html
import json
import logging
from pathlib import Path
from typing import Any

from .. import config as _config

log = logging.getLogger(__name__)

# Reuses the EXISTING `cairn:resize` postMessage protocol
# (`cairn/ui/src/components/card-kit/use-iframe-auto-height.ts`,
# `PluginCard.tsx`) — the embed page posts `{type:"cairn:resize", height,
# protocolVersion:1}` to `parent`; this ~15-line listener (design spec §4.4)
# sets the outer iframe's height from it, clamped to sane bounds.
_MIN_HEIGHT = 120
_MAX_HEIGHT = 2000
_RESIZE_LISTENER_JS = """<script>
(function() {{
  var frame = document.getElementById({frame_id!r});
  if (!frame) return;
  window.addEventListener("message", function(ev) {{
    if (!ev.data || ev.data.type !== "cairn:resize") return;
    if (ev.source !== frame.contentWindow) return;
    var h = Math.max({min_h}, Math.min({max_h}, Number(ev.data.height) || 0));
    if (h) frame.style.height = h + "px";
  }});
}})();
</script>"""

_HEALTHCHECK_TIMEOUT = 0.5
_DEFAULT_IFRAME_HEIGHT = 420

# `cairn ui`'s own CLI `--port` default (`cli.py`'s `ui_cmd`) — distinct
# from `config.DEFAULT_SERVER`'s port (4300, the CLI client commands'
# fallback). Not imported from `cli.py` to avoid pulling click/uvicorn into
# the SDK's import graph; kept in sync by `tests/unit/test_plot_elements.py`.
_CAIRN_UI_DEFAULT_PORT = 4301


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


class CardElement(Element):
    """A server-backed ``CardSpec`` — renders as a live ``/embed/card`` iframe.

    Degradation contract (design spec §5): try the live iframe first (POST
    ``/api/embed/specs`` -> ``sid`` -> ``<iframe src=".../embed/card?sid=...">``);
    fall back to an inline text notice (still valid HTML, safe in
    ``_repr_html_``) when no cairn server is reachable — e.g. pure local
    ``file://``-mode reading (``cairn.Reader(repo="./.cairn")`` with no
    ``cairn ui`` running).
    """

    def __init__(
        self,
        spec: dict[str, Any],
        *,
        server: str | None = None,
        token: str | None = None,
        height: int = _DEFAULT_IFRAME_HEIGHT,
        reader_server: str | None = None,
        repo_path: str | Path | None = None,
    ) -> None:
        self.spec = spec
        self._server_override = server
        self._reader_server = reader_server
        """The HTTP base the source `Reader` was connected to when it was
        opened in server mode (``Reader(repo="cairn://host:port")``), threaded
        by ``cairn.plot``. Preferred over global config/discovery so a card
        renders against the SAME server that served its data. `None` for
        local-repo readers (they use `repo_path` discovery instead)."""
        self._token_override = token
        self._height = height
        self._repo_path = str(repo_path) if repo_path is not None else None
        """The local ``.cairn`` dir this card's data came from (threaded by
        ``cairn.plot``'s builders from the `Reader`/`Run` used to fetch it),
        for `servers.json` auto-discovery in `_resolve_server`. `None` for
        HTTP-backed readers or when built directly (`CardElement(spec)`)."""

    # ---- server + auth resolution ----

    def _resolve_server(self) -> str | None:
        """Best-effort HTTP base for the live iframe, or ``None``.

        Resolution order:

        1. Explicit ``server=`` override — trusted without a probe.
        2. The source ``Reader``'s own connected server
           (``self._reader_server``, set when it was opened as
           ``Reader(repo="cairn://host:port")``) — trusted without a probe:
           the reader literally queried this card's data from there, so the
           card must render there too, with no global config needed.
        3. ``cairn.configure``/``CAIRN_REPO``/config-file ``cairn://...``
           (via ``config.resolve_target()``) — also trusted without a probe,
           same posture as ``Transport``/``_HttpBackend``.
        4. The repo's advertised ``servers.json`` (written by ``cairn ui``
           on startup — see ``DataDir.add_live_server``), health-probed.
           Uses ``self._repo_path`` (the actual repo this card's data came
           from, threaded from the ``Reader``) when known, else the same
           local repo path ``config.resolve_target()`` would use — this is
           what makes discovery work regardless of which port ``cairn ui``
           actually landed on (it auto-increments past its default when
           taken).
        5. Last resort: probe the CLI-default ports directly
           (``config.DEFAULT_SERVER`` and ``cairn ui``'s own ``--port``
           default) — covers a server that predates this repo's
           `servers.json` support, or a `servers.json` that failed to write.

        A plain local repo path has no *implied* HTTP URL, so steps 4-5
        never trust a candidate without a fast, short-timeout
        ``GET /api/health`` first — this is the "is `cairn ui` actually
        running" check the design spec's ``file://``-mode caveat calls for.
        """
        if self._server_override is not None:
            return self._server_override
        if self._reader_server is not None:
            return self._reader_server
        target = _config.resolve_target()
        if not target.is_local:
            return target.location

        repo_path = self._repo_path or target.location
        for candidate in self._advertised_candidates(repo_path):
            if self._probe(candidate):
                return candidate

        # No (live) advertisement found — last-resort fixed-port probes.
        legacy_candidates = [
            _config.resolve_server(),
            f"http://localhost:{_CAIRN_UI_DEFAULT_PORT}",
        ]
        for candidate in dict.fromkeys(legacy_candidates):  # de-dup, keep order
            if self._probe(candidate):
                return candidate
        return None

    @staticmethod
    def _advertised_candidates(repo_path: str) -> list[str]:
        """Live server URLs advertised for ``repo_path``, newest first."""
        try:
            from ..server.storage.datadir import read_live_servers

            entries = read_live_servers(Path(repo_path))
        except Exception:  # noqa: BLE001 - discovery must never raise
            return []
        entries = sorted(entries, key=lambda e: e.get("started_at") or "", reverse=True)
        urls = []
        for entry in entries:
            port = entry.get("port")
            if port is None:
                continue
            host = entry.get("host") or "localhost"
            if host in ("0.0.0.0", "127.0.0.1"):
                host = "localhost"
            urls.append(f"http://{host}:{port}")
        return urls

    @staticmethod
    def _probe(url: str) -> bool:
        try:
            import httpx

            resp = httpx.get(f"{url}/api/health", timeout=_HEALTHCHECK_TIMEOUT)
            return resp.status_code < 500
        except Exception:  # noqa: BLE001 - any failure means "not reachable"
            return False

    def _post_spec(self, server: str) -> str | None:
        try:
            import httpx

            token = _config.resolve_token(self._token_override)
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            resp = httpx.post(
                f"{server.rstrip('/')}/api/embed/specs",
                json={"spec": self.spec},
                headers=headers,
                timeout=5.0,
            )
            resp.raise_for_status()
            return resp.json()["sid"]
        except Exception as exc:  # noqa: BLE001
            log.debug("cairn embed spec POST failed: %s", exc)
            return None

    # ---- rendering ----

    def iframe_html(self) -> str | None:
        """Build the live ``<iframe>`` HTML, or ``None`` if no server."""
        server = self._resolve_server()
        if not server:
            return None
        sid = self._post_spec(server)
        if not sid:
            return None
        frame_id = f"cairn-embed-{sid}"
        src = f"{server.rstrip('/')}/embed/card?sid={sid}"
        listener = _RESIZE_LISTENER_JS.format(
            frame_id=frame_id, min_h=_MIN_HEIGHT, max_h=_MAX_HEIGHT
        )
        return (
            f'<iframe id="{frame_id}" src="{_html.escape(src)}" '
            f'style="width:100%;height:{self._height}px;border:0;" '
            'sandbox="allow-scripts allow-same-origin"></iframe>\n'
            f"{listener}"
        )

    def _repr_html_(self) -> str:
        iframe = self.iframe_html()
        if iframe is not None:
            return iframe
        repo_flag = f" --repo {self._repo_path}" if self._repo_path else ""
        start_cmd = f"cairn ui{repo_flag} --no-auth"
        spec_json = _html.escape(json.dumps(self.spec, indent=2))
        notice = (
            "cairn: no reachable cairn server — this card needs a running "
            "`cairn ui` on the SAME repo to render live.\n"
            f"  Start one:     {start_cmd}\n"
            "  Or point at one explicitly, via any of:\n"
            '    cairn.configure(repo="cairn://localhost:PORT")\n'
            "    CAIRN_REPO=cairn://localhost:PORT\n"
            '    CardElement(..., server="http://localhost:PORT")'
        )
        return (
            f"<pre>{_html.escape(notice)}</pre>\n"
            "<details><summary>spec (debug)</summary>"
            f"<pre>{spec_json}</pre></details>"
        )

    def __repr__(self) -> str:
        return f"CardElement(type={self.spec.get('type')!r}, series={len(self.spec.get('series', []))})"


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
        self.spec = spec  # a PlotSpec (card_spec.PlotSpec) or a plain dict
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

    # ---- rendering ----

    def _bundle_html(self) -> str:
        from . import _plot_bundle as pb

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
        if self._bundle != "inline" or self._renderer_name() != "figure":
            return ""
        from . import _plot_bundle as pb

        js = pb.inline_figure_addon_js()
        return f"<script>if(!window.__cairnPlotFigureLoaded){{\n{js}\n}}</script>"

    def _store_html(self, store_id: str) -> str:
        from . import _plot_bundle as pb

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
        from . import _plot_bundle as pb

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
