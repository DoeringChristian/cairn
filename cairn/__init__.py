"""Cairn — open-source ML experiment tracker."""

from __future__ import annotations

import importlib
from importlib.metadata import PackageNotFoundError as _PackageNotFoundError
from importlib.metadata import version as _dist_version
from typing import TYPE_CHECKING, Any

try:
    __version__ = _dist_version("cairn-track")
except _PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0.0.0+unknown"

# `configure` is light (only ``cairn.config`` — stdlib + platformdirs/tomli_w)
# and part of the very first line of most scripts, so it stays eager.
from .config import configure  # noqa: E402

# ---------------------------------------------------------------------------
# Lazy top-level surface (PEP 562).
#
# Everything else — ``Run``/``Reader``/``Report``, the plugin + wrapper
# classes, ``cairn.plot`` — is loaded on first attribute access rather than at
# ``import cairn``. This keeps ``import cairn`` (and therefore importing any
# ``cairn.sdk.*`` submodule, which runs THIS package initializer) from eagerly
# pulling the server/run/transport/handler graph, so the pure ``cairn.plot``
# modules stay decoupled from the app (proven by
# ``tests/unit/test_plot_import_purity.py``). ``cairn.Run``, ``cairn.plot``,
# ``cairn.Image`` … all still resolve as plain attributes.
#
# Handler registration is a side effect of importing ``cairn.sdk.run`` (which
# imports the handlers package) — so any tracking path still registers the
# built-ins; ``log_artifact`` below imports them explicitly for its no-Run path.
# ---------------------------------------------------------------------------

_LAZY_ATTRS: dict[str, str] = {
    "Run": ".sdk.run",
    "Scope": ".sdk.scope",
    "Artifact": ".sdk.artifacts",
    "ArtifactVersion": ".sdk.artifacts",
    "ArtifactEntry": ".sdk.artifacts",
    "ArtifactFamily": ".sdk.artifacts",
    "Reader": ".sdk.reader",
    "MediaRef": ".sdk.reader",
    "sweep": ".sdk.sweep",
    "Sweep": ".sdk.sweep",
    "query_url": ".sdk.query_urls",
    "register_handler": ".sdk.handlers.registry",
    "Pickle": ".sdk.wrappers",
    "Audio": ".sdk.wrappers",
    "Boxes3D": ".sdk.wrappers",
    "BVH": ".sdk.wrappers",
    "ConfusionMatrix": ".sdk.wrappers",
    "Figure": ".sdk.wrappers",
    "Histogram": ".sdk.wrappers",
    "Html": ".sdk.wrappers",
    "Image": ".sdk.wrappers",
    "Markdown": ".sdk.wrappers",
    "Mesh": ".sdk.wrappers",
    "Octree": ".sdk.wrappers",
    "PointCloud": ".sdk.wrappers",
    "PRCurve": ".sdk.wrappers",
    "ROCCurve": ".sdk.wrappers",
    "Table": ".sdk.wrappers",
    "Tensor": ".sdk.wrappers",
    "Text": ".sdk.wrappers",
    "Video": ".sdk.wrappers",
    "Volume": ".sdk.wrappers",
}

if TYPE_CHECKING:  # static-analysis only — never executed, never eager at runtime.
    from pathlib import Path
    from . import plot as plot
    from . import ui as ui
    from .sdk.artifacts import Artifact, ArtifactEntry, ArtifactFamily, ArtifactVersion
    from .sdk.query_urls import query_url
    from .sdk.reader import MediaRef, Reader
    from .sdk.run import Run
    from .sdk.sweep import Sweep, sweep
    from .sdk.handlers.registry import register_handler
    from .sdk.wrappers import (
        Audio,
        Boxes3D,
        BVH,
        ConfusionMatrix,
        Figure,
        Histogram,
        Html,
        Image,
        Markdown,
        Mesh,
        Octree,
        PointCloud,
        Pickle,
        PRCurve,
        ROCCurve,
        Table,
        Tensor,
        Text,
        Video,
        Volume,
    )


#: Attributes gated behind an optional extra, and which extra unlocks each.
#: cairn-track is the tracker and the server; drawing and the browser viewer are
#: opt-in halves, like ray[tune] / ray[serve]. Listed here so a missing extra
#: reports itself instead of surfacing as a bare ImportError on `cairn_plot`
#: from three modules deep.
_EXTRA_FOR = {
    "plot": "plot",
    "ui": "ui",
}

_WHAT = {
    "plot": "the renderer surface",
    "ui": "the Cairn viewer surface (cards and notebook embeds)",
}

from . import viewer as _viewer  # stdlib-only; widens no import closure

#: Import names that belong to the optional distributions themselves. A missing
#: one means "extra not installed"; anything else is a genuine error.
_OPTIONAL_DISTS = frozenset({"cairn_plot", _viewer.PACKAGE})

