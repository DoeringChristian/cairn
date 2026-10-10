"""Applying run-log records to the database: the server's ingestion.

Every write of a ``cairn.Run`` is a record in its run directory's log
(``{"seq", "op", "t", "payload": {...}}``; see the 0.6 architecture spec).
The uploader posts them to ``POST /api/ingest/runs/{run_id}/logs/{log}``
and the server applies them here, synchronously, before it answers.

Exactly once. ``ingest_progress(run_id, log, applied_seq)`` holds the
highest sequence number applied per log. A batch is applied in ONE write
transaction that first reads ``applied_seq``, skips every record at or below
it, applies the rest in order and finally stores the new ``applied_seq``: a
crash (or an error) anywhere before the commit leaves neither the ops nor
the new mark, so a retried batch is applied once, and a replayed one (the
client did not see the answer) is ignored. A batch starting beyond
``applied_seq + 1`` is a gap (``IngestGap``): nothing is applied and the
client is told where to resume.

Each record is applied in its own savepoint: an op that fails (a config
write the document rejects, a record naming an unknown run) is rolled back
and skipped, logged, instead of blocking its log forever; database errors
(locked, disk full) abort the whole batch.

Several processes, one run. Each process of a run uploads its own log: the
primary ``main``, an attached process ``procs/<label>`` as log ``<label>``.
A log whose first record is ``join`` is a worker's: it never changes the
run's status (its lifecycle records are skipped) and is merged into the run
once the run exists (until then the server answers ``IngestWait``, a 503).

The op vocabulary is that of the 0.5 run logs (``legacy_wal_import.py``
imports those with this same dispatcher).
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timezone
from typing import Any

from . import ingest_ops
from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database

log = logging.getLogger(__name__)

#: Records a worker's log may not apply: the run's lifecycle and liveness
#: are its primary's.
_PRIMARY_ONLY = frozenset({
    "create_run", "fork_run", "resume_run", "rewind_run", "finish", "heartbeat",
})



def _ensure_run_exists(db: Database, p: dict[str, Any]) -> None:
    """Create the run + project rows if they don't exist yet.

    The payload's ``created_at`` is the client's clock at creation, so a log
    ingested long after the run started still dates the run correctly.
    """
    run_id = p["run_id"]
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
    *,
    worker: bool = False,
) -> str | None:
    """Apply one log record to the DB. Returns the log's run id (updated by
    ``create_run``) so later records without a ``run_id`` resolve to it.
    ``worker``: the record is from a worker's log (see the module docstring).

    The single dispatcher of ingestion: a new log op is one branch here. It
    runs inside the batch's transaction (see the module docstring), so a
    branch is applied exactly once.
    """
    if op in ("join", "detach"):
        # A worker's log opens and ends with these; they change nothing.
        return run_id
    if worker and op in _PRIMARY_ONLY:
        log.warning("worker log record %r for run %s — skipping", op, run_id)
        return run_id

    if op == "create_run":
        _ensure_run_exists(db, payload)
        return payload["run_id"]

    if op == "fork_run":
        # A forked run's log opens with this instead of ``create_run``.
        try:
            ingest_ops.fork_run(
                db, parent_id=payload["parent_id"], step=payload["step"],
                run_id=payload["new_id"],
                **{k: payload.get(k) for k in ingest_ops.CREATE_RUN_FIELDS if k != "run_id"},
            )
        except ingest_ops.RunNotFound:
            log.warning("log fork of unknown run %s — skipping", payload["parent_id"])
        return payload["new_id"]

    if op == "artifact_meta":
        _ensure_artifact_row(db, payload)
        return run_id

    if op == "create_artifact_version":
        from . import artifact_registry_ops

        try:
            artifact_registry_ops.create_version(
                db, blobs,
                project_id=payload["project_id"],
                name=payload["name"],
                type=payload.get("type", "artifact"),
                digest=payload["digest"],
                description=payload.get("description"),
                metadata=payload.get("metadata"),
                step=payload.get("step"),
                created_by_run=payload.get("created_by_run"),
                aliases=payload.get("aliases"),
                tags=payload.get("tags"),
                version_id=payload.get("version_id"),
            )
        except (LookupError, ValueError) as exc:
            log.warning("log artifact version %s failed: %s", payload.get("name"), exc)
        return run_id

    rid = payload.get("run_id", run_id)
    if not rid:
        log.debug("log op %r without a run id — skipping", op)
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
        elif op == "rename_run":
            ingest_ops.rename_run(db, rid, payload["name"])
        elif op == "delete_keys":
            ingest_ops.delete_keys(db, rid, payload["table"], payload["keys"])
        elif op == "record_artifact_input":
            from . import artifact_registry_ops

            artifact_registry_ops.record_input(
                db, run_id=rid,
                artifact_version_id=payload["artifact_version_id"],
                role=payload.get("role", "input"),
            )
        elif op == "record_run_use":
            from . import artifact_registry_ops

            artifact_registry_ops.record_run_use(
                db, run_id=rid, used_run_id=payload["used_run_id"], role=payload.get("role"),
            )
        elif op == "source":
            # The archive is already in the blob store; copy it and the
            # manifest into the run's source dir.
            src_dir = data_dir.run_source_dir(rid)
            manifest = payload.get("manifest", {})
            blob_hash = payload.get("hash")
            if blob_hash and blobs.exists(blob_hash):
                archive_data = blobs.get(blob_hash)
                (src_dir / "tree.tar.zst").write_bytes(archive_data)
                (src_dir / "manifest.json").write_text(json.dumps(manifest))
        elif op == "heartbeat":
            ingest_ops.heartbeat(db, rid)
        elif op == "alert":
            ingest_ops.insert_alert(
                db, rid, payload["title"], payload.get("text", ""),
                payload.get("level", "info"),
                alert_id=payload["alert_id"], created_at=payload.get("created_at"),
            )
        elif op == "set_metric_rule":
            ingest_ops.set_metric_rule(
                db, rid, payload["name"],
                x=payload.get("x"), summary=payload.get("summary"),
            )
        elif op == "total_steps":
            ingest_ops.set_total_steps(db, rid, payload.get("total_steps"))
        elif op == "progress":
            ingest_ops.set_progress(
                db, rid, payload["value"], payload.get("total"), payload.get("wall_time"),
            )
        elif op == "resume_run":
            ingest_ops.resume_run(db, rid)
        elif op == "rewind_run":
            ingest_ops.rewind_run(db, rid, payload["step"])
        else:
            log.debug("unknown log op %r — skipping", op)
    except ingest_ops.RunNotFound:
        log.warning("log %s for unknown run %s — skipping", op, rid)
    except (TypeError, ValueError) as exc:
        # A config write the document rejects (a flat-key collision).
        log.warning("log %s for run %s failed: %s", op, rid, exc)
    return run_id


def _apply_record(
    db: Database, data_dir: DataDir, blobs: BlobStore, record: dict[str, Any],
    run_id: str | None, *, worker: bool = False,
) -> str | None:
    """One record in its own savepoint: an op that fails is rolled back and
    skipped (logged) instead of blocking its log forever. Database errors
    (a locked database) abort the batch, which is retried from its offset."""
    op = record.get("op", "")
    payload = record_payload(record)
    try:
        with db.transaction():
            return _apply_op(db, data_dir, blobs, op, payload, run_id, worker=worker)
    except sqlite3.OperationalError:
        raise
    except Exception:  # noqa: BLE001
        log.exception("log op %r failed; skipped", op)
        return run_id




# ---------------------------------------------------------------------------
# The upload protocol (POST /api/ingest/runs/{run_id}/logs/{log})
# ---------------------------------------------------------------------------

#: The frame fields of a record; every other field of a record without a
#: ``payload`` object is its op's payload.
_FRAME_KEYS = frozenset({"seq", "op", "t"})

#: A log name: ``main`` or an attached process's label.
LOG_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class IngestError(Exception):
    """A batch that cannot be applied (now); carries the log's ``applied_seq``."""

    def __init__(self, message: str, applied_seq: int) -> None:
        super().__init__(message)
        self.applied_seq = applied_seq


