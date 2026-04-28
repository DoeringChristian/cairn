"""Plugin handler — serializes arbitrary data for custom viewer plugins."""

from __future__ import annotations

import json
from typing import Any


class PluginHandler:
    """Handler for plugin-typed artifacts.

    Does not auto-dispatch (``can_handle`` always returns False). Only
    triggered via the ``cairn.Plugin`` wrapper or plugin class instances.
    The tracked value is serialized as raw bytes; plugin metadata (hash,
    lang, name) is injected by ``Run.track()`` and passed through kwargs.

    A unique prefix is prepended to the blob so that different plugins
    sharing the same data (e.g. ``b""``) get distinct artifact hashes
    (avoiding content-addressed dedup collisions on metadata).
    """

    object_type = "plugin"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:  # noqa: ARG002
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        # Serialize the value to bytes.
        if isinstance(obj, (bytes, bytearray, memoryview)):
            blob = bytes(obj)
        elif hasattr(obj, "tobytes"):
            # numpy arrays, torch tensors, etc.
            blob = obj.tobytes()
        else:
            blob = json.dumps(obj).encode("utf-8")

        # Extract plugin-specific metadata; pass through everything else.
        meta: dict[str, Any] = {}
        for k, v in kwargs.items():
            if k != "plugin":
                meta[k] = v

        # Prepend a header with plugin identity so different plugins
        # sharing the same data bytes get unique artifact hashes.
        plugin_name = meta.get("plugin_name", "")
        plugin_hash = meta.get("plugin_hash", "")
        header = f"cairn-plugin:{plugin_name}:{plugin_hash}\n".encode("utf-8")
        blob = header + blob

        return blob, meta
