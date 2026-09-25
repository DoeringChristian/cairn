"""Which artifact blobs a set of runs can reach.

An artifact can name others: a figure its source, a gallery its images, a
table its media cells, a multi-file manifest its files. Two consumers walk
those references: the run archive (it exports every blob its runs reach) and
share links (a share may fetch only the blobs its in-scope runs reach).
"""

from __future__ import annotations

import json
from typing import Any, Iterable

from .storage.blobs import BlobStore
from .storage.db import Database

#: An image gallery's manifest blob — it names its images by hash. The same
#: wire constant as ``cairn.sdk.handlers.image.GALLERY_MIME`` (the server may
#: not import the SDK; a unit test pins the two together).
GALLERY_MIME = "application/vnd.cairn.image-gallery+json"

#: A multi-file artifact's manifest — it names its files by hash
#: (``cairn.sdk.artifact_dir.MANIFEST_MIME``; pinned together by a unit test).
MANIFEST_MIME = "application/vnd.cairn.artifact-manifest+json"


def referenced_hashes(blobs: BlobStore, h: str, row: dict[str, Any] | None) -> list[str]:
    """Hashes of other artifacts this one names: a figure's ``source_hash``, a
    gallery's images, a table's media cells (``media_hashes``), a manifest's files."""
    if row is None:
        return []
    meta = row.get("metadata")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = None
    refs = [meta["source_hash"]] if isinstance(meta, dict) and meta.get("source_hash") else []
    if isinstance(meta, dict):
        refs += list(meta.get("media_hashes") or [])
    if row.get("mime_type") == GALLERY_MIME:
        data, _ = blobs.get(h)
        refs += [item["hash"] for item in json.loads(data)["images"]]
    if row.get("mime_type") == MANIFEST_MIME:
        data, _ = blobs.get(h)
        refs += [f["hash"] for f in json.loads(data)["files"] if f.get("hash")]
    return refs


def walk_hashes(db: Database, blobs: BlobStore, seeds: Iterable[str]) -> set[str]:
    """``seeds`` plus every hash they reach, transitively."""
    seen: set[str] = set()
    pending = list(seeds)
    while pending:
        h = pending.pop()
        if h in seen:
            continue
        seen.add(h)
        if not blobs.exists(h):
            continue
        rows = db.read_columns("SELECT mime_type, metadata FROM artifacts WHERE hash = ?", [h])
        pending.extend(referenced_hashes(blobs, h, rows[0] if rows else None))
    return seen


def run_seed_hashes(db: Database, run_ids: Iterable[str]) -> set[str]:
    """The blobs runs name directly: their sequence points, their named
    artifacts, and the registry versions they produced."""
    ids = list(run_ids)
    if not ids:
        return set()
    holes = ",".join("?" * len(ids))
    out: set[str] = set()
    for (h,) in db.read(
        f"SELECT DISTINCT artifact_hash FROM sequences "
        f"WHERE run_id IN ({holes}) AND artifact_hash IS NOT NULL",
        ids,
    ):
        out.add(h)
    for (h,) in db.read(f"SELECT DISTINCT hash FROM run_artifacts WHERE run_id IN ({holes})", ids):
        out.add(h)
    for (h,) in db.read(
        f"SELECT DISTINCT hash FROM artifact_versions WHERE created_by_run IN ({holes})", ids,
    ):
        out.add(h)
    return out


def reachable_hashes(db: Database, blobs: BlobStore, run_ids: Iterable[str]) -> set[str]:
    """Every artifact hash reachable from ``run_ids``."""
    return walk_hashes(db, blobs, run_seed_hashes(db, run_ids))
