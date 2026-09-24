"""Cairn — open-source ML experiment tracker."""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING

__version__ = "0.1.0"

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
# pulling the server/run/transport/handler graph — the P2 cairn-plot packaging
# requirement that the pure ``cairn.plot`` modules stay app-decoupled (proven
# by ``tests/unit/test_plot_import_purity.py``). The public behaviour is
# unchanged: ``cairn.Run``, ``cairn.plot``, ``cairn.Image`` … all still resolve.
#
# Handler registration is a side effect of importing ``cairn.sdk.run`` (which
# imports the handlers package) — so any tracking path still registers the
# built-ins; ``log_artifact`` below imports them explicitly for its no-Run path.
# ---------------------------------------------------------------------------

_LAZY_ATTRS: dict[str, str] = {
    "Run": ".sdk.run",
    "Scope": ".sdk.scope",
    "ArtifactVersion": ".sdk.run",
    "Reader": ".sdk.reader",
    "Reference": ".sdk.artifact_dir",
    "ArtifactDir": ".sdk.artifact_dir",
    "MediaRef": ".sdk.reader",
    "query_url": ".sdk.query_urls",
    "register_handler": ".sdk.handlers.registry",
    "Artifact": ".sdk.wrappers",
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
    from . import plot as plot
    from . import ui as ui
    from .sdk.artifact_dir import ArtifactDir, Reference
    from .sdk.query_urls import query_url
    from .sdk.reader import MediaRef, Reader
    from .sdk.run import ArtifactVersion, Run
    from .sdk.handlers.registry import register_handler
    from .sdk.wrappers import (
        Artifact,
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
    "Reference",
    "ArtifactDir",
    "query_url",
    "ArtifactVersion",
    "plot",
    "ui",
    "Artifact",
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
    "load_artifact",
    "list_artifacts",
]


def log_artifact(
    data,
    *,
    name: str,
    type: str = "artifact",
    project: str,
    repo=None,
    metadata: dict | None = None,
    aliases: list[str] | None = None,
) -> "ArtifactVersion | None":
    """Upload an artifact version outside a run context.

    ``data`` may be a directory or :class:`Reference` (list), as for
    ``Run.log_artifact``: a multi-file artifact.
    """
    from .config import resolve_target
    # Import the handlers PACKAGE (not just the registry) so the built-in type
    # handlers are registered — the no-Run path can't rely on `cairn.sdk.run`
    # having been imported to do it.
    from .sdk import handlers as _handlers  # noqa: F401
    from .sdk.handlers.registry import default_registry, resolve_mime_type
    from .sdk.run import ArtifactVersion

    target = resolve_target(repo=repo)
    if target.is_local:
        from .sdk.local import LocalTransport
        transport = LocalTransport(target.location)
    else:
        from .sdk.transport import Transport
        transport = Transport(target.location)

    try:
        # Serialize
        from pathlib import Path as _Path
        from .sdk.artifact_dir import is_multi_file, upload_manifest
        handler_meta: dict = {}
        mime_type = "application/octet-stream"
        if is_multi_file(data):
            digest, size, handler_meta = upload_manifest(transport, data)
            merged_meta = {**handler_meta, **(metadata or {})}
        else:
            if isinstance(data, (str, _Path)):
                path = _Path(data)
                with open(path, "rb") as f:
                    blob = f.read()
            elif isinstance(data, (bytes, bytearray)):
                blob = bytes(data)
            else:
                handler = default_registry.find_handler(data)
                if handler is not None:
                    blob, handler_meta = handler.serialize(data)
                    mime_type = resolve_mime_type(handler, data)
                else:
                    raise TypeError(f"No handler for type {type(data).__name__}")
            merged_meta = {**handler_meta, **(metadata or {})}
            digest = transport.upload_artifact(blob, mime_type, merged_meta)
            size = len(blob)

        # Resolve project_id
        project_id = project.lower().replace(" ", "-")

        result = transport.create_artifact_version(
            project_id=project_id,
            family_name=name,
            family_type=type,
            digest=digest,
            size_bytes=size,
            metadata=merged_meta,
            created_by_run="",
            aliases=aliases,
        )
        return ArtifactVersion(**result) if result else None
    finally:
        transport.close()


def load_artifact(ref: str, *, project: str, repo=None, cache: bool = True):
    """Download and return artifact bytes/deserialized object."""
    from .sdk.reader import Reader

    reader = Reader(repo=repo, cache=cache)
    try:
        project_id = project.lower().replace(" ", "-")
        return reader.resolve_and_download_artifact(project_id, ref)
    finally:
        reader.close()


def list_artifacts(*, project: str, type: str | None = None, repo=None) -> list[dict]:
    """List artifact families in a project."""
    from .sdk.reader import Reader

    reader = Reader(repo=repo)
    try:
        return reader.artifact_families(project, type=type)
    finally:
        reader.close()
