"""Cairn — open-source ML experiment tracker."""

from __future__ import annotations

__version__ = "0.1.0"

# Top-level API (re-exports from cairn.sdk).
from .config import configure  # noqa: E402
from .sdk import handlers  # noqa: E402, F401  - registers built-in handlers
from .sdk.handlers.registry import register_handler  # noqa: E402
from .sdk.run import Run  # noqa: E402
from .sdk.plugins import (  # noqa: E402
    JSPlugin,
    PythonPlugin,
    ServerPlugin,
    WindowPlugin,
)
from .sdk.reader import Reader  # noqa: E402
from .sdk.run import ArtifactVersion  # noqa: E402

from .sdk.wrappers import (  # noqa: E402
    Artifact,
    Audio,
    Figure,
    Histogram,
    Image,
    Tensor,
    Text,
    Video,
)

__all__ = [
    "__version__",
    "Run",
    "configure",
    "register_handler",
    "Reader",
    "ArtifactVersion",
    "Artifact",
    "Image",
    "Figure",
    "Audio",
    "Video",
    "Histogram",
    "Tensor",
    "Text",
    "JSPlugin",
    "PythonPlugin",
    "ServerPlugin",
    "WindowPlugin",
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
    """Upload an artifact version outside a run context."""
    import hashlib

    from .config import resolve_target
    from .sdk.handlers.registry import default_registry

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
        handler_meta: dict = {}
        mime_type = "application/octet-stream"

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
                mime_type = getattr(handler, "mime_type", mime_type)
            else:
                raise TypeError(f"No handler for type {type(data).__name__}")

        merged_meta = {**handler_meta, **(metadata or {})}
        digest = transport.upload_artifact(blob, mime_type, merged_meta)

        # Resolve project_id
        project_id = project.lower().replace(" ", "-")

        result = transport.create_artifact_version(
            project_id=project_id,
            family_name=name,
            family_type=type,
            digest=digest,
            size_bytes=len(blob),
            metadata=merged_meta,
            created_by_run="",
            aliases=aliases,
        )
        return ArtifactVersion(**result) if result else None
    finally:
        transport.close()


def load_artifact(ref: str, *, project: str, repo=None, cache: bool = True):
    """Download and return artifact bytes/deserialized object."""
    reader = Reader(repo=repo, cache=cache)
    try:
        project_id = project.lower().replace(" ", "-")
        return reader.resolve_and_download_artifact(project_id, ref)
    finally:
        reader.close()


def list_artifacts(*, project: str, type: str | None = None, repo=None) -> list[dict]:
    """List artifact families in a project."""
    reader = Reader(repo=repo)
    try:
        return reader.artifact_families(project, type=type)
    finally:
        reader.close()
