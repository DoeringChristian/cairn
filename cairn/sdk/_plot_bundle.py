"""cairn-plot bundle access + safe HTML/JSON serialization (Phase C).

The Python emit (``PlotElement`` in ``elements.py``) ships the SAME pure
``cairn-plot`` renderers the viewer app uses — read from the committed Vite
``dist/`` — in one of two shapes:

* **inline** (default, offline/self-contained): the single-file IIFE
  ``dist/plot-inline/plot-inline.iife.js`` + its ``style.css`` (built by
  ``vite.plot-inline.config.ts``). No ``/assets`` requests, works on
  ``file://`` with no server. This is the LOCAL data-mode companion.
* **link** (opt-in, needs a reachable server): a ``<script type="module"
  src="…/assets/plot-*.js">`` pointed at the code-split ``plot.html`` build,
  resolved from ``dist/plot.html`` so the hashed filename is never stale. The
  ENDPOINT data-mode companion.

Also home to the two serialization safety helpers:

* :func:`json_script_safe` — JSON for embedding inside a ``<script>`` element,
  with ``<``/``>``/``&`` (and the JS line separators U+2028/U+2029)
  unicode-escaped so a payload containing ``</script>`` can never break out of
  the tag (acceptance criterion M1). ``JSON.parse`` decodes the escapes back
  transparently.
* :func:`js_inline_safe` — defensive ``</script`` guard for the raw bundle JS.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

# ``cairn/ui/dist`` relative to this file (``cairn/sdk/_plot_bundle.py``).
_DIST = Path(__file__).resolve().parent.parent / "ui" / "dist"
_INLINE_DIR = _DIST / "plot-inline"
_INLINE_JS = _INLINE_DIR / "plot-inline.iife.js"
_INLINE_CSS = _INLINE_DIR / "style.css"
_PLOT_HTML = _DIST / "plot.html"


class BundleUnavailable(RuntimeError):
    """The committed cairn-plot dist is missing (a broken install/build)."""


# ---------------------------------------------------------------------------
# Serialization safety
# ---------------------------------------------------------------------------


def json_script_safe(obj: Any) -> str:
    """``json.dumps(obj)`` safe to embed between ``<script>``…``</script>``.

    Unicode-escapes ``<`` ``>`` ``&`` and U+2028/U+2029 so no substring can
    close the script element or open an HTML comment — the M1 XSS fix. The
    escapes are valid JSON (``\\uXXXX``) and ``JSON.parse`` restores the
    original characters, so a string field containing literal ``</script>``
    round-trips intact while being inert in the DOM.
    """
    raw = json.dumps(obj, separators=(",", ":"))
    return (
        raw.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


_SCRIPT_CLOSE = re.compile(r"</script", re.IGNORECASE)


def js_inline_safe(js: str) -> str:
    """Defensive guard for raw bundle JS embedded in an inline ``<script>``:
    rewrite any ``</script`` to ``<\\/script`` (equivalent inside the JS
    string/regex literals where it could only legitimately appear)."""
    return _SCRIPT_CLOSE.sub(r"<\\/script", js)


# ---------------------------------------------------------------------------
# Bundle readers (cached — the dist is immutable at runtime)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def inline_bundle_js() -> str:
    """The self-contained IIFE bundle JS (``</script``-guarded)."""
    if not _INLINE_JS.exists():
        raise BundleUnavailable(
            f"cairn-plot inline bundle missing at {_INLINE_JS}. Rebuild with "
            "`cd cairn/ui && npm run build:plot-inline` (and commit dist/)."
        )
    return js_inline_safe(_INLINE_JS.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def inline_bundle_css() -> str:
    """The design-token CSS (``bg-bg``/``text-fg`` …) for the inline bundle."""
    if not _INLINE_CSS.exists():
        raise BundleUnavailable(f"cairn-plot inline CSS missing at {_INLINE_CSS}.")
    return _INLINE_CSS.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def _link_asset_paths() -> tuple[str, str]:
    """(module-entry path, css path) parsed from the committed ``plot.html``.

    Returns the ``/assets/plot-*.js`` module entry and ``/assets/index-*.css``
    stylesheet — the code-split build's hashed filenames, read fresh so a
    rebuild's new hash is never stale. ``link`` mode prefixes these with the
    server origin.
    """
    if not _PLOT_HTML.exists():
        raise BundleUnavailable(f"cairn-plot plot.html missing at {_PLOT_HTML}.")
    html = _PLOT_HTML.read_text(encoding="utf-8")
    js = re.search(r'src="(/assets/plot-[^"]+\.js)"', html)
    css = re.search(r'href="(/assets/index-[^"]+\.css)"', html)
    if not js:
        raise BundleUnavailable("could not find the plot entry <script> in plot.html")
    return js.group(1), (css.group(1) if css else "")


def link_asset_urls(server: str) -> tuple[str, str]:
    """(module-entry URL, css URL) for ``link`` mode against ``server``."""
    base = server.rstrip("/")
    js_path, css_path = _link_asset_paths()
    return f"{base}{js_path}", (f"{base}{css_path}" if css_path else "")