_EXTRA_HINT = (
    "`cairn.{name}` is {what}, which needs an optional extra.\n"
    "\n"
    "    pip install \'cairn-track[{extra}]\'"
    "        (or: uv add \'cairn-track[{extra}]\')\n"
    "\n"
    "cairn-track itself is the tracker and the server: logging, the reader, the\n"
    "CLI and the HTTP API all work without it."
)


def __getattr__(name: str):
    """PEP 562 lazy loader for the top-level API (see module docstring)."""
    try:
        if name in ("plot", "ui"):
            module = importlib.import_module(f".{name}", __name__)
            globals()[name] = module
            return module
        target = _LAZY_ATTRS.get(name)
        if target is not None:
            module = importlib.import_module(target, __name__)
            value = getattr(module, name)
            globals()[name] = value  # cache — subsequent lookups skip __getattr__
            return value
    except ImportError as exc:
        # Only translate a MISSING OPTIONAL DISTRIBUTION into an install hint.
        # Any other ImportError from inside these modules is a real bug, and
        # dressing it up as "install the extra" would send people to fix their
        # environment instead of the code.
        extra = _EXTRA_FOR.get(name)
        missing = getattr(exc, "name", None) or ""
        if extra is not None and missing.split(".")[0] in _OPTIONAL_DISTS:
            raise ImportError(
                _EXTRA_HINT.format(name=name, what=_WHAT[name], extra=extra)
            ) from exc
        raise
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__() -> list[str]:
    return sorted(__all__)


__all__ = [
    "__version__",
    "Run",
    "Scope",
    "configure",
    "register_handler",
    "Reader",
    "MediaRef",
    "sweep",
    "Sweep",
    "query_url",
    "Artifact",
    "ArtifactVersion",
    "ArtifactEntry",
    "ArtifactFamily",
    "plot",
    "ui",
    "Pickle",
    "Image",
    "Figure",
    "Audio",
    "Video",
    "Histogram",
    "Table",
    "Tensor",
    "PointCloud",
    "Mesh",
    "Boxes3D",
    "BVH",
    "Octree",
    "Volume",
    "Text",
    "Html",
    "Markdown",
    "ConfusionMatrix",
    "PRCurve",
    "ROCCurve",
    "log_artifact",
]


def log_artifact(
    artifact: Any,
    name: str | None = None,
    *,
    project: str,
    type: str = "artifact",
    aliases: list[str] | None = None,
    tags: list[str] | None = None,
    metadata: dict | None = None,
    description: str | None = None,
    repo: str | Path | None = None,
) -> "ArtifactVersion":
    """Log a new artifact version without a run (it has no producing run).

    Same forms as ``Run.log_artifact``: a ``cairn.Artifact`` draft, or a
    shorthand (a directory, a file, any value) with a ``name``.

    Example:
        ```python
        cairn.log_artifact("data/", "mnist", type="dataset", project="mnist")
        art = cairn.Artifact("cifar10", type="dataset")
        art.add_dir("data/cifar10")
        cairn.log_artifact(art, project="cifar", aliases=["normalised"])
        ```

    Args:
        artifact: A ``cairn.Artifact``, or a shorthand value.
        name: The artifact's name (shorthand only).
        project: Project the artifact belongs to (normalised to an id).
        type: The artifact's type (shorthand only).
        aliases: User aliases moved to the new version (``latest`` always is).
        tags: Tags added to the version.
        metadata: Version metadata (shorthand only).
        description: Version description (shorthand only).
        repo: Where to write, resolved like ``cairn.Run(repo=...)``.

    Returns:
        The new ``ArtifactVersion`` (pending in WAL mode).
    """
    import functools

    from .sdk import handlers as _handlers  # noqa: F401  (register built-ins)
    from .sdk.connect import open_transport
    from .sdk.artifacts import Artifact as _Artifact
    from .sdk.artifacts import draft_from_shorthand
    from .sdk.handlers.registry import default_registry
    from .sdk.run import backend_for_transport, log_draft
    from .server.routes._common import slugify

    if isinstance(artifact, _Artifact):
        extra = [k for k, v in (("name", name), ("metadata", metadata),
                                ("description", description)) if v is not None]
        if type != "artifact":
            extra.append("type")
        if extra:
            raise TypeError(
                f"log_artifact got a cairn.Artifact and {', '.join(extra)}; set those on "
                "the Artifact instead"
            )
        draft = artifact
    else:
        draft = draft_from_shorthand(artifact, name, type, default_registry)
        draft.metadata = dict(metadata or {})
        draft.description = description

    transport, _server = open_transport(repo)
    try:
        version = log_draft(
            transport, default_registry, slugify(project), draft, aliases, None,
            created_by_run=None, backend=None, tags=tags,
        )
        # Reads open their own connection (the writer is closed below).
        version._backend_src = functools.partial(backend_for_transport, transport)
    finally:
        transport.close()
    return version
