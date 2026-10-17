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
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import BinaryIO


def fsync_dir(path: Path) -> None:
    """Persist directory entries; real I/O errors must fail the upload.

    Windows does not support opening directories through this API.
    """
    if os.name == "nt":
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class BlobStore:
    """File-system backed content-addressable store. Writes are durable
    before they return: data fsynced, renamed into place, directory fsynced."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks = self.root / ".locks"
        self._locks.mkdir(exist_ok=True)
        # A previous creator may have died before syncing any of these
        # entries. Persist the complete path to the store before using it.
        root_path = self.root.resolve()
        for directory in (root_path, *root_path.parents):
            fsync_dir(directory)

    @contextmanager
    def _lock(self, digest: str) -> Iterator[None]:
        """Serialize writers and GC across processes, with at most 256 locks.

        Lock files are operational state and are never removed: replacing
        one would let different processes lock different inodes for a prefix.
        """
        prefix = digest[:2]
        if not prefix or any(c not in "0123456789abcdef" for c in prefix):
            prefix = "other"
        with (self._locks / (prefix + ".lock")).open("a+b") as stream:
            if os.name == "nt":
                import errno
                import msvcrt

                stream.seek(0)
                while True:
                    try:
                        msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
                        break
                    except OSError as exc:
                        if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                            raise
                try:
                    yield
                finally:
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
                try:
                    yield
                finally:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

    def _sync_blob_directory(self, digest: str) -> None:
        # The leaf owns the blob entry; its parent owns the digest directory;
        # the root owns the prefix directory. All three must be durable.
        directory = self.dir_for(digest)
        for path in (directory, directory.parent, self.root):
            fsync_dir(path)

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
        (see ``touch``). The prefix lock keeps GC from checking their age and
        deleting them while this write is in progress."""
        digest = self.hash_bytes(data)
        with self._lock(digest):
            return digest, self._put_once(digest, data)

    def _put_once(self, digest: str, data: bytes) -> int:
        blob_dir = self.dir_for(digest)
        blob_path = self.path_for(digest)
        if self._touch(digest):
            return blob_path.stat().st_size
        blob_dir.mkdir(parents=True, exist_ok=True)
        # Atomic write: write to temp file in the same directory then rename.
        tmp_fd, tmp_name = tempfile.mkstemp(
            dir=blob_dir, prefix=".blob-", suffix=".tmp"
        )
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
        self._sync_blob_directory(digest)
        return len(data)

    def incoming(self) -> BinaryIO:
        """A temp file on the store's filesystem to stream an upload into;
        ``commit_incoming`` moves it into place once its hash is known."""
        tmp_dir = self.root / ".incoming"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        return tempfile.NamedTemporaryFile(
            dir=tmp_dir, prefix="up-", suffix=".tmp", delete=False
        )

    def commit_incoming(self, tmp_path: str | Path, digest: str) -> bool:
        """Move a fully written, fsynced upload (whose sha256 is ``digest``)
        into place; False when the blob was stored already (the upload is
        dropped, the stored copy refreshed as by ``touch``)."""
        with self._lock(digest):
            if self._touch(digest):
                os.unlink(tmp_path)
                return False
            blob_dir = self.dir_for(digest)
            blob_dir.mkdir(parents=True, exist_ok=True)
            os.replace(tmp_path, self.path_for(digest))
            self._sync_blob_directory(digest)
            return True

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
        with self._lock(digest):
            return self._touch(digest)

    def _touch(self, digest: str) -> bool:
        try:
            os.utime(self.path_for(digest))
        except FileNotFoundError:
            return False
        # A killed writer may have renamed its fsynced bytes but not yet
        # persisted the directory entries. Dedup must complete that write.
        self._sync_blob_directory(digest)
        return True

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

        The same cross-process lock covers writes and the age check through
        deletion. A young blob stays at its normal path throughout GC, so a
        killed collector cannot strand live bytes in a hidden trash folder.
        """
        with self._lock(digest):
            try:
                st = self.path_for(digest).stat()
            except FileNotFoundError:
                return None
            if st.st_mtime > cutoff:
                return None
            shutil.rmtree(self.dir_for(digest))
            fsync_dir(self.dir_for(digest).parent)
            return st.st_size

    def delete(self, digest: str) -> None:
        """Best-effort removal (garbage collection)."""
        with self._lock(digest):
            shutil.rmtree(self.dir_for(digest), ignore_errors=True)


def open_blob_store(root: str | Path, *, cache_dir: Path | None = None):
    """Open a configured blob destination; local storage needs no service."""
    if str(root).startswith("s3://"):
        return S3BlobStore(str(root), cache_dir=cache_dir)
    return BlobStore(Path(root))


class S3BlobStore:
    """Immutable S3 objects with a verified local read cache.

    Automatic age-based collection is intentionally conservative: a HEAD
    followed by DELETE cannot atomically respect a concurrent writer's lease
    on general-purpose S3 buckets. Explicit deletion remains available.
    """

    def __init__(self, uri: str, *, cache_dir: Path | None = None):
        from urllib.parse import urlsplit

        try:
            import boto3
        except ImportError as exc:
            raise RuntimeError("S3 storage requires cairn-track[deployment]") from exc
        parsed = urlsplit(uri)
        if not parsed.netloc or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("expected s3://bucket/optional-prefix")
        self.bucket = parsed.netloc
        self.prefix = parsed.path.strip("/")
        self.uri = uri
        if cache_dir is None:
            from cairn import config

            cache_dir = config.cache_dir() / "server-blobs"
        namespace = hashlib.sha256(uri.rstrip("/").encode()).hexdigest()[:20]
        self.cache = BlobStore(Path(cache_dir) / namespace)
        self.root = self.cache.root
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("CAIRN_S3_ENDPOINT_URL")
            or os.environ.get("AWS_ENDPOINT_URL"),
        )

    hash_bytes = staticmethod(BlobStore.hash_bytes)

    def _key(self, digest):
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("blob digest must be a SHA-256 hex string")
        return "/".join(
            part for part in (self.prefix, digest[:2], digest, "blob") if part
        )

    def _head(self, digest):
        from botocore.exceptions import ClientError

        try:
            return self.client.head_object(Bucket=self.bucket, Key=self._key(digest))
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def exists(self, digest):
        return self._head(digest) is not None

    def touch(self, digest):
        # Remote automatic GC is disabled, so existing content needs no lease refresh.
        return self.exists(digest)

    def size(self, digest):
        head = self._head(digest)
        if head is None:
            raise FileNotFoundError(digest)
        return head["ContentLength"]

    def _upload(self, digest, body):
        from botocore.exceptions import ClientError

        try:
            self.client.put_object(
                Bucket=self.bucket,
                Key=self._key(digest),
                Body=body,
                IfNoneMatch="*",
                Metadata={"sha256": digest},
            )
            return True
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("PreconditionFailed", "412"):
                return False
            raise

    def put(self, data):
        digest = self.hash_bytes(data)
        self._upload(digest, data)
        # Cache errors must not turn a successful durable upload into failure.
        try:
            if self.cache.exists(digest) and not self.cache.verify(digest):
                self.cache.delete(digest)
            self.cache.put(data)
        except OSError:
            pass
        return digest, len(data)

    def incoming(self):
        return self.cache.incoming()

    def commit_incoming(self, tmp_path, digest):
        h = hashlib.sha256()
        with open(tmp_path, "rb") as stream:
            for chunk in iter(lambda: stream.read(1 << 20), b""):
                h.update(chunk)
            if h.hexdigest() != digest:
                raise ValueError("uploaded blob does not match its digest")
            stream.seek(0)
            created = self._upload(digest, stream)
        try:
            if self.cache.exists(digest) and not self.cache.verify(digest):
                self.cache.delete(digest)
            self.cache.commit_incoming(tmp_path, digest)
        finally:
            Path(tmp_path).unlink(missing_ok=True)
        return created

    def _download(self, digest):
        from botocore.exceptions import ClientError

        try:
            response = self.client.get_object(Bucket=self.bucket, Key=self._key(digest))
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                raise FileNotFoundError(digest) from exc
            raise
        body = response["Body"]
        temp = self.incoming()
        h = hashlib.sha256()
        try:
            with temp:
                for chunk in iter(lambda: body.read(1 << 20), b""):
                    h.update(chunk)
                    temp.write(chunk)
                temp.flush()
                os.fsync(temp.fileno())
            if h.hexdigest() != digest:
                raise OSError(f"S3 blob checksum mismatch: {digest}")
            self.cache.commit_incoming(temp.name, digest)
        finally:
            body.close()
            Path(temp.name).unlink(missing_ok=True)
        return self.cache.path_for(digest)

    def path_for(self, digest):
        self._key(digest)
        if self.cache.exists(digest):
            if self.cache.verify(digest):
                return self.cache.path_for(digest)
            self.cache.delete(digest)
        return self._download(digest)

    def get(self, digest):
        return self.path_for(digest).read_bytes()

    def open_stream(self, digest):
        return self.path_for(digest).open("rb")

    def verify(self, digest):
        # Scrubbing checks the authoritative remote bytes even with a warm cache.
        self.cache.delete(digest)
        try:
            self._download(digest)
            return True
        except (OSError, FileNotFoundError):
            return False

    def iter_digests(self):
        prefix = self.prefix + "/" if self.prefix else ""
        pages = self.client.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=prefix
        )
        for page in pages:
            for obj in page.get("Contents", []):
                suffix = obj["Key"][len(prefix) :].split("/")
                if len(suffix) == 3 and suffix[2] == "blob":
                    digest = suffix[1]
                    if (
                        len(digest) == 64
                        and suffix[0] == digest[:2]
                        and all(c in "0123456789abcdef" for c in digest)
                    ):
                        yield digest

    def delete_if_older(self, digest, cutoff):
        return None

    def delete(self, digest):
        self.client.delete_object(Bucket=self.bucket, Key=self._key(digest))
        self.cache.delete(digest)
