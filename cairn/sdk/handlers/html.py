"""HTML handler — sandboxed HTML report blobs.

Only reachable via the explicit ``cairn.Html`` wrapper (like Histogram/Tensor,
raw ``str`` is already claimed by ``TextHandler``). The UI renders the blob
strictly inside a ``sandbox="allow-scripts"`` ``srcdoc`` iframe — never inline
in the host document. Size-capped at 10MB, mirroring ``TensorHandler``.
"""

from __future__ import annotations

import re
from typing import Any

from ..wrappers import _TypeWrapper

MAX_BYTES = 10 * 1024 * 1024

_SCRIPT_STYLE_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_tags(html: str) -> str:
    """Best-effort plain-text preview: drop script/style bodies + tags, collapse whitespace."""
    text = _SCRIPT_STYLE_RE.sub(" ", html)
    text = _TAG_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


class HtmlHandler:
    object_type = "html"
    mime_type = "text/html"

    def can_handle(self, obj: Any) -> bool:
        if isinstance(obj, _TypeWrapper):
            return False
        # Only explicit via cairn.Html — a raw str is TextHandler's.
        return False

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        s = obj if isinstance(obj, str) else str(obj)
        data = s.encode("utf-8")
        if len(data) > MAX_BYTES:
            raise ValueError(
                f"html is too large ({len(data)} bytes); max is {MAX_BYTES}"
            )
        preview = _strip_tags(s)[:160]
        meta: dict[str, Any] = {
            "length_bytes": len(data),
            "preview": preview + ("…" if len(_strip_tags(s)) > 160 else ""),
        }
        return data, meta

    def deserialize(self, data: bytes, metadata: dict[str, Any] | None = None) -> str:
        """Decode UTF-8 bytes back into an HTML str."""
        return data.decode("utf-8")
