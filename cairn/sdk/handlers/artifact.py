"""Artifact handler — generic file/bytes storage."""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from typing import Any


class ArtifactHandler:
    """Handles generic artifacts: bytes, file paths, or file-like objects.

    Metadata includes filename, size, and MIME type when available.
    """

    object_type = "artifact"
    mime_type = "application/octet-stream"

    def can_handle(self, obj: Any) -> bool:
        return False  # Only triggered via cairn.Artifact wrapper.

    def serialize(self, obj: Any, **kwargs: Any) -> tuple[bytes, dict[str, Any]]:
        meta: dict[str, Any] = {}

        if isinstance(obj, (str, Path)):
            # File path.
            path = Path(obj)
            data = path.read_bytes()
            meta["filename"] = path.name
            meta["size_bytes"] = len(data)
            mime, _ = mimetypes.guess_type(path.name)
            if mime:
                meta["mime_type"] = mime
                self.mime_type = mime
        elif isinstance(obj, (bytes, bytearray, memoryview)):
            data = bytes(obj)
            meta["size_bytes"] = len(data)
        elif hasattr(obj, "read"):
            # File-like object.
            data = obj.read()
            if isinstance(data, str):
                data = data.encode("utf-8")
            meta["size_bytes"] = len(data)
            name = getattr(obj, "name", None)
            if name:
                meta["filename"] = os.path.basename(name)
                mime, _ = mimetypes.guess_type(name)
                if mime:
                    meta["mime_type"] = mime
                    self.mime_type = mime
        else:
            raise TypeError(
                f"Artifact handler cannot serialize {type(obj).__name__}. "
                f"Pass bytes, a file path, or a file-like object."
            )

        # Pass through any extra kwargs as metadata.
        for k, v in kwargs.items():
            meta[k] = v

        return data, meta
