"""Custom viewers on the server: the project's viewer list and dev sources.

Published viewers are artifact families of type ``cairn-viewer``: each
version's metadata holds the normalized manifest (``manifest``) and the
folder's ``content_digest``, so listing them never reads a blob.

Dev sources (``cairn viewer dev``) live in memory, per repo: the CLI declares
a folder's file set, uploads the files the server lacks, and heartbeats; every
change to the complete set bumps the source's ``revision``. A source expires
``DEV_TTL_S`` after its session's last request. They are never persisted and
never visible through share links.
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import artifact_registry_ops as ops
from .storage.db import Database
from .viewer_manifest import (
    MANIFEST_FILE,
    MAX_FOLDER_BYTES,
    NAME_RE,
    VIEWER_TYPE,
    ManifestError,
    content_digest,
    manifest_from_bytes,
    mime_for,
    safe_rel_path,
)

#: A dev source is dropped this long after its session's last request.
DEV_TTL_S = 30.0
#: At most this many live dev sources per repo (memory bound).
MAX_DEV_SOURCES = 32

_MANIFEST_KEYS = (
    "name", "title", "description", "entry", "accepts", "inputs", "webgl",
    "view", "settings", "imports",
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Published viewers
# ---------------------------------------------------------------------------

def _published_entry(version: dict[str, Any]) -> dict[str, Any]:
    meta = version.get("metadata") or {}
    manifest = meta.get("manifest") if isinstance(meta.get("manifest"), dict) else None
    entry: dict[str, Any] = {k: (manifest or {}).get(k) for k in _MANIFEST_KEYS}
    entry["name"] = version["name"]
    entry.update({
        "dev": False,
        "version_id": version["id"],
        "version": version["version"],
        "digest": version["digest"],
        "content_digest": meta.get("content_digest"),
        "updated_at": version["created_at"],
        "error": None if manifest else "version has no viewer manifest",
    })
    return entry


def published_viewers(
    db: Database, project_id: str, *, all_versions: bool = False,
    version_ids: frozenset[str] | None = None,
) -> list[dict[str, Any]]:
    """The project's viewers: each family's ``latest`` (every version, newest
    first, with ``all_versions``). ``version_ids`` keeps only those versions
    (a share link's scope), whatever ``all_versions`` says."""
    out: list[dict[str, Any]] = []
    for fam in sorted(ops.list_families(db, project_id, type_filter=VIEWER_TYPE), key=lambda f: f["name"]):
        if all_versions or version_ids is not None:
            versions = ops.list_versions(db, fam["id"])
        else:
            try:
                versions = [ops.resolve_ref(db, project_id, f"{fam['name']}:latest")]
            except LookupError:
                versions = []
        for v in versions:
            if version_ids is not None and v["id"] not in version_ids:
                continue
            out.append(_published_entry(v))
    return out


def resolve_viewer_version(
    db: Database, project_id: str, name: str, version: Any = None,
) -> str | None:
    """The version id a card's ``viewer``/``viewer_version`` names, or None."""
    if not isinstance(name, str) or not NAME_RE.match(name):
        return None
    if isinstance(version, bool):
        return None
    if isinstance(version, int):
        qualifier = f"v{version}"
    elif isinstance(version, str) and version:
        qualifier = version if version.startswith("v") or not version.isdigit() else f"v{version}"
    elif version is None:
        qualifier = "latest"
    else:
        return None
    try:
        v = ops.resolve_ref(db, project_id, f"{name}:{qualifier}")
    except (LookupError, ValueError):
        return None
    return v["id"] if v.get("type") == VIEWER_TYPE else None


# ---------------------------------------------------------------------------
# Dev sources
# ---------------------------------------------------------------------------

class DevError(Exception):
    """A dev-source request is refused: ``status`` is the HTTP status."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class DevSource:
    project_id: str
    name: str
    session: str
    #: The declared file set: path -> sha256.
    declared: dict[str, str] = field(default_factory=dict)
    #: Bytes held, by sha256.
    content: dict[str, bytes] = field(default_factory=dict)
    #: The last complete set (what is served): path -> sha256.
    served: dict[str, str] = field(default_factory=dict)
    revision: int = 0
    manifest: dict[str, Any] | None = None
    error: str | None = None
    updated_at: str = ""
    last_seen: float = 0.0

    def missing(self) -> list[str]:
        return sorted(p for p, sha in self.declared.items() if sha not in self.content)

    def _settle(self) -> None:
        """Serve the declared set once complete and changed: bump the revision."""
        if self.missing() or self.declared == self.served:
            return
        self.served = dict(self.declared)
        self.content = {sha: self.content[sha] for sha in set(self.served.values())}
        self.revision += 1
        self.updated_at = _iso_now()
        mpath = MANIFEST_FILE
        try:
            if mpath not in self.served:
                raise ManifestError(f"the folder has no {MANIFEST_FILE}")
            manifest = manifest_from_bytes(self.content[self.served[mpath]], self.served)
            if manifest["name"] != self.name:
                raise ManifestError(
                    f"manifest name {manifest['name']!r} differs from the dev source {self.name!r}"
                )
            self.manifest, self.error = manifest, None
        except ManifestError as exc:
            self.error = str(exc)

    def entry(self) -> dict[str, Any]:
        out: dict[str, Any] = {k: (self.manifest or {}).get(k) for k in _MANIFEST_KEYS}
        out["name"] = self.name
        out.update({
            "dev": True,
            "version_id": None,
            "version": None,
            "digest": None,
            "content_digest": content_digest(self.served.items()),
            "revision": self.revision,
            "updated_at": self.updated_at,
            "error": self.error,
        })
        return out

    def files(self) -> list[dict[str, Any]]:
        return [
            {"path": p, "size": len(self.content[sha]), "digest": sha, "mime": mime_for(p)}
            for p, sha in sorted(self.served.items())
        ]

    def read(self, path: str) -> bytes:
        sha = self.served.get(path)
        if sha is None:
            raise DevError(404, f"dev viewer {self.name!r} has no file {path!r}")
        return self.content[sha]


class DevStore:
    """Every live dev source of one repo (thread-safe)."""

    def __init__(self, ttl_s: float = DEV_TTL_S, clock: Any = time.monotonic) -> None:
        self._ttl = ttl_s
        self._clock = clock
        self._lock = threading.Lock()
        self._sources: dict[tuple[str, str], DevSource] = {}

    def _purge(self) -> None:
        now = self._clock()
        for key in [k for k, s in self._sources.items() if now - s.last_seen > self._ttl]:
            del self._sources[key]

    def _owned(self, project_id: str, name: str, session: str) -> DevSource:
        src = self._sources.get((project_id, name))
        if src is None:
            raise DevError(404, f"no dev viewer {name!r} (declare its files first)")
        if src.session != session:
            raise DevError(409, f"dev viewer {name!r} belongs to another session")
        return src

    def declare(self, project_id: str, name: str, session: str, files: dict[str, str]) -> dict[str, Any]:
        """Declare (or heartbeat) the full file set -> ``{missing, revision}``."""
        if not NAME_RE.match(name):
            raise DevError(400, f"invalid viewer name {name!r}")
        if not isinstance(session, str) or not 8 <= len(session) <= 128:
            raise DevError(400, "session must be a string of 8-128 characters")
        clean: dict[str, str] = {}
        for path, sha in files.items():
            try:
                rel = safe_rel_path(path)
            except ManifestError as exc:
                raise DevError(400, str(exc)) from None
            if not isinstance(sha, str) or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
                raise DevError(400, f"files[{path!r}] must be a lowercase sha256 hex digest")
            clean[rel] = sha
        with self._lock:
            self._purge()
            key = (project_id, name)
            src = self._sources.get(key)
            if src is None or src.session != session:
                if src is None and len(self._sources) >= MAX_DEV_SOURCES:
                    raise DevError(429, f"too many dev viewers (max {MAX_DEV_SOURCES})")
                # A new session takes the name over; content is reused.
                old = src
                src = DevSource(project_id, name, session)
                if old is not None:
                    src.content, src.revision = old.content, old.revision
                self._sources[key] = src
            src.declared = clean
            src.last_seen = self._clock()
            src._settle()
            return {"missing": src.missing(), "revision": src.revision}

    def put(self, project_id: str, name: str, session: str, path: str, data: bytes) -> dict[str, Any]:
        """Upload one declared file -> ``{missing, revision}``."""
        try:
            rel = safe_rel_path(path)
        except ManifestError as exc:
            raise DevError(400, str(exc)) from None
        sha = hashlib.sha256(data).hexdigest()
        with self._lock:
            self._purge()
            src = self._owned(project_id, name, session)
            want = src.declared.get(rel)
            if want is None:
                raise DevError(400, f"{rel!r} was not declared")
            if want != sha:
                raise DevError(400, f"{rel!r}: content does not match its declared sha256")
            held = sum(len(b) for b in src.content.values())
            if sha not in src.content and held + len(data) > 2 * MAX_FOLDER_BYTES:
                raise DevError(413, "dev viewer folder is too large")
            src.content[sha] = data
            src.last_seen = self._clock()
            src._settle()
            return {"missing": src.missing(), "revision": src.revision}

    def delete(self, project_id: str, name: str, session: str) -> None:
        with self._lock:
            src = self._sources.get((project_id, name))
            if src is not None and src.session == session:
                del self._sources[(project_id, name)]

    def get(self, project_id: str, name: str) -> DevSource:
        with self._lock:
            self._purge()
            src = self._sources.get((project_id, name))
            if src is None or src.revision == 0:
                raise DevError(404, f"no dev viewer {name!r}")
            return src

    def entries(self, project_id: str) -> list[dict[str, Any]]:
        with self._lock:
            self._purge()
            return [
                s.entry() for (p, _n), s in sorted(self._sources.items())
                if p == project_id and s.revision > 0
            ]


_STORES: dict[str, DevStore] = {}
_STORES_LOCK = threading.Lock()


def dev_store_for(root: Path | str) -> DevStore:
    """The dev store of the repo at ``root``: one per process and repo, so
    the ingest and UI apps of ``cairn server --ui`` share it."""
    key = str(Path(root).resolve())
    with _STORES_LOCK:
        store = _STORES.get(key)
        if store is None:
            store = _STORES[key] = DevStore()
        return store
