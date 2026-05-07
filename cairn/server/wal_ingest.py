"""WAL ingestion — drains per-run WAL files into the central SQLite DB.

Called by:
- The server's background ingestion thread (every 2s)
- ``cairn.Reader`` before queries (for no-server use)

SDK runs NEVER call this. They only write WAL files + blobs.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database
from . import ingest_ops

log = logging.getLogger(__name__)


def _safe_json(line: str) -> dict[str, Any] | None:
    """Parse a JSONL line, returning None on error."""
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        log.warning("skipping malformed WAL line: %s", line[:120])
        return None


def _ensure_run_exists(db: Database, p: dict[str, Any]) -> None:
    """Create the run + project rows if they don't exist yet."""
    run_id = p["run_id"]
    # Check if already ingested.
    rows = db.read_columns("SELECT id FROM runs WHERE id = ?", [run_id])
    if rows:
        return
    ingest_ops.create_run(
        db,
        project=p["project"],
        run_id=run_id,
        name=p.get("name"),
        tags=p.get("tags"),
        notes=p.get("notes"),
        env=p.get("env"),
        git=p.get("git"),
        cli_args=p.get("cli_args"),
        hostname=p.get("hostname"),
        user=p.get("user"),
    )


def _ensure_artifact_row(db: Database, p: dict[str, Any]) -> None:
    """Insert artifact metadata row if not present."""
    digest = p["hash"]
    rows = db.read_columns("SELECT hash FROM artifacts WHERE hash = ?", [digest])
    if rows:
        return
    from .ingest_ops import utc_now
    db.write(
        """
        INSERT INTO artifacts (hash, mime_type, size_bytes, metadata, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (hash) DO NOTHING
        """,
        [digest, p["mime_type"], p["size_bytes"], json.dumps(p.get("metadata", {})), utc_now()],
    )


def ingest_wal(db: Database, data_dir: DataDir, blobs: BlobStore, wal_path: Path) -> int:
    """Drain a single WAL file into the central DB. Returns number of ops processed."""
    count = 0
    run_id: str | None = None

    with open(wal_path, encoding="utf-8") as f:
        for line in f:
            record = _safe_json(line)
            if not record:
                continue
            payload = record.get("payload", {})
            op = record.get("op", "")
            count += 1

            if op == "create_run":
                _ensure_run_exists(db, payload)
                run_id = payload["run_id"]

            elif op == "batch":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.insert_batch(db, rid, payload["points"])
                    except ingest_ops.RunNotFound:
                        log.warning("WAL batch for unknown run %s — skipping", rid)

            elif op == "params":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.set_params(db, rid, payload["params"])
                    except ingest_ops.RunNotFound:
                        log.warning("WAL params for unknown run %s — skipping", rid)

            elif op == "logs":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.insert_logs(db, data_dir, rid, payload["lines"])
                    except ingest_ops.RunNotFound:
                        log.warning("WAL logs for unknown run %s — skipping", rid)

            elif op == "finish":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.finish_run(
                            db, rid,
                            status=payload.get("status", "completed"),
                            exit_code=payload.get("exit_code"),
                        )
                    except ingest_ops.RunNotFound:
                        log.warning("WAL finish for unknown run %s — skipping", rid)

            elif op == "set_tags":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.set_tags(db, rid, payload["tags"])
                    except ingest_ops.RunNotFound:
                        pass

            elif op == "set_notes":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.set_notes(db, rid, payload["notes"])
                    except ingest_ops.RunNotFound:
                        pass

            elif op == "artifact_meta":
                _ensure_artifact_row(db, payload)

            elif op == "attach_artifact":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.attach_artifact(
                            db, blobs, rid,
                            name=payload["name"],
                            digest=payload["hash"],
                            step=payload.get("step"),
                        )
                    except (ingest_ops.RunNotFound, ValueError):
                        pass

            elif op == "source":
                rid = payload.get("run_id", run_id)
                if rid:
                    # Source archive is already in the blob store.
                    # Write manifest to run source dir.
                    src_dir = data_dir.run_source_dir(rid)
                    manifest = payload.get("manifest", {})
                    blob_hash = payload.get("hash")
                    if blob_hash and blobs.exists(blob_hash):
                        archive_data = blobs.get(blob_hash)[0]
                        (src_dir / "tree.tar.zst").write_bytes(archive_data)
                        (src_dir / "manifest.json").write_text(json.dumps(manifest))

            elif op == "heartbeat":
                rid = payload.get("run_id", run_id)
                if rid:
                    try:
                        ingest_ops.heartbeat(db, rid)
                    except ingest_ops.RunNotFound:
                        pass

            else:
                log.debug("unknown WAL op %r — skipping", op)

    return count