class IngestGap(IngestError):
    """The batch starts beyond ``applied_seq + 1``: records are missing."""


class IngestWait(IngestError):
    """The log depends on something not ingested yet (its run, for a worker's
    log or a resumed run; the parent, for a fork): retry later."""


class MissingBlobs(IngestError):
    """Records name blobs the server does not have: upload them first."""

    def __init__(self, message: str, applied_seq: int, hashes: list[str]) -> None:
        super().__init__(message, applied_seq)
        self.hashes = hashes


class BadRecords(ValueError):
    """The batch is malformed (not records with increasing integer seqs)."""


def record_payload(record: dict[str, Any]) -> dict[str, Any]:
    """A record's op payload: its ``payload`` object, else its non-frame fields."""
    payload = record.get("payload")
    if isinstance(payload, dict):
        return payload
    return {k: v for k, v in record.items() if k not in _FRAME_KEYS}


def applied_seq(db: Database, run_id: str, log_name: str) -> int:
    """How far a log has been applied (0: nothing yet)."""
    row = db.read_one(
        "SELECT applied_seq FROM ingest_progress WHERE run_id = ? AND log = ?",
        [run_id, log_name],
    )
    return int(row[0]) if row else 0


_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _blob_refs(record: dict[str, Any], blobs: BlobStore) -> set[str]:
    """The blobs a record needs stored before it is applied."""
    op = record["op"]
    p = record["payload"]
    refs: set[str] = set()
    if op in ("artifact_meta", "source"):
        refs.add(str(p.get("hash") or ""))
    elif op == "create_artifact_version":
        digest = str(p.get("digest") or "")
        refs.add(digest)
        if _HEX64.match(digest) and blobs.exists(digest):
            try:
                files = json.loads(blobs.get(digest)).get("files") or []
            except (ValueError, AttributeError, OSError):
                files = []
            refs.update(str(f["hash"]) for f in files if isinstance(f, dict) and f.get("hash"))
    elif op == "batch":
        for point in p.get("points") or []:
            if isinstance(point, dict) and point.get("artifact_hash"):
                refs.add(str(point["artifact_hash"]))
    return {h for h in refs if _HEX64.match(h)}


