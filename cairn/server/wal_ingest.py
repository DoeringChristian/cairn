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
    """Create the run + project rows if they don't exist yet.

    The payload's ``created_at`` is the client's clock at creation, so a WAL
    drained long after the run started still dates the run correctly.
    """
    run_id = p["run_id"]
    # Check if already ingested.
    rows = db.read_columns("SELECT id FROM runs WHERE id = ?", [run_id])
    if rows:
        return
    ingest_ops.create_run(
        db,
        project=p["project"],
        **{k: p.get(k) for k in ingest_ops.CREATE_RUN_FIELDS},
    )


def _ensure_artifact_row(db: Database, p: dict[str, Any]) -> None:
    """Insert artifact metadata row if not present."""
    digest = p["hash"]
    rows = db.read_columns("SELECT hash, object_type FROM artifacts WHERE hash = ?", [digest])
    from .ingest_ops import utc_now
    if rows:
        # Backfill object_type if missing.
        if not rows[0].get("object_type") and p.get("object_type"):
            db.write(
                "UPDATE artifacts SET object_type = ? WHERE hash = ?",
                [p["object_type"], digest],
            )
        return
    db.write(
        """
        INSERT INTO artifacts (hash, mime_type, size_bytes, metadata, object_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (hash) DO NOTHING
        """,
        [digest, p["mime_type"], p["size_bytes"], json.dumps(p.get("metadata", {})), p.get("object_type"), utc_now()],
    )


def _apply_op(
    db: Database,
    data_dir: DataDir,
    blobs: BlobStore,
    op: str,
    payload: dict[str, Any],
    run_id: str | None,
) -> str | None:
    """Apply one WAL record to the DB. Returns the WAL's run id (updated by
    ``create_run``) so later records without a ``run_id`` resolve to it.

    The single dispatcher for both the full and the incremental drain: a new
    WAL op is one branch here. Every branch must be idempotent, because a WAL
    that was drained incrementally while its run was live is drained again in
    full once the run's lock goes away.
    """
    if op == "create_run":
        _ensure_run_exists(db, payload)
        return payload["run_id"]

    if op == "fork_run":
        # A forked run's WAL opens with this instead of ``create_run``.
        try:
            ingest_ops.fork_run(
                db, parent_id=payload["parent_id"], step=payload["step"],
                run_id=payload["new_id"],
                **{k: payload.get(k) for k in ingest_ops.CREATE_RUN_FIELDS if k != "run_id"},
            )
        except ingest_ops.RunNotFound:
            log.warning("WAL fork of unknown run %s — skipping", payload["parent_id"])
        return payload["new_id"]

    if op == "artifact_meta":
        _ensure_artifact_row(db, payload)
        return run_id

    if op == "create_artifact_version":
        from . import artifact_registry_ops

        artifact_registry_ops.create_artifact_version(
            db,
            project_id=payload["project_id"],
            family_name=payload["family_name"],
            family_type=payload.get("family_type", "artifact"),
            digest=payload["hash"],
            size_bytes=payload["size_bytes"],
            metadata=payload.get("metadata"),
            created_by_run=payload.get("created_by_run"),
            aliases=payload.get("aliases"),
            version_id=payload.get("version_id"),
        )
        return run_id

    rid = payload.get("run_id", run_id)
    if not rid:
        log.debug("WAL op %r without a run id — skipping", op)
        return run_id

    try:
        if op == "batch":
            ingest_ops.insert_batch(db, rid, payload["points"])
        elif op == "params":
            ingest_ops.set_params(db, rid, payload["params"])
        elif op == "summary":
            ingest_ops.set_summary(db, rid, payload["summary"])
        elif op == "logs":
            ingest_ops.insert_logs(db, data_dir, rid, payload["lines"])
        elif op == "finish":
            ingest_ops.finish_run(
                db, rid,
                status=payload.get("status", "completed"),
                exit_code=payload.get("exit_code"),
                ended_at=payload.get("ended_at"),
            )
        elif op == "set_tags":
            ingest_ops.set_tags(db, rid, payload["tags"])
        elif op == "set_notes":
            ingest_ops.set_notes(db, rid, payload["notes"])
        elif op == "attach_artifact":
            ingest_ops.attach_artifact(
                db, blobs, rid,
                name=payload["name"],
                digest=payload["hash"],
                step=payload.get("step"),
            )
        elif op == "record_artifact_input":
            from . import artifact_registry_ops

            artifact_registry_ops.record_input(
                db, run_id=rid,
                artifact_version_id=payload["artifact_version_id"],
                role=payload.get("role", "input"),
            )
        elif op == "source":
            # The archive is already in the blob store; copy it and the
            # manifest into the run's source dir.
            src_dir = data_dir.run_source_dir(rid)
            manifest = payload.get("manifest", {})
            blob_hash = payload.get("hash")
            if blob_hash and blobs.exists(blob_hash):
                archive_data = blobs.get(blob_hash)[0]
                (src_dir / "tree.tar.zst").write_bytes(archive_data)
                (src_dir / "manifest.json").write_text(json.dumps(manifest))
        elif op == "heartbeat":
            ingest_ops.heartbeat(db, rid)
        elif op == "define_metric":
            ingest_ops.define_metric(
                db, rid, payload["name"],
                step_metric=payload.get("step_metric"), summary=payload.get("summary"),
            )
        elif op == "resume_run":
            ingest_ops.resume_run(db, rid)
        elif op == "rewind_run":
            # Not idempotent on its own, but a full re-drain replays it between
            # the same batches as the first drain, so the rows converge (the
            # epoch just bumps once more).
            ingest_ops.rewind_run(db, rid, payload["step"])
        else:
            log.debug("unknown WAL op %r — skipping", op)
    except ingest_ops.RunNotFound:
        log.warning("WAL %s for unknown run %s — skipping", op, rid)
    except ValueError as exc:
        # attach_artifact with a blob that never arrived.
        log.warning("WAL %s for run %s failed: %s", op, rid, exc)
    return run_id


def _drain_lines(
    db: Database, data_dir: DataDir, blobs: BlobStore, lines: Any,
) -> int:
    count = 0
    run_id: str | None = None
    for line in lines:
        record = _safe_json(line)
        if not record:
            continue
        count += 1
        run_id = _apply_op(
            db, data_dir, blobs, record.get("op", ""), record.get("payload", {}), run_id,
        )
    return count


def ingest_wal(db: Database, data_dir: DataDir, blobs: BlobStore, wal_path: Path) -> int:
    """Drain a single WAL file into the central DB. Returns number of ops processed."""
    with open(wal_path, encoding="utf-8") as f:
        return _drain_lines(db, data_dir, blobs, f)


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
    try:
        with open(wal_path, "rb") as f:
            f.seek(_wal_offsets.get(key, 0))
            chunk = f.read()
    except OSError:
        return 0
    # Only complete lines: the writer may be mid-append, and a torn last line
    # must be read again next cycle rather than skipped.
    complete = chunk[: chunk.rfind(b"\n") + 1]
    _wal_offsets[key] = _wal_offsets.get(key, 0) + len(complete)
    lines = complete.decode("utf-8").splitlines()
    return _drain_lines(db, data_dir, blobs, lines)


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
