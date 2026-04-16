"""Content-addressable blob store.

On-disk layout matches CAIRN_SPEC §"Server-side storage layout"::

    artifacts/
      ab/
        abcd1234…ef/
          blob          # raw bytes
          meta.json     # mime_type, size, original metadata
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, BinaryIO


class BlobStore:
    """File-system backed content-addressable store."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def hash_bytes(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def dir_for(self, digest: str) -> Path:
        return self.root / digest[:2] / digest

    def path_for(self, digest: str) -> Path:
        return self.dir_for(digest) / "blob"

    def meta_path_for(self, digest: str) -> Path:
        return self.dir_for(digest) / "meta.json"

    def exists(self, digest: str) -> bool:
        return self.path_for(digest).exists()

    def size(self, digest: str) -> int:
        return self.path_for(digest).stat().st_size

    def put(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None = None
    ) -> tuple[str, int]:
        """Write ``data`` atomically; return ``(hash, size)``. Idempotent."""
        digest = self.hash_bytes(data)
        blob_dir = self.dir_for(digest)
        blob_path = self.path_for(digest)
        meta_path = self.meta_path_for(digest)

        if blob_path.exists():
            return digest, blob_path.stat().st_size

        blob_dir.mkdir(parents=True, exist_ok=True)

        # Atomic write: write to temp file in the same directory then rename.
        tmp_fd, tmp_name = tempfile.mkstemp(dir=blob_dir, prefix=".blob-", suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp_name, blob_path)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise

        meta = {
            "mime_type": mime_type,
            "size_bytes": len(data),
            "metadata": metadata or {},
        }
        # Meta is informational; non-atomic write is acceptable — it's
        # regenerable from the DB `artifacts` row if lost.
        meta_path.write_text(json.dumps(meta))
        return digest, len(data)

    def get(self, digest: str) -> tuple[bytes, dict[str, Any]]:
        data = self.path_for(digest).read_bytes()
        meta = json.loads(self.meta_path_for(digest).read_text())
        return data, meta

    def open_stream(self, digest: str) -> BinaryIO:
        """Open the blob for reading. Caller is responsible for closing."""
        return self.path_for(digest).open("rb")

    def delete(self, digest: str) -> None:
        """Best-effort removal (used by ``cairn rm``)."""
        blob = self.path_for(digest)
        meta = self.meta_path_for(digest)
        for p in (blob, meta):
            if p.exists():
                p.unlink()
        try:
            blob.parent.rmdir()
            blob.parent.parent.rmdir()
        except OSError:
            # Not empty or already gone — fine.
            pass
