"""Versioned artifacts: build a draft, log it, read versions back.

An artifact VERSION is an immutable manifest of entries, identified by
``project/name:vN``, with aliases, a producing run and consuming runs. Every
version stores one manifest blob (``MANIFEST_MIME``):

```json
{"files": [
  {"path": "model.pt",  "hash": "...", "size": 123, "mime": "application/octet-stream"},
  {"path": "state.pkl", "hash": "...", "size": 456, "mime": "application/python-pickle",
   "object_type": "pickle", "meta": {...}},
  {"path": "raw.tar",   "uri": "s3://bucket/raw.tar", "size": 9, "etag": "..."}
]}
```

Files are uploaded content-addressed (identical bytes are stored once across
versions); a reference records an external URI and is never uploaded.

* ``Artifact``: a draft (``add_file``, ``add_dir``, ``add_reference``,
  ``add``, ``new_file``), logged once with ``Run.log_artifact`` or
  ``cairn.log_artifact``.
* ``ArtifactVersion``: a logged version (``files``, ``get``, ``open``,
  ``download``, ``file``, lineage, aliases).
* ``ArtifactEntry``: one entry of a version.
* ``ArtifactFamily``: every version of one name in a project.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import logging
import mimetypes
import os
import secrets
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import IO, Any, BinaryIO, Callable, Iterator, Literal

log = logging.getLogger(__name__)

#: Mime type of an artifact version's manifest blob. The server keeps its own
#: copy (``cairn.server.artifact_refs``); a unit test pins the two together.
MANIFEST_MIME = "application/vnd.cairn.artifact-manifest+json"

#: Environment variable naming the root that ``download()`` writes under by
#: default (``<root>/<name>-v<N>/``); unset means ``./artifacts``.
ARTIFACT_DIR_ENV = "CAIRN_ARTIFACT_DIR"


def _entry_path(path: str) -> str:
    """A normalised, safe entry path (posix, relative, no ``..``)."""
    if not isinstance(path, str) or not path:
        raise ValueError("an entry path must be a non-empty string")
    rel = PurePosixPath(path.replace("\\", "/"))
    if rel.is_absolute() or ".." in rel.parts or not rel.parts or str(rel) == ".":
        raise ValueError(f"unsafe artifact entry path {path!r}")
    return rel.as_posix()


#: ``add_file`` / ``add_dir``: copy now (``"mutable"``) or read at log time.
Policy = Literal["mutable", "immutable"]


def _check_policy(policy: str) -> None:
    if policy not in ("mutable", "immutable"):
        raise ValueError(f"policy must be 'mutable' or 'immutable', not {policy!r}")


def _check_name(name: str) -> str:
    if not isinstance(name, str):
        raise TypeError(f"artifact name must be str, got {type(name).__name__}")
    if not name.strip():
        raise ValueError("artifact name must not be empty")
    if ":" in name or "/" in name:
        raise ValueError(f"artifact name {name!r} must not contain ':' or '/'")
    return name


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _guess_mime(path: str) -> str:
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


# ---------------------------------------------------------------------------
# Entries
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ArtifactEntry:
    """One entry of an artifact: an uploaded file, a serialized object, or an
    external reference.

    Attributes:
        path: The entry's path inside the artifact (posix, relative).
        size: Size in bytes (None for a reference of unknown size, or a
            staged entry not read yet).
        digest: SHA-256 of the stored bytes; None for a reference (and for a
            draft's entries until logged).
        uri: Where a reference lives (``s3://``, ``file://``, a local path,
            ...); None for an uploaded entry.
        mime: MIME type of the stored bytes.
        object_type: The cairn type that ``ArtifactVersion.get`` decodes it
            with (``"pickle"``, ``"image"``, ...); None for a plain file.
        etag: A reference's recorded ETag / checksum, or None.
        meta: Handler metadata of a serialized object.
    """

    path: str
    size: int | None = None
    digest: str | None = None
    uri: str | None = None
    mime: str | None = None
    object_type: str | None = None
    etag: str | None = None
    meta: dict[str, Any] = field(default_factory=dict, compare=False)
    _version: "ArtifactVersion | None" = field(default=None, repr=False, compare=False)

    @property
    def is_reference(self) -> bool:
        """True for an external reference (``uri`` set, nothing uploaded)."""
        return self.uri is not None

    def _owner(self) -> "ArtifactVersion":
        if self._version is None:
            raise RuntimeError(
                f"entry {self.path!r} belongs to an artifact draft; log it first"
            )
        return self._version

    def read(self) -> bytes:
        """The entry's bytes (a reference is read from its URI; see ``download``)."""
        return self._owner()._read_entry(self)

    def open(self) -> BinaryIO:
        """The entry as a binary file object."""
        return io.BytesIO(self.read())

    def download(self, root: str | Path | None = None) -> Path:
        """Write the entry under ``root`` at its path (default root: the
        version's, see ``ArtifactVersion.download``); returns the file's path."""
        return self._owner().file(self.path, root=root)


# ---------------------------------------------------------------------------
# Draft
# ---------------------------------------------------------------------------

@dataclass
class _Staged:
    kind: str  # "file" | "value" | "reference"
    source: Any = None  # local Path, the value, or the URI
    size: int | None = None
    etag: str | None = None


class Artifact:
    """A draft artifact version: built locally, logged once.

    ```python
    art = cairn.Artifact("cifar10", type="dataset", metadata={"n_train": 50_000})
    art.add_dir("data/cifar10/train", name="train")
    art.add_file("data/cifar10/labels.json")
    art.add_reference("s3://bucket/cifar10/raw.tar", size=170_498_071)
    with art.new_file("stats.json") as f:
        json.dump(stats, f)
    run.log_artifact(art, aliases=["normalised"])
    ```

    Files are read when the draft is LOGGED, not when added. Logging the
    same draft twice creates two versions.

    Args:
        name: The artifact's name in its project; every logged draft of this
            name is a new version of it. Must not contain ``:`` or ``/``.
        type: The family's type (``"dataset"``, ``"model"``, ...). A family
            keeps one type: logging a draft of another type raises.
        description: Free text stored on the version.
        metadata: A JSON dict stored on the version.
        tags: Labels stored on the version (unlike aliases, a tag may be on
            any number of versions).

    Raises:
        TypeError: ``name`` is not a string (e.g. old ``cairn.Artifact(obj)``
            code; that wrapper is now ``cairn.Pickle``).
        ValueError: ``name`` is empty or contains ``:`` or ``/``.
    """

    def __init__(
        self,
        name: str,
        type: str = "artifact",
        *,
        description: str | None = None,
        metadata: dict[str, Any] | None = None,
        tags: list[str] | None = None,
    ) -> None:
        self.name = _check_name(name)
        if not isinstance(type, str) or not type:
            raise ValueError("artifact type must be a non-empty string")
        self.type = type
        self.description = description
        self.metadata: dict[str, Any] = dict(metadata or {})
        self.tags: list[str] = list(tags or [])
        self._entries: dict[str, _Staged] = {}
        self._tmp: tempfile.TemporaryDirectory[str] | None = None

    # ---- building ------------------------------------------------------------

    def _stage(self, path: str, staged: _Staged) -> ArtifactEntry:
        path = _entry_path(path)
        if path in self._entries:
            raise ValueError(f"artifact {self.name!r} already has an entry at {path!r}")
        self._entries[path] = staged
        return self._staged_entry(path, staged)

    @staticmethod
    def _staged_entry(path: str, s: _Staged) -> ArtifactEntry:
        if s.kind == "reference":
            return ArtifactEntry(path, size=s.size, uri=s.source, etag=s.etag)
        if s.kind == "file":
            return ArtifactEntry(path, size=s.size, mime=_guess_mime(path))
        return ArtifactEntry(path)

    def add_file(
        self, local_path: str | Path, name: str | None = None, *, policy: Policy = "mutable",
    ) -> ArtifactEntry:
        """Add one file at entry path ``name`` (default: its basename).

        ``policy`` (as in wandb): ``"mutable"`` (default) copies the file now,
        so changing or deleting it before ``log_artifact`` does not affect
        the version; ``"immutable"`` skips the copy and reads the file when
        the artifact is logged (for large files you will not touch).

        Raises:
            FileNotFoundError: ``local_path`` is not a file.
            ValueError: The artifact already has an entry at that path, or an
                unknown ``policy``.
        """
        _check_policy(policy)
        p = Path(local_path)
        if not p.is_file():
            raise FileNotFoundError(f"no such file: {p}")
        return self._stage(name if name is not None else p.name, self._staged_file(p, policy))

    def add_dir(
        self, local_path: str | Path, name: str | None = None, *, policy: Policy = "mutable",
    ) -> list[ArtifactEntry]:
        """Add every file under ``local_path`` (recursive, sorted, symlinks
        followed, hidden files included) at its relative path, under the
        prefix ``name`` (default: the artifact's root). ``policy`` as in
        ``add_file``: ``"mutable"`` (default) copies the files now.

        Raises:
            NotADirectoryError: ``local_path`` is not a directory.
            ValueError: An entry path is already taken, or an unknown ``policy``.
        """
        _check_policy(policy)
        root = Path(local_path)
        if not root.is_dir():
            raise NotADirectoryError(f"no such directory: {root}")
        out = []
        for dirpath, _dirs, files in sorted(os.walk(root, followlinks=True)):
            for fname in sorted(files):
                p = Path(dirpath) / fname
                rel = p.relative_to(root).as_posix()
                path = f"{name.rstrip('/')}/{rel}" if name else rel
                out.append(self._stage(path, self._staged_file(p, policy)))
        return out

    def _staging_dir(self) -> Path:
        if self._tmp is None:
            self._tmp = tempfile.TemporaryDirectory(prefix="cairn-artifact-")
        return Path(self._tmp.name)

    def _staged_file(self, p: Path, policy: Policy) -> _Staged:
        """``p`` as staged: a copy taken now (mutable) or the path itself."""
        if policy == "mutable":
            copy = self._staging_dir() / secrets.token_hex(8)
            shutil.copyfile(p, copy)
            p = copy
        return _Staged("file", p, p.stat().st_size)

    def add_reference(
        self, uri: str, name: str | None = None, *, size: int | None = None,
        etag: str | None = None,
    ) -> ArtifactEntry:
        """Record an external file by URI; it is never uploaded.

        ``name`` defaults to the URI's last segment. A local path or
        ``file://`` URI gets its ``size`` filled in. Reading it back needs a
        filesystem cairn can reach (local, or ``fsspec`` for its scheme).
        """
        uri = str(uri)
        path = name if name is not None else (uri.rstrip("/").rsplit("/", 1)[-1] or uri)
        local = _local_path(uri)
        if size is None and local is not None and local.is_file():
            size = local.stat().st_size
        return self._stage(path, _Staged("reference", uri, size, etag))

    def add(self, value: Any, name: str) -> ArtifactEntry:
        """Serialize ``value`` at entry path ``name`` (at log time).

        A cairn wrapper (``cairn.Pickle``, ``cairn.Image``, ``cairn.Table``,
        ``cairn.Tensor``, ``cairn.Text``, ...) is stored with its handler;
        ``bytes`` are stored as is; ANY other value is pickled (no media
        detection: a numpy array is pickled, not stored as audio).
        ``ArtifactVersion.get(name)`` decodes it back.
        """
        return self._stage(name, _Staged("value", value))

    @contextlib.contextmanager
    def new_file(self, name: str, mode: str = "w", encoding: str = "utf-8") -> Iterator[IO[Any]]:
        """A writable file in a private staging dir; on exit it is added at
        ``name``. ``mode`` is ``"w"`` (text) or ``"wb"``."""
        if mode not in ("w", "wb"):
            raise ValueError("new_file mode must be 'w' or 'wb'")
        path = _entry_path(name)
        if path in self._entries:
            raise ValueError(f"artifact {self.name!r} already has an entry at {path!r}")
        local = self._staging_dir() / secrets.token_hex(8)
        f = local.open(mode, encoding=encoding if mode == "w" else None)
        try:
            yield f
        finally:
            f.close()
        self._stage(path, _Staged("file", local, local.stat().st_size))

    def remove(self, name: str) -> None:
        """Remove a staged entry, or every entry under the prefix ``name``.

        Raises:
            KeyError: Nothing is staged at or under ``name``.
        """
        path = _entry_path(name)
        gone = [p for p in self._entries if p == path or p.startswith(path + "/")]
        if not gone:
            raise KeyError(f"no entry {path!r} in artifact {self.name!r}")
        for p in gone:
            del self._entries[p]

    def files(self) -> list[ArtifactEntry]:
        """The staged entries, by path."""
        return [self._staged_entry(p, self._entries[p]) for p in sorted(self._entries)]

    def __repr__(self) -> str:
        return f"Artifact({self.name!r}, type={self.type!r}, {len(self._entries)} entries)"

    # ---- logging -------------------------------------------------------------

    def _build_manifest(self, transport: Any, registry: Any) -> tuple[str, list[dict[str, Any]]]:
        """Upload every entry and the manifest; returns ``(manifest digest, files)``."""
        from .handlers.pickle import PickleHandler
        from .uploads import upload_value
        from .wrappers import _TypeWrapper

        if not self._entries:
            raise ValueError(f"artifact {self.name!r} has no entries")
        files: list[dict[str, Any]] = []
        for path in sorted(self._entries):
            s = self._entries[path]
            if s.kind == "reference":
                entry: dict[str, Any] = {"path": path, "uri": s.source}
                if s.size is not None:
                    entry["size"] = s.size
                if s.etag is not None:
                    entry["etag"] = s.etag
            elif s.kind == "file":
                data = Path(s.source).read_bytes()
                mime = _guess_mime(path)
                digest = transport.upload_artifact(data, mime, {})
                entry = {"path": path, "hash": digest, "size": len(data), "mime": mime}
            else:
                value = s.source
                if isinstance(value, (bytes, bytearray, memoryview)):
                    data = bytes(value)
                    mime = _guess_mime(path)
                    digest = transport.upload_artifact(data, mime, {})
                    entry = {"path": path, "hash": digest, "size": len(data), "mime": mime}
                else:
                    if isinstance(value, _TypeWrapper):
                        handler = registry.find_by_type(value.object_type)
                        payload, kwargs = value.obj, dict(value.kwargs)
                        kwargs.pop("caption", None)
                    else:
                        handler, payload, kwargs = PickleHandler(), value, {}
                    if handler is None:
                        raise TypeError(f"no handler for {type(value).__name__}")
                    digest, mime, meta, size = upload_value(transport, registry, handler, payload, kwargs)
                    entry = {"path": path, "hash": digest, "size": size, "mime": mime,
                             "object_type": handler.object_type}
                    if meta:
                        entry["meta"] = meta
            files.append(entry)
        blob = json.dumps({"files": files}, separators=(",", ":"), sort_keys=True).encode()
        digest = transport.upload_artifact(blob, MANIFEST_MIME, {"n_files": len(files)})
        return digest, files


def default_entry_path(name: str, value: Any, registry: Any) -> str:
    """The shorthand's entry path for a value: ``<name>.<ext>`` from the
    mime its handler stores (``ckpt.pkl``, ``samples.png``, ``raw.bin``)."""
    from .handlers.pickle import PickleHandler
    from .handlers.registry import resolve_mime_type
    from .wrappers import _TypeWrapper

    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"{name}.bin"
    if isinstance(value, _TypeWrapper):
        handler = registry.find_by_type(value.object_type)
        try:
            mime = resolve_mime_type(handler, value.obj, value.kwargs) if handler else ""
        except Exception:  # noqa: BLE001
            mime = getattr(handler, "mime_type", "")
    else:
        mime = PickleHandler.mime_type
    ext = _EXTENSIONS.get(mime) or mimetypes.guess_extension(mime or "") or ".bin"
    return f"{name}{ext}"


_EXTENSIONS = {
    "application/python-pickle": ".pkl",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/html": ".html",
    "application/json": ".json",
}


def draft_from_shorthand(value: Any, name: str | None, type: str, registry: Any) -> Artifact:
    """``log_artifact``'s shorthand: a directory path, a file path, or any
    other value, as a one-call draft named ``name``."""
    if name is None:
        raise TypeError("log_artifact needs a name unless it is given a cairn.Artifact")
    art = Artifact(name, type)
    # No copy: the shorthand is logged at once, the files read right away.
    if isinstance(value, (str, Path)) and Path(value).is_dir():
        art.add_dir(value, policy="immutable")
    elif isinstance(value, (str, Path)) and Path(value).is_file():
        art.add_file(value, policy="immutable")
    elif isinstance(value, (str, Path)):
        # A string is a path here; store text with cairn.Text or Artifact.add.
        raise FileNotFoundError(f"no such file or directory: {value}")
    else:
        art.add(value, default_entry_path(name, value, registry))
    return art


# ---------------------------------------------------------------------------
# References
# ---------------------------------------------------------------------------

def _local_path(uri: str) -> Path | None:
    """The local path a reference names (``file://`` or a bare path), else None."""
    if uri.startswith("file://"):
        from urllib.parse import unquote, urlparse

        return Path(unquote(urlparse(uri).path))
    if "://" in uri:
        return None
    return Path(uri)


def _fsspec_for(uri: str) -> Any | None:
    """fsspec, when it is installed and knows the URI's scheme; else None."""
    try:
        import fsspec
    except ImportError:
        return None
    scheme = uri.split("://", 1)[0]
    try:
        fsspec.get_filesystem_class(scheme)
    except (ImportError, ValueError):
        return None
    return fsspec


def _read_reference(uri: str) -> bytes:
    local = _local_path(uri)
    if local is not None:
        return local.read_bytes()
    fs = _fsspec_for(uri)
    if fs is None:
        raise OSError(
            f"cannot read {uri}: needs fsspec and the filesystem for its scheme "
            "(e.g. s3fs for s3://)"
        )
    with fs.open(uri, "rb") as f:
        return f.read()


def _can_read_reference(uri: str) -> bool:
    local = _local_path(uri)
    if local is not None:
        return local.is_file()
    return _fsspec_for(uri) is not None


# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


class ArtifactVersion:
    """One logged version of an artifact: an immutable view, read lazily.

    Returned by ``Run.log_artifact``, ``Run.use_artifact``,
    ``cairn.log_artifact``, ``Reader.artifact``, ``Reader.artifact_versions``
    and the lineage methods. Not constructed by hand.

    On a local repo ``log_artifact`` returns a PENDING version: the run only
    logs it, and the version number (and ``latest``) is assigned when the
    repo ingests the run's log. Until then ``version`` is None and the read
    and lineage methods raise ``RuntimeError``; ``wait()`` blocks until it
    is assigned. Against a server the version is registered at once.
    """

    def __init__(self, info: dict[str, Any], backend: Callable[[], Any] | Any | None) -> None:
        self._info = info
        self._backend_src = backend
        self._backend_obj: Any = None
        self._files: list[ArtifactEntry] | None = None

    # ---- plumbing ----

    @property
    def _backend(self) -> Any:
        if self.pending:
            raise RuntimeError(
                f"artifact version {self.name!r} is pending (its run's log is not ingested "
                "yet); call .wait() first"
            )
        return self._resolved_backend()

    def _resolved_backend(self) -> Any:
        if self._backend_obj is None:
            src = self._backend_src
            self._backend_obj = src() if callable(src) else src
        return self._backend_obj

    def wait(self, timeout: float | None = None) -> ArtifactVersion:
        """Block until the repo has registered this version (its run's log
        is ingested: within ~2 s under a running ``cairn ui``/``cairn
        server``, else this process catches up itself), then fill in
        ``version``, ``aliases`` and the rest. Returns at once for a version
        that is not pending. Returns ``self``.

        Raises:
            TimeoutError: Still not registered after ``timeout`` seconds.
        """
        if not self.pending:
            return self
        deadline = None if timeout is None else time.monotonic() + timeout
        backend = self._resolved_backend()
        while True:
            info = backend.artifact_version(self.id)
            if info is not None:
                self._info = info
                self._files = None
                return self
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError(
                    f"artifact version {self.name!r} was not registered within {timeout} s"
                )
            time.sleep(0.1)

    # ---- identity ----

    @property
    def pending(self) -> bool:
        """True for a version logged by a local run and not ingested yet."""
        return self._info.get("version") is None

    @property
    def id(self) -> str:
        """The version's id."""
        return self._info["id"]

    @property
    def name(self) -> str:
        """The artifact's (family's) name."""
        return self._info["name"]

    @property
    def type(self) -> str:
        """The family's type."""
        return self._info["type"]

    @property
    def project(self) -> str:
        """The project id."""
        return self._info["project_id"]

    @property
    def version(self) -> int | None:
        """The version number within the family, from 1 (None while pending)."""
        return self._info.get("version")

    @property
    def ref(self) -> str:
        """``"name:vN"``: names this version for good."""
        return f"{self.name}:v{self.version}"

    @property
    def qualified_ref(self) -> str:
        """``"project/name:vN"``."""
        return f"{self.project}/{self.ref}"

    @property
    def aliases(self) -> list[str]:
        """Aliases pointing here when this object was fetched (``latest``
        first when this is the newest version)."""
        return list(self._info.get("aliases") or [])

    @property
    def metadata(self) -> dict[str, Any]:
        """The version's metadata dict."""
        return dict(self._info.get("metadata") or {})

    @property
    def tags(self) -> list[str]:
        """The version's tags when this object was fetched."""
        return list(self._info.get("tags") or [])

    @property
    def description(self) -> str | None:
        return self._info.get("description")

    @property
    def digest(self) -> str | None:
        """SHA-256 of the version's manifest."""
        return self._info.get("digest")

    @property
    def size(self) -> int:
        """Total bytes of the uploaded entries (references excluded)."""
        return int(self._info.get("size") or 0)

    @property
    def step(self) -> int | None:
        """The step it was logged at, or None."""
        return self._info.get("step")

    @property
    def created_at(self) -> datetime | None:
        return _parse_dt(self._info.get("created_at"))

    def __repr__(self) -> str:
        if self.pending:
            return f"ArtifactVersion({self.name!r}, pending)"
        return f"ArtifactVersion({self.qualified_ref!r}, type={self.type!r}, aliases={self.aliases})"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, ArtifactVersion) and other.id == self.id

    def __hash__(self) -> int:
        return hash(self.id)

    # ---- entries ----

    def files(self) -> list[ArtifactEntry]:
        """The manifest's entries, by path."""
        if self._files is None:
            self._files = [
                ArtifactEntry(
                    path=f["path"], size=f.get("size"), digest=f.get("digest"),
                    uri=f.get("uri"), mime=f.get("mime"), object_type=f.get("object_type"),
                    etag=f.get("etag"), meta=f.get("meta") or {}, _version=self,
                )
                for f in self._backend.version_files(self.id)
            ]
        return list(self._files)

    def get_entry(self, path: str) -> ArtifactEntry:
        """One entry. Raises ``KeyError`` when there is none at ``path``."""
        for e in self.files():
            if e.path == path:
                return e
        raise KeyError(f"no entry {path!r} in {self.ref}")

    def _read_entry(self, entry: ArtifactEntry) -> bytes:
        if entry.digest is not None:
            return self._backend.get_artifact_bytes(entry.digest)
        assert entry.uri is not None
        return _read_reference(entry.uri)

    def get(self, path: str | None = None) -> Any:
        """The DECODED value of an entry: an object logged with ``add`` (or the
        shorthand) comes back as it was (pickles unpickled, wrappers decoded
        by their type); a plain file comes back as ``bytes``.

        ``path=None`` is allowed when the version has exactly one entry:
        ``run.use_artifact("ckpt:best").get()``.
        """
        if path is None:
            files = self.files()
            if len(files) != 1:
                raise ValueError(
                    f"{self.ref} has {len(files)} entries; name one: "
                    + ", ".join(repr(f.path) for f in files[:5])
                )
            entry = files[0]
        else:
            entry = self.get_entry(path)
        data = entry.read()
        if not entry.object_type:
            return data
        from . import handlers as _handlers  # noqa: F401  (register built-ins)
        from .handlers.registry import default_registry

        handler = default_registry.find_by_type(entry.object_type)
        if handler is None or not hasattr(handler, "deserialize"):
            return data
        value = handler.deserialize(data, entry.meta)
        if entry.object_type == "table":
            from .reader import _table_media_refs

            return _table_media_refs(value, self._backend)
        return value

    def open(self, path: str, mode: str = "rb") -> IO[Any]:
        """An entry as a file object: ``"rb"`` (bytes) or ``"r"`` (utf-8 text)."""
        if mode not in ("rb", "r"):
            raise ValueError("mode must be 'rb' or 'r'")
        data = self.get_entry(path).read()
        return io.BytesIO(data) if mode == "rb" else io.StringIO(data.decode("utf-8"))

    def _default_root(self) -> Path:
        base = os.environ.get(ARTIFACT_DIR_ENV) or "artifacts"
        return Path(base) / f"{self.name}-v{self.version}"

    def _write_entry(self, entry: ArtifactEntry, root: Path) -> Path | None:
        dest = root.joinpath(*PurePosixPath(_entry_path(entry.path)).parts)
        if entry.digest is not None:
            if dest.is_file() and _sha256_file(dest) == entry.digest:
                return dest
            data = self._backend.get_artifact_bytes(entry.digest)
        else:
            assert entry.uri is not None
            if not _can_read_reference(entry.uri):
                log.warning(
                    "artifact %s: skipped reference %r -> %s (cairn cannot read this URI; "
                    "install fsspec and the filesystem for its scheme)",
                    self.ref, entry.path, entry.uri,
                )
                return None
            local = _local_path(entry.uri)
            dest.parent.mkdir(parents=True, exist_ok=True)
            if local is not None:
                shutil.copyfile(local, dest)
                return dest
            data = _read_reference(entry.uri)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(f".{dest.name}.{secrets.token_hex(4)}.tmp")
        tmp.write_bytes(data)
        tmp.replace(dest)
        return dest

    def download(self, root: str | Path | None = None) -> Path:
        """Write every entry under ``root`` at its path and return ``root``.

        The default root is ``$CAIRN_ARTIFACT_DIR/<name>-v<N>/``, or
        ``./artifacts/<name>-v<N>/`` when the variable is unset. A file already
        there with the right digest is not fetched again. A reference is
        copied when cairn can read its URI (a local path or ``file://``, or
        any scheme ``fsspec`` knows); otherwise it is skipped with a warning
        (``files()`` still lists it).
        """
        root = Path(root) if root is not None else self._default_root()
        root.mkdir(parents=True, exist_ok=True)
        for entry in self.files():
            self._write_entry(entry, root)
        return root

    def file(self, path: str, root: str | Path | None = None) -> Path:
        """Download one entry (as ``download`` would) and return its local path.

        Raises:
            KeyError: No entry at ``path``.
            OSError: The entry is a reference cairn cannot read.
        """
        entry = self.get_entry(path)
        out = self._write_entry(entry, Path(root) if root is not None else self._default_root())
        if out is None:
            raise OSError(f"cannot read reference {entry.uri}")
        return out

    # ---- lineage ----

    def logged_by(self) -> Any:
        """The run that logged this version (a ``Reader.Run``), or None for a
        run-less version or a deleted run."""
        run_id = self._info.get("created_by_run") if not self.pending else None
        if self.pending:
            self._backend  # noqa: B018  (raises)
        if not run_id:
            return None
        from .reader import Run as _ReaderRun

        try:
            return _ReaderRun(self._backend.get_run(run_id)["run"], self._backend)
        except Exception:  # noqa: BLE001  (a deleted producer)
            return None

    def used_by(self, role: str | None = None) -> list[Any]:
        """Runs that consumed this exact version (``Reader.Run``s), oldest
        consumption first; only ``role``'s when given."""
        from .reader import Run as _ReaderRun

        out = []
        for c in self._backend.version_consumers(self.id):
            if role is not None and c["role"] != role:
                continue
            try:
                out.append(_ReaderRun(self._backend.get_run(c["run"]["id"])["run"], self._backend))
            except Exception:  # noqa: BLE001  (a deleted consumer)
                continue
        return out

    def lineage(self, *, depth: int | None = None, direction: str = "both") -> dict[str, Any]:
        """The lineage graph around this version, as the UI's lineage view
        draws it.

        Args:
            depth: At most this many hops from this version (None: all).
            direction: ``"upstream"`` (where it came from: its producing run,
                that run's inputs, their producers, ...), ``"downstream"``
                (what came of it: its consumers, their outputs, ...) or
                ``"both"``.

        Returns:
            ``{"nodes", "edges", "groups", "center"}``: run and
            artifact-version nodes, ``produced`` (run -> version) and
            ``consumed`` (version -> run, with ``role``) edges; ``center`` is
            this version's id.
        """
        return self._backend.version_lineage(self.id, depth=depth, direction=direction)

    # ---- aliases ----

    def add_alias(self, alias: str) -> None:
        """Point a user alias at this version (moving it from another version
        of the family). ``latest`` and ``v<N>`` are reserved: ``ValueError``."""
        _check_alias(alias)
        self._info = self._backend.add_alias(self.id, alias)

    def remove_alias(self, alias: str) -> None:
        """Remove a user alias from this version. ``latest`` / ``v<N>``:
        ``ValueError``."""
        _check_alias(alias)
        self._info = self._backend.remove_alias(self.id, alias)

    # ---- tags and edits ----

    def add_tag(self, tag: str) -> None:
        """Add a tag to this version (a no-op when it has it)."""
        if not isinstance(tag, str) or not tag.strip():
            raise ValueError("a tag must be a non-empty string")
        self._info = self._backend.add_version_tag(self.id, tag)

    def remove_tag(self, tag: str) -> None:
        """Remove a tag from this version (a no-op when it does not have it)."""
        self._info = self._backend.remove_version_tag(self.id, tag)

    def update(self, *, description: str | None = None, metadata: dict[str, Any] | None = None) -> None:
        """Replace the description and/or merge keys into the metadata. The
        entries are immutable; only these annotations change."""
        self._info = self._backend.update_version(self.id, description=description, metadata=metadata)

    def delete(self, *, force: bool = False) -> None:
        """Delete this version from the registry.

        A version that an alias names (``latest`` included) is refused with
        ``ValueError`` unless ``force=True``; then its aliases go with it and
        ``latest`` moves to the newest remaining version. Version numbers are
        never reused.
        """
        self._backend.delete_version(self.id, force=force)


