"""Text handler — inline if short, blob if long."""

from __future__ import annotations

from typing import Any

from ..wrappers import _TypeWrapper

INLINE_MAX_BYTES = 1024


class TextHandler:
    object_type = "text"
    mime_type = "text/plain"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        return isinstance(obj, str)

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        s = obj if isinstance(obj, str) else str(obj)
        data = s.encode("utf-8")
        meta: dict[str, Any] = {
            "length_chars": len(s),
            "length_bytes": len(data),
            "inline": len(data) <= INLINE_MAX_BYTES,
        }
        if meta["inline"]:
            meta["preview"] = s[:200]
        else:
            meta["preview"] = s[:200] + ("…" if len(s) > 200 else "")
        return data, meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> str:
        """Decode UTF-8 bytes back into a str."""
        return data.decode("utf-8")