# Tracks how far we've read into each active WAL (by file path → byte offset).
_wal_offsets: dict[str, int] = {}


def _ingest_wal_incremental(
    db: Database, data_dir: DataDir, blobs: BlobStore, wal_path: Path,
) -> int:
    """Read new lines from an active (locked) WAL without waiting for it to close.

    Since the WAL is append-only JSONL, we can safely read up to the current
    EOF, ingest those lines, and remember the offset for next time.
    """
    key = str(wal_path)
    offset = _wal_offsets.get(key, 0)
    count = 0
    run_id: str | None = None

    try:
        with open(wal_path, encoding="utf-8") as f:
            f.seek(offset)
            for line in f:
                record = _safe_json(line)
                if not record:
                    continue
                payload = record.get("payload", {})
                op = record.get("op", "")
                count += 1

                if op == "create_run":
                    _ensure_run_exists(db, payload)
                    run_id = payload["run_id"]
                elif op == "batch":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.insert_batch(db, rid, payload["points"])
                        except ingest_ops.RunNotFound:
                            pass
                elif op == "params":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.set_params(db, rid, payload["params"])
                        except ingest_ops.RunNotFound:
                            pass
                elif op == "logs":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.insert_logs(db, data_dir, rid, payload["lines"])
                        except ingest_ops.RunNotFound:
                            pass
                elif op == "finish":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.finish_run(db, rid, status=payload.get("status", "completed"), exit_code=payload.get("exit_code"))
                        except ingest_ops.RunNotFound:
                            pass
                elif op == "set_tags":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.set_tags(db, rid, payload["tags"])
                        except ingest_ops.RunNotFound:
                            pass
                elif op == "set_notes":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.set_notes(db, rid, payload["notes"])
                        except ingest_ops.RunNotFound:
                            pass
                elif op == "artifact_meta":
                    _ensure_artifact_row(db, payload)
                elif op == "attach_artifact":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.attach_artifact(db, blobs, rid, name=payload["name"], digest=payload["hash"], step=payload.get("step"))
                        except (ingest_ops.RunNotFound, ValueError):
                            pass
                elif op == "source":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        src_dir = data_dir.run_source_dir(rid)
                        manifest = payload.get("manifest", {})
                        blob_hash = payload.get("hash")
                        if blob_hash and blobs.exists(blob_hash):
                            archive_data = blobs.get(blob_hash)[0]
                            (src_dir / "tree.tar.zst").write_bytes(archive_data)
                            (src_dir / "manifest.json").write_text(json.dumps(manifest))
                elif op == "heartbeat":
                    rid = payload.get("run_id", run_id)
                    if rid:
                        try:
                            ingest_ops.heartbeat(db, rid)
                        except ingest_ops.RunNotFound:
                            pass

            # Remember where we stopped.
            _wal_offsets[key] = f.tell()
    except OSError:
        pass

    return count


def ingest_all(data_dir: DataDir, db: Database, blobs: BlobStore) -> int:
    """Scan the WAL directory and ingest all WAL files — both active and completed.

    Active WALs (with lock file) are read incrementally from the last offset.
    Completed WALs (no lock) are fully ingested and renamed to .done.

    Returns total number of ops ingested.
    """
    wal_dir = data_dir.root / "wals"
    if not wal_dir.exists():
        return 0

    total = 0
    for wal_path in sorted(wal_dir.glob("*.wal.jsonl")):
        lock_path = wal_path.with_suffix("").with_suffix(".lock")
        is_active = lock_path.exists()

        try:
            if is_active:
                # Incremental read — WAL is still being written.
                count = _ingest_wal_incremental(db, data_dir, blobs, wal_path)
            else:
                # Full ingest — run has finished, WAL is complete.
                count = ingest_wal(db, data_dir, blobs, wal_path)
                # Clean up offset tracking.
                _wal_offsets.pop(str(wal_path), None)
                # Rename to .done.
                done_path = wal_path.with_suffix(".done")
                wal_path.rename(done_path)
                log.debug("ingested WAL %s (%d ops)", wal_path.name, count)

            total += count
        except Exception:  # noqa: BLE001
            log.exception("failed to ingest WAL %s", wal_path.name)

    return total
