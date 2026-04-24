"""Plugin handler — serializes arbitrary data for custom viewer plugins."""

from __future__ import annotations

import json
from typing import Any


class PluginHandler:
    """Handler for plugin-typed artifacts.

    Does not auto-dispatch (``can_handle`` always returns False). Only
    triggered via the ``cairn.Plugin`` wrapper. The tracked value is
    serialized as raw bytes; plugin metadata (hash, lang, name) is
    injected by ``Run.track()`` and passed through ``kwargs``.
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
        plugin_keys = {"plugin_hash", "plugin_lang", "plugin_name"}
        meta: dict[str, Any] = {}
        for k, v in kwargs.items():
            if k in plugin_keys or k not in ("plugin",):
                meta[k] = v
        return blob, meta
