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
    ) -> None:
        self.spec = spec
        self._server_override = server
        self._token_override = token
        self._height = height

    # ---- server + auth resolution ----

    def _resolve_server(self) -> str | None:
        """Best-effort HTTP base for the live iframe, or ``None``.

        Mirrors the SDK's own ``Transport``/``config`` chain
        (``config.resolve_target``/``resolve_server``). An explicitly
        configured server (``cairn://host:port``, ``CAIRN_REPO``, ...) is
        trusted without a probe — same posture as ``Transport``/
        ``_HttpBackend``, which never health-check either. A plain local
        repo path (the common notebook default) has no implied HTTP URL, so
        we do a fast, short-timeout probe of the CLI-default server
        (``config.resolve_server()``'s fallback) before trusting it — this
        is the "is `cairn ui` actually running" check the design spec's
        ``file://``-mode caveat calls for.
        """
        if self._server_override is not None:
            return self._server_override
        target = _config.resolve_target()
        if not target.is_local:
            return target.location
        candidate = _config.resolve_server()
        try:
            import httpx

            resp = httpx.get(f"{candidate}/api/health", timeout=_HEALTHCHECK_TIMEOUT)
            if resp.status_code < 500:
                return candidate
        except Exception:  # noqa: BLE001 - any failure means "not reachable"
            pass
        return None

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
        spec_json = _html.escape(json.dumps(self.spec))
        return (
            "<pre>cairn: no reachable cairn server — start `cairn ui` "
            "(or `cairn ui --no-auth` for local dev) to render this card "
            f"live.\ncard spec: {spec_json}</pre>"
        )

    def __repr__(self) -> str:
        return f"CardElement(type={self.spec.get('type')!r}, series={len(self.spec.get('series', []))})"
