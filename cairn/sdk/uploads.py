"""Serialize-and-upload of one media value, shared by ``Run.track`` and
``cairn.Artifact`` (a figure's source and a table's media cells are blobs of
their own)."""

from __future__ import annotations

import json
from typing import Any

from .handlers.registry import HandlerRegistry, resolve_mime_type
from .handlers.table import MAX_ROWS as _TABLE_MAX_ROWS
from .wrappers import Audio, Image, Video


def upload_table_media(
    transport: Any, registry: HandlerRegistry, handler: Any, payload: Any,
) -> tuple[Any, list[str]]:
    """Upload a table's ``cairn.Image``/``Audio``/``Video`` cells as their own
    artifacts and put ``{"$media": {hash, mime_type, object_type}}`` in their place.

    Only tables are touched (any other handler gets ``payload`` back). The
    table is normalized first, so DataFrame cells are covered too; only the
    first ``MAX_ROWS`` rows are walked, as the rest are truncated anyway.
    Returns the (possibly rewritten) payload and the uploaded hashes, which
    go in the table's metadata so export can follow them.
    """
    if getattr(handler, "object_type", None) != "table":
        return payload, []
    names, rows = handler._normalize(payload)
    hashes: list[str] = []
    for row in rows[:_TABLE_MAX_ROWS]:
        for c, cell in enumerate(row):
            if not isinstance(cell, (Image, Audio, Video)):
                continue
            cell_handler = registry.find_by_type(cell.object_type)
            assert cell_handler is not None
            blob, meta = cell_handler.serialize(cell.obj, **cell.kwargs)
            mime = resolve_mime_type(cell_handler, cell.obj, cell.kwargs)
            digest = transport.upload_artifact(blob, mime, meta, object_type=cell.object_type)
            row[c] = {"$media": {"hash": digest, "mime_type": mime, "object_type": cell.object_type}}
            if digest not in hashes:
                hashes.append(digest)
    return {"columns": names, "data": rows, "dataframe": None}, hashes


def upload_value(
    transport: Any, registry: HandlerRegistry, handler: Any, payload: Any,
    kwargs: dict[str, Any],
) -> tuple[str, str, dict[str, Any], int]:
    """Serialize one value with ``handler`` and upload it (a figure's source
    and a table's media cells as blobs of their own). Returns its
    ``(hash, mime_type, metadata, size)``."""
    payload, media_hashes = upload_table_media(transport, registry, handler, payload)
    blob, meta = handler.serialize(payload, **kwargs)
    if media_hashes:
        meta["media_hashes"] = media_hashes
    source_blob = meta.pop("_source_blob", None)
    source_mime = meta.pop("_source_mime", None)
    if source_blob is not None and source_mime is not None:
        meta["source_hash"] = transport.upload_artifact(source_blob, source_mime, {})
    mime = resolve_mime_type(handler, payload, kwargs)
    digest = transport.upload_artifact(blob, mime, meta, object_type=handler.object_type)
    return digest, mime, meta, len(blob)


def upload_gallery(
    transport: Any, registry: HandlerRegistry, object_type: str, items: list[Any],
    kwargs: dict[str, Any],
) -> tuple[str, Any]:
    """Upload a gallery (``cairn.sdk.gallery``): each item as its own
    artifact, then the manifest naming them. ``kwargs`` apply to every item
    under the item's own; their ``caption`` labels the whole gallery.
    Returns the manifest's hash and that caption."""
    from .gallery import GALLERY_MIME

    kwargs = dict(kwargs)
    caption = kwargs.pop("caption", None)
    entries: list[dict[str, Any]] = []
    for item in items:
        merged = {**item.kwargs, **kwargs}
        item_caption = merged.pop("caption", None)
        digest, mime, meta, _size = upload_value(transport, registry, item.handler, item.payload, merged)
        entry: dict[str, Any] = {"hash": digest, "mime_type": mime, "metadata": meta}
        if item_caption is not None:
            entry["caption"] = str(item_caption)
        entries.append(entry)
    manifest = json.dumps({"items": entries}).encode()
    meta_out: dict[str, Any] = {"gallery": len(entries)}
    if object_type == "custom":
        meta_out["kind"] = entries[0]["metadata"].get("kind")
    preview = entries[0]["metadata"].get("preview")
    if preview is not None:
        meta_out["preview"] = preview
    digest = transport.upload_artifact(manifest, GALLERY_MIME, meta_out, object_type=object_type)
    return digest, caption
