"""The one module that knows where the cairn-ui viewer bundle lives.

`cairn-track` ships NO UI assets. The viewer is a separate, data-only
distribution (`cairn-ui`, via ``pip install 'cairn-track[ui]'``). Nothing else
under ``cairn/`` may name the bundle's path, its environment override, or its
file layout — enforced by ``tests/unit/test_package_boundaries.py``.

Stdlib only, deliberately: this must not widen any import closure.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

_log = logging.getLogger(__name__)

#: The distribution that provides the bundle. Named here because this module
#: owns everything about cairn-ui's identity — including, per the boundary test,
#: its import name.
PACKAGE = "cairn_ui"

_ENV_OVERRIDE = "CAIRN_UI_DIST"
_DIST_DIRNAME = "_dist"
_ASSETS = "assets"

#: The three separately-built HTML entries the viewer ships. Named here so no
#: other module has to spell a filename — see the boundary test.
INDEX = "index.html"
EMBED = "embed.html"
PLOT = "plot.html"
SHELLS = (INDEX, EMBED, PLOT)

_INDEX = INDEX  # internal alias kept for the completeness check below

NOT_INSTALLED_HINT = (
    "The Cairn viewer is not installed.\n"
    "\n"
    "    pip install 'cairn-track[ui]'        (or: uv add 'cairn-track[ui]')\n"
    "\n"
    "Tracking, the CLI and the HTTP API all work without it — only the\n"
    "browser viewer needs this extra. Already have a bundle elsewhere?\n"
    "Point CAIRN_UI_DIST at its build directory."
)


def _is_complete(candidate: Path) -> bool:
    """A usable bundle has an index shell AND an assets directory.

    Both are required: ``StaticFiles(directory=...)`` raises at
    app-construction time when the directory is missing, so a half-built dist
    must degrade to the placeholder rather than crash the server.
    """
    return (candidate / _INDEX).is_file() and (candidate / _ASSETS).is_dir()


#: Override values already warned about. Resolution itself is deliberately
#: uncached (see `dist_path`); this only stops one bad override from logging
#: once per stat, since mounting a viewer resolves several times.
_warned_overrides: set[str] = set()


def _from_env() -> Path | None:
    raw = os.environ.get(_ENV_OVERRIDE)
    if not raw:
        return None
    candidate = Path(raw).expanduser()
    if _is_complete(candidate):
        _warned_overrides.discard(raw)
        return candidate
    if raw in _warned_overrides:
        return None
    _warned_overrides.add(raw)
    _log.warning(
        "%s=%s has no %s + %s/ — serving no viewer. An override that silently "
        "fell back to the installed bundle would be undebuggable.",
        _ENV_OVERRIDE,
        raw,
        _INDEX,
        _ASSETS,
    )
    return None


def _from_installed_package() -> Path | None:
    try:
        import cairn_ui  # optional dependency: `cairn-track[ui]`
    except ImportError:
        return None
    candidate = Path(cairn_ui.__file__).resolve().parent / _DIST_DIRNAME
    return candidate if _is_complete(candidate) else None


def _from_dev_checkout() -> Path | None:
    """Running straight out of a clone with nothing installed."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "cairn-ui" / "cairn_ui" / _DIST_DIRNAME
        if _is_complete(candidate):
            return candidate
    return None


def dist_path() -> Path | None:
    """The viewer bundle directory, or None when no viewer is available.

    Order: ``CAIRN_UI_DIST`` (wins outright, never falls through) -> the
    installed ``cairn_ui`` package -> a source-checkout walk-up.

    Intentionally uncached: two stat calls per app construction, and a cache
    would make environment monkeypatching in tests order-dependent.
    """
    if os.environ.get(_ENV_OVERRIDE):
        return _from_env()
    return _from_installed_package() or _from_dev_checkout()


def is_available() -> bool:
    """True when a complete viewer bundle can be found."""
    return dist_path() is not None


def assets_dir() -> Path | None:
    """The bundle's hashed-asset directory, or None when unavailable."""
    dist = dist_path()
    return None if dist is None else dist / _ASSETS


def inject_cpu_override(html: bytes) -> bytes:
    """Pin cairn-plot to its CPU renderer before the app module runs.

    An inline script placed just before ``</head>``: module scripts are
    deferred, so this executes first regardless of where the bundler hoisted
    them.
    """
    marker = b"</head>"
    override = b'<script>globalThis.__cairnPlotRenderMode="cpu";</script>'
    return html.replace(marker, override + marker, 1)


def shell(name: str, *, disable_webgpu: bool = False) -> bytes | None:
    """Read one browser shell, or None when the viewer or that shell is absent."""
    if name not in SHELLS:
        raise ValueError(f"unknown viewer shell: {name!r}")
    dist = dist_path()
    if dist is None:
        return None
    path = dist / name
    if not path.is_file():
        return None
    content = path.read_bytes()
    return inject_cpu_override(content) if disable_webgpu else content


def version() -> str | None:
    """Installed ``cairn-ui`` version, for banners and diagnostics."""
    from importlib.metadata import PackageNotFoundError
    from importlib.metadata import version as _version

    try:
        return _version("cairn-ui")
    except PackageNotFoundError:
        return None