def _check(records: Any) -> list[dict[str, Any]]:
    """The batch's records as ``{seq, op, payload}``, validated."""
    if not isinstance(records, list):
        raise BadRecords("records must be a list")
    out: list[dict[str, Any]] = []
    prev = None
    for r in records:
        seq = r.get("seq") if isinstance(r, dict) else None
        if not isinstance(seq, int) or isinstance(seq, bool) or seq < 1:
            raise BadRecords("every record needs a positive integer seq")
        if not isinstance(r.get("op"), str) or not r["op"]:
            raise BadRecords(f"record {seq} has no op")
        if prev is not None and seq <= prev:
            raise BadRecords("records must be in increasing seq order")
        prev = seq
        out.append({"seq": seq, "op": r["op"], "payload": record_payload(r)})
    return out


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def apply_records(
    db: Database,
    data_dir: DataDir,
    blobs: BlobStore,
    run_id: str,
    log_name: str,
    from_seq: int,
    records: list[dict[str, Any]],
) -> int:
    """Apply an uploaded batch of one log (see the module docstring);
    return the log's new ``applied_seq``.

    Raises:
        BadRecords: The batch is malformed (nothing applied).
        IngestGap: ``from_seq`` (or the first new record) is beyond
            ``applied_seq + 1``.
        IngestWait: The log's run (or a fork's parent) does not exist yet.
        MissingBlobs: Records name blobs not stored yet.
    """
    batch = _check(records)
    if batch and from_seq != batch[0]["seq"]:
        raise BadRecords("from_seq must be the first record's seq")
    with db.transaction(immediate=True) as con:
        row = con.execute(
            "SELECT applied_seq, worker FROM ingest_progress WHERE run_id = ? AND log = ?",
            [run_id, log_name],
        ).fetchone()
        applied = int(row[0]) if row else 0
        if from_seq > applied + 1:
            raise IngestGap(
                f"log {log_name} of run {run_id} is applied through {applied}; "
                f"a batch from {from_seq} leaves a gap",
                applied,
            )
        todo = [r for r in batch if r["seq"] > applied]
        if not todo:
            return applied
        if todo[0]["seq"] != applied + 1:
            raise IngestGap(f"record {applied + 1} of log {log_name} is missing", applied)
        worker = bool(row[1]) if row else todo[0]["op"] == "join"
        if row is None:
            _check_ready(con, run_id, todo[0], worker, applied)
        missing = sorted({
            h for r in todo for h in _blob_refs(r, blobs) if not blobs.exists(h)
        })
        if missing:
            raise MissingBlobs(
                f"{len(missing)} blob(s) named by the batch are not stored; upload them first",
                applied, missing,
            )
        last_op = "detach" if worker else "finish"
        finished = 0
        rid: str | None = run_id
        for r in todo:
            if r["seq"] != applied + 1:
                break  # a gap inside the batch: apply up to it
            rid = _apply_record(db, data_dir, blobs, r, rid, worker=worker)
            applied = r["seq"]
            finished = 1 if r["op"] == last_op else 0
        con.execute(
            """INSERT INTO ingest_progress (run_id, log, applied_seq, worker, finished, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (run_id, log) DO UPDATE SET applied_seq = excluded.applied_seq,
                   finished = excluded.finished, updated_at = excluded.updated_at""",
            [run_id, log_name, applied, int(worker), finished, _now()],
        )
        if not finished and not worker:
            # A crashed run that logs again is running again.
            con.execute(
                "UPDATE runs SET status = 'running', ended_at = NULL "
                "WHERE id = ? AND status = 'crashed'",
                [run_id],
            )
    return applied


