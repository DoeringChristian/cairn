"""Galleries: several media values of one kind logged as ONE point.

``run.track([a, b, c], name, step)`` records a gallery when every item is
media of the same kind — wrappers of one type (``cairn.Figure``,
``cairn.Video``, ``cairn.Text``, ...) or raw values that would each be
detected as that type on their own (Plotly/matplotlib figures, ...). Each
item is serialized by its handler and stored as its own artifact; the
point's artifact is a JSON manifest naming them::

    {"items": [{"hash": ..., "mime_type": ..., "metadata": {...},
                "caption": "..."}, ...]}

stored under ``GALLERY_MIME``, with the point's ``object_type`` the items'
kind. ``caption`` is present only on items whose wrapper had one; the
point's own ``caption=`` stays on the point.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .wrappers import _TypeWrapper

#: A gallery point's artifact: the JSON manifest above. The server walks it
#: for export and share scopes (``cairn.server.artifact_refs.GALLERY_MIME``,
#: pinned to this one by a unit test).
GALLERY_MIME = "application/vnd.cairn.gallery+json"

#: The kinds a gallery can hold: the media a card shows per step. Scalars
#: and raw strings are values, not media (a list of them stays an error), and
#: tables, presets and pickled artifacts have no per-item view.
GALLERY_TYPES = frozenset({
    "image", "figure", "audio", "video", "text", "html", "markdown",
    "histogram", "tensor", "pointcloud", "mesh", "boxes3d", "volume",
})


@dataclass
class GalleryItem:
    """One item of a gallery, resolved to its handler."""

    handler: Any
    payload: Any
    kwargs: dict[str, Any]


def resolve_gallery(registry: Any, value: Any) -> tuple[str, list[GalleryItem]] | None:
    """``(object_type, items)`` when ``value`` is a gallery, else None.

    A gallery is a non-empty list/tuple that no handler takes as a whole (a
    list of raw frames stays a video) and whose items each resolve to a
    media handler — by wrapper, or by detection for raw values. None means
    "not a gallery": the caller reports the usual unsupported-type error,
    so plain lists of numbers, strings or dicts behave as before.

    Raises:
        ValueError: The items are media of different kinds.
        TypeError: The items are all of one kind that a gallery cannot hold.
    """
    if not isinstance(value, (list, tuple)) or not value:
        return None
    if registry.find_handler(value) is not None:
        return None
    kinds: list[str] = []
    items: list[GalleryItem] = []
    for item in value:
        if isinstance(item, _TypeWrapper):
            handler = registry.find_by_type(item.object_type)
            kind, payload, kwargs = item.object_type, item.obj, dict(item.kwargs)
        else:
            handler = registry.find_handler(item)
            kind = getattr(handler, "object_type", None)
            # A raw number or string is a value, not media.
            if kind in (None, "scalar", "text"):
                return None
            payload, kwargs = item, {}
        if handler is None:
            return None
        kinds.append(kind)
        items.append(GalleryItem(handler, payload, kwargs))
    distinct = sorted(set(kinds))
    if len(distinct) > 1:
        raise ValueError(
            f"a gallery holds one media type, got {', '.join(distinct)}; "
            "track each type under its own name"
        )
    kind = distinct[0]
    if kind not in GALLERY_TYPES:
        raise TypeError(
            f"a list of {kind} values is not a gallery (galleries hold "
            f"{', '.join(sorted(GALLERY_TYPES))}); track each one under its own name"
        )
    return kind, items
