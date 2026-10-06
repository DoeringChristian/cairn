"""Content-addressable blob store.

On-disk layout:

```text
artifacts/
  ab/
    abcd1234…ef/
      blob          # raw bytes
```

The store holds bytes only. What they are (mime type, size, metadata) is the
database's `artifacts` row for the same hash: a second file written after the
blob could go missing (a writer killed in between) or be read before it
exists, leaving bytes that could not be read.
"""

from __future__ import annotations

import hashlib
import os
import shutil
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

    def exists(self, digest: str) -> bool:
        return self.path_for(digest).exists()

    def size(self, digest: str) -> int:
        return self.path_for(digest).stat().st_size

    def put(self, data: bytes) -> tuple[str, int]:
        """Write ``data`` atomically; return ``(hash, size)``. Idempotent."""
        digest = self.hash_bytes(data)
        blob_dir = self.dir_for(digest)
        blob_path = self.path_for(digest)

        if blob_path.exists():
            return digest, blob_path.stat().st_size

        blob_dir.mkdir(parents=True, exist_ok=True)

        # Atomic write: write to temp file in the same directory then rename.
        tmp_fd, tmp_name = tempfile.mkstemp(dir=blob_dir, prefix=".blob-", suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp_name, blob_path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
        return digest, len(data)

    def get(self, digest: str) -> bytes:
        return self.path_for(digest).read_bytes()

    def open_stream(self, digest: str) -> BinaryIO:
        """Open the blob for reading. Caller is responsible for closing."""
        return self.path_for(digest).open("rb")

    def delete(self, digest: str) -> None:
        """Best-effort removal (used by ``cairn rm``)."""
        shutil.rmtree(self.dir_for(digest), ignore_errors=True)
        try:
            self.dir_for(digest).parent.rmdir()
        except OSError:
            # Not empty or already gone — fine.
            pass