def _check_ready(
    con: sqlite3.Connection, run_id: str, first: dict[str, Any], worker: bool, applied: int,
) -> None:
    """A new log may start only once what it builds on exists: a worker's
    log or a resumed run's needs the run, a fork's needs its parent."""
    def exists(rid: Any) -> bool:
        return con.execute("SELECT 1 FROM runs WHERE id = ?", [rid]).fetchone() is not None

    op = first["op"]
    if op == "fork_run":
        parent = first["payload"].get("parent_id")
        if not exists(parent):
            raise IngestWait(f"run {run_id} forks run {parent}, which is not ingested yet", applied)
        return
    if op == "create_run":
        return
    if not exists(run_id):
        who = "an attached process of run" if worker else "run"
        raise IngestWait(f"{who} {run_id}: the run is not ingested yet", applied)


#: A running run whose primary log got no new record for this long is
#: ``crashed``. The SDK logs a heartbeat record every 10 s; records arrive
#: as they are uploaded.
STALE_SECONDS = 300.0


def mark_crashed(db: Database, now: float | None = None) -> list[str]:
    """Mark ``crashed`` every running run whose primary log (unfinished) has
    had no record applied for ``STALE_SECONDS``; alert on each. A later
    record makes it running again (``apply_records``)."""
    import time

    now = time.time() if now is None else now
    cutoff = datetime.fromtimestamp(now - STALE_SECONDS, timezone.utc).isoformat()
    rows = db.read_columns(
        "SELECT p.run_id, MAX(p.updated_at) AS updated_at FROM ingest_progress p "
        "JOIN runs r ON r.id = p.run_id "
        "WHERE r.status = 'running' AND p.worker = 0 AND p.finished = 0 "
        "GROUP BY p.run_id HAVING MAX(p.updated_at) < ?",
        [cutoff],
    )
    crashed = []
    for row in rows:
        with db.transaction() as con:
            hit = con.execute(
                "UPDATE runs SET status = 'crashed', ended_at = ? "
                "WHERE id = ? AND status = 'running' RETURNING display_name",
                [row["updated_at"], row["run_id"]],
            ).fetchone()
        if hit is None:
            continue
        crashed.append(row["run_id"])
        ingest_ops.insert_alert(
            db, row["run_id"],
            title=f"Run {hit[0] or row['run_id'][:8]} crashed",
            text=f"no log record for {int(STALE_SECONDS // 60)} min",
            level="error",
        )
    return crashed
