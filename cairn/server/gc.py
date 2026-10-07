"""Blob garbage collection: delete stored blobs nothing references any more.

Blobs are content-addressed and shared, so deleting a run (or a report, an
artifact version) never deletes its blobs on the spot. ``collect`` does it
for the whole repo, as the ingest-lease holder (``cairn gc``, and the server
in the background after it deleted runs):

* **Mark**: every hash referenced anywhere — ``sequences.artifact_hash``,
  ``artifact_versions.hash`` (version manifests), ``artifact_entries.hash``
  and the ``source_hash``/``media_hashes`` in their ``meta``,
  ``report_assets.hash``, ``cairn-asset:<hash>`` in report and template
  sources, the ``diff_hash`` of every run's source manifest
  (``sources/<run>/manifest.json``), and every hash named in the part of a
  run log not ingested yet — then, transitively, what those blobs name: a
  figure's ``source_hash``, a table's ``media_hashes``, a gallery's items
  (and their metadata), a version manifest's files (and their ``meta``).
* **Sweep**: delete every stored blob that is not marked AND whose file is
  older than ``GRACE_SECONDS`` (24 h) (``BlobStore.delete_if_older``: safe
  against a concurrent ``put`` of the same bytes). The grace period covers everything in
  flight that names a blob only later: a writer uploads children before the
  container naming them, an HTTP client that found a blob already stored
  (HEAD) names it in a later batch, and ``BlobStore.put`` of bytes already
  stored refreshes the file's mtime (as the HEAD does).
* The ``artifacts`` row of a deleted blob goes with it (the row only
  describes the bytes; a row whose blob is referenced is never deleted).
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Iterable
from typing import Any

from .artifact_refs import GALLERY_MIME, MANIFEST_MIME
from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database
from .wal_ingest import pending_hashes

log = logging.getLogger(__name__)

#: Unreferenced blobs younger than this (file mtime) are kept.
GRACE_SECONDS = 24 * 3600.0

_ASSET_REF = re.compile(r"cairn-asset:([0-9a-f]{64})")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _json(value: Any) -> Any:
    if isinstance(value, (bytes, str)):
        try:
            return json.loads(value)
        except (ValueError, UnicodeDecodeError):
            return None
    return value


def _meta_refs(meta: Any) -> list[str]:
    """The hashes a handler's metadata names: ``source_hash``, ``media_hashes``."""
    meta = _json(meta)
    if not isinstance(meta, dict):
        return []
    refs = []
    if isinstance(meta.get("source_hash"), str):
        refs.append(meta["source_hash"])
    media = meta.get("media_hashes")
    if isinstance(media, list):
        refs += [h for h in media if isinstance(h, str)]
    return refs


def _container_refs(blobs: BlobStore, digest: str, mime: str | None) -> list[str]:
    """What a gallery or a version manifest blob names (with its entries' metadata)."""
    if mime not in (GALLERY_MIME, MANIFEST_MIME):
        return []
    try:
        doc = _json(blobs.get(digest))
    except OSError:
        return []
    if not isinstance(doc, dict):
        return []
    refs: list[str] = []
    key, meta_key = ("items", "metadata") if mime == GALLERY_MIME else ("files", "meta")
    for entry in doc.get(key) or []:
        if not isinstance(entry, dict):
            continue
        if isinstance(entry.get("hash"), str):
            refs.append(entry["hash"])
        refs += _meta_refs(entry.get(meta_key))
    return refs


def root_hashes(db: Database, data_dir: DataDir) -> set[str]:
    """Every hash referenced directly (see the module docstring).

    The logs are read first: a record ingested after that is in the tables
    by the time they are read, and one logged after that was written just
    now, with its blobs (which ``put`` made young)."""
    roots: set[str] = set(pending_hashes(data_dir, db))
    for sql in (
        "SELECT DISTINCT artifact_hash FROM sequences WHERE artifact_hash IS NOT NULL",
        "SELECT hash FROM artifact_versions",
        "SELECT hash FROM artifact_entries WHERE hash IS NOT NULL",
        "SELECT hash FROM report_assets",
    ):
        roots.update(r[0] for r in db.read(sql))
    for (meta,) in db.read("SELECT meta FROM artifact_entries WHERE meta IS NOT NULL"):
        roots.update(_meta_refs(meta))
    for sql in (
        "SELECT payload FROM reports WHERE payload IS NOT NULL",
        "SELECT payload FROM report_templates WHERE payload IS NOT NULL",
    ):
        for (payload,) in db.read(sql):
            roots.update(_ASSET_REF.findall(str(payload)))
    for manifest in data_dir.sources_dir.glob("*/manifest.json"):
        doc = _json(manifest.read_bytes()) if manifest.is_file() else None
        if isinstance(doc, dict) and isinstance(doc.get("diff_hash"), str):
            roots.add(doc["diff_hash"])
    return roots


def mark(db: Database, data_dir: DataDir, blobs: BlobStore) -> set[str]:
    """Every hash referenced, directly or through the blobs that are."""
    return walk(db, blobs, root_hashes(db, data_dir))


def walk(db: Database, blobs: BlobStore, seeds: Iterable[str]) -> set[str]:
    seen: set[str] = set()
    pending = [h for h in seeds if isinstance(h, str)]
    while pending:
        h = pending.pop()
        if h in seen:
            continue
        seen.add(h)
        if not blobs.exists(h):
            continue
        row = db.read_one("SELECT mime_type, metadata FROM artifacts WHERE hash = ?", [h])
        if row is None:
            continue
        pending += _meta_refs(row[1])
        pending += _container_refs(blobs, h, row[0])
    return seen


def collect(
    db: Database, data_dir: DataDir, blobs: BlobStore, *, dry_run: bool = False,
    grace_seconds: float = GRACE_SECONDS, now: float | None = None,
) -> dict[str, Any]:
    """Delete the unreferenced blobs older than ``grace_seconds`` (and their
    ``artifacts`` rows). The caller holds the repo's ingest lease.

    Returns ``{"deleted": n, "freed_bytes": n, "kept": n, "dry_run": bool}``;
    with ``dry_run`` nothing is deleted and the counts are what would be.
    """
    marked = mark(db, data_dir, blobs)
    cutoff = (time.time() if now is None else now) - grace_seconds
    deleted = freed = kept = 0
    for digest in list(blobs.iter_digests()):
        if not _HEX64.match(digest) or digest in marked:
            kept += 1
            continue
        if dry_run:
            try:
                st = blobs.path_for(digest).stat()
            except FileNotFoundError:
                continue
            if st.st_mtime > cutoff:
                kept += 1
            else:
                deleted += 1
                freed += st.st_size
            continue
        size = blobs.delete_if_older(digest, cutoff)
        if size is None:
            kept += 1
            continue
        deleted += 1
        freed += size
        db.write("DELETE FROM artifacts WHERE hash = ?", [digest])
    # Rows describing blobs that are gone and that nothing references.
    orphan_rows = [
        h for (h,) in db.read("SELECT hash FROM artifacts")
        if h not in marked and not blobs.exists(h)
    ]
    if not dry_run:
        for h in orphan_rows:
            db.write("DELETE FROM artifacts WHERE hash = ?", [h])
    result = {
        "deleted": deleted, "freed_bytes": freed, "kept": kept,
        "orphan_rows": len(orphan_rows), "dry_run": dry_run,
    }
    log.info("gc: %s", result)
    return result
