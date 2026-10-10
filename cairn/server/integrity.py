"""``cairn backup`` and ``cairn fsck``: the server side.

* ``backup`` — an online, consistent copy of the database (SQLite's backup
  API, safe while the server writes) in ``<repo>/backups/``. Blobs are
  immutable, content-addressed files: back the ``artifacts/`` tree up with
  any file copy (``rsync``); a database backup names only blobs that existed
  when it was taken.
* ``fsck`` — the database against the blob store:

  - ``integrity``: SQLite's ``PRAGMA integrity_check``;
  - ``missing_blobs``: hashes the database references (points, artifact
    rows, version manifests and their files, report assets) whose blob is
    not stored;
  - ``corrupt_blobs``: stored blobs whose bytes no longer hash to their
    name (a scrub of every blob); ``--repair`` moves each to
    ``<repo>/quarantine/<hash>`` (kept, never deleted), so a client that
    still has the bytes can upload them again;
  - ``orphan_blobs``: stored blobs nothing references (``cairn gc`` deletes
    them after a day);
  - ``orphan_rows``: ``artifacts`` rows whose blob is gone and that nothing
    references; ``--repair`` deletes those rows (metadata of nothing);
  - ``stray_progress``: ``ingest_progress`` rows of runs that no longer
    exist (deleted runs; harmless, reported);
  - ``legacy_logs``: 0.5 run logs still waiting to be imported.

  The run directories on client machines are checked by the client side of
  ``cairn fsck`` against ``ingest_progress`` (``GET .../logs/{log}``).
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import gc
from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database, backup_to

log = logging.getLogger(__name__)

BACKUP_PREFIX = "cairn-"


def backups_dir(dd: DataDir) -> Path:
    return dd.root / "backups"


def backup(db: Database, dd: DataDir) -> dict[str, Any]:
    """Write ``<repo>/backups/cairn-<UTC timestamp>.db``; return its
    ``{"name", "path", "size_bytes"}``."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    dest = backups_dir(dd) / f"{BACKUP_PREFIX}{stamp}.db"
    with db._write_lock() as con:  # a consistent snapshot; writers wait briefly
        backup_to(con, dest)
    return {"name": dest.name, "path": str(dest), "size_bytes": dest.stat().st_size}


def backup_path(dd: DataDir, name: str) -> Path | None:
    """A backup's file by its name (no path components), or None."""
    if "/" in name or "\\" in name or not name.endswith(".db") or name.startswith("."):
        return None
    path = backups_dir(dd) / name
    return path if path.is_file() else None


def _referenced(db: Database, dd: DataDir, blobs: BlobStore) -> set[str]:
    return gc.mark(db, dd, blobs)


def fsck(db: Database, dd: DataDir, blobs: BlobStore, *, repair: bool = False) -> dict[str, Any]:
    """Check the repo (see the module docstring); with ``repair``, apply the
    safe repairs. Returns the report; ``ok`` is True when nothing is wrong."""
    with db._write_lock() as con:
        integrity = [r[0] for r in con.execute("PRAGMA integrity_check").fetchall()]
    referenced = _referenced(db, dd, blobs)
    stored = set(blobs.iter_digests())
    # Directly referenced hashes that must exist (a missing child of a
    # missing container is reported through its container).
    direct: set[str] = set()
    for sql in (
        "SELECT DISTINCT artifact_hash FROM sequences WHERE artifact_hash IS NOT NULL",
        "SELECT hash FROM artifact_versions",
        "SELECT hash FROM artifact_entries WHERE hash IS NOT NULL",
        "SELECT hash FROM report_assets",
        "SELECT hash FROM artifacts",
    ):
        direct.update(r[0] for r in db.read(sql))
    missing = sorted(h for h in (direct | referenced) if gc._HEX64.match(h) and h not in stored)
    corrupt = []
    for digest in sorted(stored):
        try:
            ok = blobs.verify(digest)
        except OSError:
            ok = False
        if not ok:
            corrupt.append(digest)
    orphans = sorted(stored - referenced)
    orphan_rows = [
        h for (h,) in db.read("SELECT hash FROM artifacts") if h not in referenced and h not in stored
    ]
    stray = db.read_columns(
        "SELECT run_id, log, applied_seq FROM ingest_progress "
        "WHERE run_id NOT IN (SELECT id FROM runs)"
    )
    wal_dir = dd.root / "wals"
    legacy = sorted(p.name for p in wal_dir.glob("*.wal.jsonl")) if wal_dir.is_dir() else []
    repaired: dict[str, Any] = {}
    if repair:
        quarantine = dd.root / "quarantine"
        moved = []
        for digest in corrupt:
            quarantine.mkdir(parents=True, exist_ok=True)
            try:
                shutil.move(str(blobs.path_for(digest)), str(quarantine / digest))
                moved.append(digest)
            except OSError as exc:
                log.error("fsck: could not quarantine %s: %s", digest, exc)
            blobs.delete(digest)  # the (now empty) directory
        repaired["quarantined_blobs"] = moved
        for h in orphan_rows:
            db.write("DELETE FROM artifacts WHERE hash = ?", [h])
        repaired["deleted_orphan_rows"] = len(orphan_rows)
    problems = (integrity != ["ok"]) or bool(missing) or bool(corrupt)
    return {
        "ok": not problems,
        "integrity": integrity[:20],
        "blobs_stored": len(stored),
        "missing_blobs": missing,
        "corrupt_blobs": corrupt,
        "orphan_blobs": len(orphans),
        "orphan_rows": len(orphan_rows),
        "stray_progress": stray,
        "legacy_logs": legacy,
        "repaired": repaired if repair else None,
    }


def repo_stats(db: Database, dd: DataDir) -> dict[str, Any]:
    """What a repo holds (``cairn ping`` on a local repo)."""
    from .. import __version__

    def count(sql: str) -> int:
        return int((db.read_one(sql) or (0,))[0])

    (schema,) = db.read_one("SELECT MAX(version) FROM schema_version") or (None,)
    size = dd.db_path.stat().st_size if dd.db_path.exists() else 0
    for f in dd.artifacts_dir.rglob("*"):
        if f.is_file():
            size += f.stat().st_size
    wal_dir = dd.root / "wals"
    try:
        layout = (dd.root / "version").read_text().strip()
    except OSError:
        layout = None
    return {
        "status": "ok",
        "repo": str(dd.root),
        "version": __version__,
        "layout_version": layout,
        "schema_version": schema,
        "projects": count("SELECT COUNT(*) FROM projects"),
        "runs": count("SELECT COUNT(*) FROM runs"),
        "running_runs": count("SELECT COUNT(*) FROM runs WHERE status = 'running'"),
        "crashed_runs": count("SELECT COUNT(*) FROM runs WHERE status = 'crashed'"),
        "archived_runs": count("SELECT COUNT(*) FROM runs WHERE archived_at IS NOT NULL"),
        "series": count("SELECT COUNT(*) FROM (SELECT 1 FROM sequences GROUP BY run_id, name)"),
        "points": count("SELECT COUNT(*) FROM sequences"),
        "artifacts": count("SELECT COUNT(*) FROM artifacts"),
        "artifact_versions": count("SELECT COUNT(*) FROM artifact_versions"),
        "reports": count("SELECT COUNT(*) FROM reports"),
        "size_bytes": size,
        "pending_legacy_logs": len(list(wal_dir.glob("*.wal.jsonl"))) if wal_dir.is_dir() else 0,
        "pid": os.getpid(),
    }
