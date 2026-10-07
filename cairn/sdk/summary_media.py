"""Media values in a run's summary.

``run.summary(fig=cairn.Figure(f))`` (any depth, mixed with plain JSON)
stores ONE media value per summary key, with no step: writing the key again
replaces it, deleting the key removes it. Every ``cairn`` wrapper qualifies,
and so does a list of them (a gallery, the same rules as ``Run.track``).

Here the values are uploaded like tracked media and replaced by marker
leaves ``{"$media": {"hash", "object_type", "mime_type", "caption"?}}``
(``cairn.server.config_doc``); the server keeps each marker's value as the
one point (step 0) of a series named by the key's dotted path, flagged
``summary`` (``ingest_ops.write_doc``), which is how cards show it.

A name is either a tracked series or a summary media value
(``check_summary_names`` and ``ingest_ops.stepped_conflict``).
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ..server import config_doc
from ..server.ingest_ops import stepped_conflict
from .gallery import GALLERY_MIME, resolve_gallery
from .uploads import upload_gallery, upload_value
from .wrappers import _TypeWrapper


def _is_media(value: Any) -> bool:
    return isinstance(value, _TypeWrapper) or (
        isinstance(value, (list, tuple)) and any(isinstance(v, _TypeWrapper) for v in value)
    )


def media_paths(values: dict[str, Any], prefix: str = "") -> list[str]:
    """The dotted paths of the media values in ``values`` (a summary update)."""
    out: list[str] = []
    for k, v in values.items():
        path = f"{prefix}.{k}" if prefix else str(k)
        if _is_media(v):
            out.append(path)
        elif isinstance(v, dict):
            out += media_paths(v, path)
    return out


def check_summary_names(names: Iterable[str], catalogue: Iterable[dict[str, Any]], tracked: Iterable[str] = ()) -> None:
    """Refuse summary media under a name that is a tracked series:
    ``catalogue`` is the run's sequence catalogue (``{"name", "summary"?}``
    rows), ``tracked`` the names this process tracked (maybe not stored yet).

    Raises:
        ValueError: One of ``names`` is a tracked series.
    """
    taken = set(tracked) | {s["name"] for s in catalogue if not s.get("summary")}
    for name in names:
        if name in taken:
            raise ValueError(f"cairn: run.summary: {stepped_conflict(name)}")


def upload_media(transport: Any, registry: Any, values: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    """``values`` with each media value uploaded and replaced by its marker.

    Raises:
        TypeError: A list mixes media with other values, or holds media a
            gallery cannot (see ``cairn.sdk.gallery``).
        ValueError: A gallery's items are of different kinds.
    """
    out: dict[str, Any] = {}
    for k, v in values.items():
        path = f"{prefix}.{k}" if prefix else str(k)
        if isinstance(v, _TypeWrapper):
            out[k] = _upload_one(transport, registry, v)
        elif isinstance(v, (list, tuple)) and _is_media(v):
            out[k] = _upload_list(transport, registry, v, path)
        elif isinstance(v, dict):
            out[k] = upload_media(transport, registry, v, path)
        else:
            out[k] = v
    return out


def _marker(digest: str, object_type: str, mime: str, caption: Any) -> dict[str, Any]:
    inner: dict[str, Any] = {"hash": digest, "object_type": object_type, "mime_type": mime}
    if caption is not None:
        inner["caption"] = str(caption)
    return {config_doc.MEDIA_KEY: inner}


def _upload_one(transport: Any, registry: Any, wrapper: _TypeWrapper) -> dict[str, Any]:
    handler = registry.find_by_type(wrapper.object_type)
    if handler is None:
        raise TypeError(f"no handler for {type(wrapper).__name__}")
    kwargs = dict(wrapper.kwargs)
    caption = kwargs.pop("caption", None)
    digest, mime, _meta, _size = upload_value(transport, registry, handler, wrapper.obj, kwargs)
    return _marker(digest, wrapper.object_type, mime, caption)


def _upload_list(transport: Any, registry: Any, value: list[Any] | tuple[Any, ...], path: str) -> dict[str, Any]:
    gallery = resolve_gallery(registry, value)
    if gallery is None:
        raise TypeError(
            f"summary key {path!r}: a list holding cairn media is a gallery, so every "
            "item must be cairn media of one kind"
        )
    object_type, items = gallery
    digest, caption = upload_gallery(transport, registry, object_type, items, {})
    return _marker(digest, object_type, GALLERY_MIME, caption)