def _check_alias(alias: str) -> None:
    import re

    if not isinstance(alias, str) or not alias:
        raise ValueError("alias must be a non-empty string")
    if re.fullmatch(r"latest|v\d+", alias):
        raise ValueError(
            f"alias {alias!r} is reserved ('latest' always names the newest version, "
            "'vN' names version N)"
        )
    if ":" in alias or "/" in alias:
        raise ValueError(f"alias {alias!r} must not contain ':' or '/'")


@dataclass
class ArtifactFamily:
    """Every version of one artifact name in a project, from
    ``Reader.artifact_families``.

    Attributes:
        name: The artifact's name.
        type: Its type (one per family).
        project: The project id.
        description: The family's description, or None.
        versions: How many versions it has.
        aliases: ``{alias: version number}``, ``latest`` included.
        created_at / updated_at: ISO 8601 strings.
    """

    name: str
    type: str
    project: str
    description: str | None
    versions: int
    aliases: dict[str, int]
    created_at: str
    updated_at: str
    _backend: Any = field(default=None, repr=False, compare=False)

    def versions_list(self) -> list[ArtifactVersion]:
        """Every version, oldest first (v1..vN)."""
        rows = self._backend.family_versions(self.project, self.name)
        return [ArtifactVersion(r, self._backend) for r in sorted(rows, key=lambda r: r["version"])]

    def version(self, ref: str = "latest") -> ArtifactVersion:
        """One version by alias or ``vN`` (``"best"``, ``"v3"``)."""
        info = self._backend.resolve_artifact_ref(self.project, f"{self.name}:{ref}")
        return ArtifactVersion(info, self._backend)

    def delete(self) -> None:
        """Delete the artifact: every version, alias and consumption record."""
        self._backend.delete_family(self.project, self.name)
