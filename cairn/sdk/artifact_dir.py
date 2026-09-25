"""Multi-file artifacts: a directory, or files that live elsewhere.

``run.log_artifact("data/", name="dataset")`` uploads every file under the
directory content-addressed, then uploads and versions a MANIFEST naming them::

    {"files": [{"path": "train/0.png", "hash": "...", "size": 123, "mime": "image/png"},
               {"path": "raw.tar", "uri": "s3://bucket/raw.tar", "size": 9, "etag": "..."}]}

A :class:`Reference` records an external URI without uploading it (the second
entry above). ``use_artifact`` on a manifest version returns an
:class:`ArtifactDir` handle instead of bytes.
"""

from __future__ import annotations

import io
import json
import mimetypes
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Callable

#: Mime type of a multi-file artifact's manifest blob. The server keeps its own
#: copy (``cairn.server.run_archive``) to follow the file hashes on export.
MANIFEST_MIME = "application/vnd.cairn.artifact-manifest+json"


class Reference:
    """An external file recorded by URI, never uploaded::

        run.log_artifact(cairn.Reference("s3://bucket/raw.tar"), name="raw", artifact_type="dataset")
        run.log_artifact([cairn.Reference(u, path=f"shard{i}.tar") for i, u in enumerate(urls)], name="shards")

    Downloading it back (``ArtifactDir.read``/``download``) needs ``fsspec``
    and whatever filesystem the URI names.

    Args:
        uri: Where the file lives (``s3://``, ``gs://``, ``https://``, a
            local path, ...).
        path: The entry's name inside the artifact. Default: the URI's last
            segment.
        size: Size in bytes, recorded when given.
        etag: The storage's ETag or checksum, recorded when given.
    """

    def __init__(self, uri: str, path: str | None = None, *, size: int | None = None, etag: str | None = None):
        self.uri = str(uri)
        self.path = path if path is not None else (self.uri.rstrip("/").rsplit("/", 1)[-1] or self.uri)
        self.size = size
        self.etag = etag

    def entry(self) -> dict[str, Any]:
        """The manifest entry: ``{"path", "uri"}`` plus ``size``/``etag`` when set."""
        out: dict[str, Any] = {"path": self.path, "uri": self.uri}
        if self.size is not None:
            out["size"] = self.size
        if self.etag is not None:
            out["etag"] = self.etag
        return out

    def __repr__(self) -> str:
        return f"Reference({self.uri!r}, path={self.path!r})"


def is_multi_file(value: Any) -> bool:
    """A directory path, a :class:`Reference`, or a non-empty list of them."""
    if isinstance(value, Reference):
        return True
    if isinstance(value, (list, tuple)) and value and all(isinstance(v, Reference) for v in value):
        return True
    return isinstance(value, (str, Path)) and Path(value).is_dir()


def upload_manifest(transport: Any, value: Any) -> tuple[str, int, dict[str, Any]]:
    """Upload the files (content-addressed) and the manifest naming them.

    Returns ``(manifest_digest, total_file_bytes, metadata)``.
    """
    files: list[dict[str, Any]] = []
    if isinstance(value, (str, Path)):
        root = Path(value)
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            data = p.read_bytes()
            mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
            digest = transport.upload_artifact(data, mime, {})
            files.append({"path": p.relative_to(root).as_posix(), "hash": digest, "size": len(data), "mime": mime})
    else:
        refs = [value] if isinstance(value, Reference) else list(value)
        files = [r.entry() for r in refs]
    paths = [f["path"] for f in files]
    if len(set(paths)) != len(paths):
        raise ValueError("artifact entries must have distinct paths")
    total = sum(int(f.get("size") or 0) for f in files if "hash" in f)
    meta = {
        "n_files": len(files),
        "n_references": sum(1 for f in files if "uri" in f),
        "total_size": total,
    }
    blob = json.dumps({"files": files}, separators=(",", ":")).encode()
    digest = transport.upload_artifact(blob, MANIFEST_MIME, meta)
    return digest, total, meta


def _safe_relpath(path: str) -> PurePosixPath:
    rel = PurePosixPath(path)
    if rel.is_absolute() or ".." in rel.parts or not rel.parts:
        raise ValueError(f"unsafe path in artifact manifest: {path!r}")
    return rel


def _fsspec() -> Any:
    try:
        import fsspec
    except ImportError as exc:
        raise ImportError(
            "Reading an external reference needs fsspec (plus the filesystem for its "
            "scheme, e.g. s3fs for s3://): pip install fsspec"
        ) from exc
    return fsspec


class ArtifactDir:
    """A multi-file artifact version: its manifest entries, fetched on demand.

    Returned by ``Run.use_artifact`` and ``cairn.load_artifact`` for an
    artifact logged from a directory or ``Reference`` list; not constructed
    by hand.
    """

    def __init__(self, manifest: dict[str, Any], fetch: Callable[[str], bytes]):
        self._files: list[dict[str, Any]] = list(manifest.get("files", []))
        self._fetch = fetch

    @classmethod
    def from_bytes(cls, data: bytes, fetch: Callable[[str], bytes]) -> "ArtifactDir":
        """Build from manifest JSON bytes and a ``fetch(hash) -> bytes`` function."""
        return cls(json.loads(data), fetch)

    @property
    def files(self) -> list[dict[str, Any]]:
        """The manifest entries: ``{path, hash, size, mime}`` or ``{path, uri, size?, etag?}``."""
        return [dict(f) for f in self._files]

    def _entry(self, path: str) -> dict[str, Any]:
        for f in self._files:
            if f["path"] == path:
                return f
        raise KeyError(f"no file {path!r} in this artifact")

    def read(self, path: str) -> bytes:
        """One entry's bytes (an external reference is read through fsspec)."""
        entry = self._entry(path)
        if "hash" in entry:
            return self._fetch(entry["hash"])
        with _fsspec().open(entry["uri"], "rb") as f:
            return f.read()

    def open(self, path: str) -> BinaryIO:
        """One entry as a binary file object."""
        return io.BytesIO(self.read(path))

    def download(self, root: str | Path) -> Path:
        """Write every entry under ``root`` at its manifest path; returns ``root``."""
        root = Path(root)
        for f in self._files:
            dest = root.joinpath(*_safe_relpath(f["path"]).parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(self.read(f["path"]))
        return root

    def __len__(self) -> int:
        return len(self._files)

    def __repr__(self) -> str:
        return f"ArtifactDir({len(self._files)} files)"
