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

import errno
import hashlib
import os
import secrets
import shutil
import tempfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any, BinaryIO


def fsync_dir(path: Path) -> None:
    """Make a rename/creation in ``path`` durable (no-op where directories
    cannot be opened, i.e. Windows)."""
    if os.name == "nt":
        return
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


class BlobStore:
    """File-system backed content-addressable store. Writes are durable
    before they return: data fsynced, renamed into place, directory fsynced."""

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
        """Write ``data`` atomically; return ``(hash, size)``. Idempotent.

        Bytes already stored are not rewritten, but their mtime is refreshed
        (see ``touch``). A garbage collection deleting the same digest at the
        same moment (``delete_if_older``) makes a step fail (the directory
        vanished); the put then simply starts over."""
        digest = self.hash_bytes(data)
        for _ in range(10):
            try:
                return digest, self._put_once(digest, data)
            except OSError as exc:
                # ENOENT, or EINVAL for a file created in a directory being
                # removed (macOS).
                if exc.errno not in (errno.ENOENT, errno.EINVAL):
                    raise
        return digest, self._put_once(digest, data)

    def _put_once(self, digest: str, data: bytes) -> int:
        blob_dir = self.dir_for(digest)
        blob_path = self.path_for(digest)
        if self.touch(digest):
            return blob_path.stat().st_size
        blob_dir.mkdir(parents=True, exist_ok=True)
        # Atomic write: write to temp file in the same directory then rename.
        tmp_fd, tmp_name = tempfile.mkstemp(dir=blob_dir, prefix=".blob-", suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_name, blob_path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
        fsync_dir(blob_dir)
        return len(data)

    def incoming(self) -> BinaryIO:
        """A temp file on the store's filesystem to stream an upload into;
        ``commit_incoming`` moves it into place once its hash is known."""
        tmp_dir = self.root / ".incoming"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        return tempfile.NamedTemporaryFile(dir=tmp_dir, prefix="up-", suffix=".tmp", delete=False)

    def commit_incoming(self, tmp_path: str | Path, digest: str) -> bool:
        """Move a fully written, fsynced upload (whose sha256 is ``digest``)
        into place; False when the blob was stored already (the upload is
        dropped, the stored copy refreshed as by ``touch``)."""
        for _ in range(10):
            if self.touch(digest):
                os.unlink(tmp_path)
                return False
            blob_dir = self.dir_for(digest)
            try:
                blob_dir.mkdir(parents=True, exist_ok=True)
                os.replace(tmp_path, self.path_for(digest))
            except OSError as exc:  # a concurrent gc removed the directory
                if exc.errno not in (errno.ENOENT, errno.EINVAL):
                    raise
                continue
            fsync_dir(blob_dir)
            return True
        raise OSError(errno.EAGAIN, f"could not store blob {digest}")

    def verify(self, digest: str) -> bool:
        """Whether the stored bytes still hash to ``digest`` (fsck's scrub)."""
        h = hashlib.sha256()
        with self.open_stream(digest) as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest() == digest

    def touch(self, digest: str) -> bool:
        """Mark an existing blob as just written (its mtime); False if absent.

        Garbage collection spares blobs younger than its grace period, so a
        writer that re-uses a stored blob (``put`` of the same bytes, the
        HTTP client's HEAD dedup) keeps it alive until the record naming it
        is ingested."""
        try:
            os.utime(self.path_for(digest))
            return True
        except FileNotFoundError:
            return False

    def iter_digests(self) -> Iterator[str]:
        """Every stored digest (directories named like one)."""
        for prefix in self.root.iterdir():
            if len(prefix.name) != 2 or not prefix.is_dir():
                continue
            for d in prefix.iterdir():
                if d.name.startswith(prefix.name) and len(d.name) == 64:
                    yield d.name

    def get(self, digest: str) -> bytes:
        return self.path_for(digest).read_bytes()

    def open_stream(self, digest: str) -> BinaryIO:
        """Open the blob for reading. Caller is responsible for closing."""
        return self.path_for(digest).open("rb")

    def delete_if_older(self, digest: str, cutoff: float) -> int | None:
        """Delete the blob unless its mtime is after ``cutoff`` (epoch
        seconds); return the bytes freed, or None when it was kept or gone.

        Safe against a concurrent ``put``/``touch`` of the same digest: the
        blob's directory is first renamed away (atomic), and its mtime is
        checked after that. A touch before the rename shows in the mtime
        (the blob is put back); one after it finds no blob, so the writer
        stores the bytes afresh.
        """
        d = self.dir_for(digest)
        trash = d.with_name(f".gc-{digest}-{os.getpid()}-{secrets.token_hex(4)}")
        try:
            os.rename(d, trash)
        except FileNotFoundError:
            return None
        try:
            st = (trash / "blob").stat()
        except FileNotFoundError:
            shutil.rmtree(trash, ignore_errors=True)
            return 0
        if st.st_mtime > cutoff:
            try:
                os.rename(trash, d)
            except OSError:  # a fresh copy is there already
                shutil.rmtree(trash, ignore_errors=True)
            return None
        shutil.rmtree(trash, ignore_errors=True)
        try:
            d.parent.rmdir()
        except OSError:
            pass
        return st.st_size

    def delete(self, digest: str) -> None:
        """Best-effort removal (garbage collection)."""
        shutil.rmtree(self.dir_for(digest), ignore_errors=True)
        try:
            self.dir_for(digest).parent.rmdir()
        except OSError:
            # Not empty or already gone — fine.
            pass
