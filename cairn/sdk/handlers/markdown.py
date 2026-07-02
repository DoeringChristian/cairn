"""Markdown handler — GFM text blobs.

Only reachable via the explicit ``cairn.Markdown`` wrapper (raw ``str`` is
already claimed by ``TextHandler``). The UI renders it with react-markdown +
remark-gfm, HTML escaping left ON (no raw-HTML passthrough). Size-capped at
10MB, mirroring ``TensorHandler``.
"""

from __future__ import annotations

from typing import Any

from ..wrappers import _TypeWrapper

MAX_BYTES = 10 * 1024 * 1024


class MarkdownHandler:
    object_type = "markdown"
    mime_type = "text/markdown"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        # Only explicit via cairn.Markdown — a raw str is TextHandler's.
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        s = obj if isinstance(obj, str) else str(obj)
        data = s.encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError(
                f"markdown is too large ({len(data)} bytes); max is {MAX_BYTES}"
            )
        stripped = s.strip()
        meta: dict[str, Any] = {
            "length_bytes": len(data),
            "preview": stripped[:160] + ("…" if len(stripped) > 160 else ""),
        }
        return data, meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> str:
        """Decode UTF-8 bytes back into a markdown str."""
        return data.decode("utf-8")
