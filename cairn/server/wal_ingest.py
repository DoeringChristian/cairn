"""Run-log ingestion: applies the runs' append-only logs to the SQLite DB.

Every local ``cairn.Run`` appends its writes to ``.cairn/wals/<run_id>.wal.jsonl``
(one JSON record per line) and stores blobs in the content-addressed store;
it never writes the database. Only the holder of the repo's ingest lease
(``storage/lease.py``) calls ``ingest_all``: the server's background loop
every ~2 s, or a Reader / CLI command / run catching up while no server
holds the lease.

Exactly once. Each log's ``wal_progress`` row holds the byte offset just
past the last complete line applied. A batch (up to ``MAX_BATCH_BYTES`` of
complete lines) is applied in ONE write transaction that first reads the
offset and finally stores the new one: a crash anywhere before the commit
leaves neither the ops nor the offset, so the batch is applied again from
the same offset, and an applied batch is never re-read (also not after a
restart, and not by a second ingester racing this one). A torn last line (a
writer mid-append, or killed there) has no newline yet and waits for the
next cycle.

Completion. A run's log ends with its ``finish`` record; once that is
ingested (and nothing follows it), the log file is deleted, then its
progress row. A log whose run is still ``running`` and that has had no new
record (heartbeats included, every 10 s) for ``STALE_SECONDS`` marks the run
``crashed``; any later record of it makes the run ``running`` again.

Several processes, one run. Every process of a shared run appends to its
own log: ``<run_id>.wal.jsonl`` for an unlabelled one, ``<run_id>~<label>
.wal.jsonl`` for a labelled one. A worker's log (``cairn.Run(primary=False)``)
opens with a ``join`` record and ends with ``detach`` instead of ``finish``;
it never changes the run's status: its lifecycle records (create, resume,
finish, heartbeat, ...) are skipped, its silence never makes the run
``crashed`` and its records never revive a crashed one. A worker's log waits,
untouched, until its run exists (its primary's ``create_run`` is ingested),
then applies in order; it is deleted once its ``detach`` is ingested.

Logs of earlier versions (no progress row) are read once from the start;
their ``.done`` copies (already ingested) and ``.lock`` files are deleted.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import ingest_ops
from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database

log = logging.getLogger(__name__)

#: Most bytes of complete lines applied in one transaction. A transaction
#: holds the process's write lock, so this bounds how long an API write waits
#: behind ingestion.
MAX_BATCH_BYTES = 1 << 20

#: A running run whose log got no new record for this long is ``crashed``.
#: The SDK writes a heartbeat record every 10 s.
STALE_SECONDS = 300.0

LOG_SUFFIX = ".wal.jsonl"


def wal_dir(data_dir: DataDir) -> Path:
    return data_dir.root / "wals"


#: Between a run id and a process label in a labelled process's log name.
LABEL_SEP = "~"


def log_name(run_id: str, label: str | None = None) -> str:
    """The file name of a process's log: ``<run_id>[~<label>].wal.jsonl``."""
    return f"{run_id}{LABEL_SEP}{label}{LOG_SUFFIX}" if label else f"{run_id}{LOG_SUFFIX}"


def log_path(data_dir: DataDir, run_id: str, label: str | None = None) -> Path:
    return wal_dir(data_dir) / log_name(run_id, label)


def run_id_of(name: str) -> str:
    """The run id a log file name belongs to."""
    return name.removesuffix(LOG_SUFFIX).split(LABEL_SEP, 1)[0]


#: Records a worker's log may not apply: the run's lifecycle and liveness
#: are its primary's.
_PRIMARY_ONLY = frozenset({
    "create_run", "fork_run", "resume_run", "rewind_run", "finish", "heartbeat",
})


def _first_op(path: Path) -> str | None:
    """The op of a log's first record; None while that line is incomplete.

    Raises:
        FileNotFoundError: The log is gone.
    """
    with open(path, "rb") as fh:
        line = fh.readline()
    if not line.endswith(b"\n"):
        return None
    record = _safe_json(line.decode("utf-8", errors="replace"))
    return record.get("op") if record else ""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_json(line: str) -> dict[str, Any] | None:
    """Parse a JSONL line, returning None on error."""
    line = line.strip()
    if not line:
        return None
    try:
        record = json.loads(line)
    except json.JSONDecodeError:
        log.warning("skipping malformed log line: %s", line[:120])
        return None
    return record if isinstance(record, dict) else None


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
    payload = record.get("payload")
    if not isinstance(payload, dict):
        payload = {}
    try:
        with db.transaction():
            return _apply_op(db, data_dir, blobs, op, payload, run_id, worker=worker)
    except sqlite3.OperationalError:
        raise
    except Exception:  # noqa: BLE001
        log.exception("log op %r failed; skipped", op)
        return run_id


#: One ingestion at a time per repo in this process (the lease already makes
#: it one process); concurrent ones would only redo each other's scans.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _repo_lock(data_dir: DataDir) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(str(data_dir.root), threading.Lock())


def ingest_log(db: Database, data_dir: DataDir, blobs: BlobStore, path: Path) -> int:
    """Apply everything new in one run log (see the module docstring);
    delete the log once its run's ``finish`` (a worker's: its ``detach``)
    is applied. Returns the number of records applied."""
    name = path.name
    file_run_id = run_id_of(name)
    total = 0
    offset, finished, size = 0, 0, 0
    while True:
        with db.transaction(immediate=True) as con:
            row = con.execute(
                'SELECT "offset", finished, worker FROM wal_progress WHERE path = ?', [name],
            ).fetchone()
            offset, finished, worker = (row[0], row[1], bool(row[2])) if row else (0, 0, False)
            try:
                if row is None:
                    first = _first_op(path)
                    if first is None:
                        break  # its first record is still being written
                    worker = first == "join"
                if worker and con.execute(
                    "SELECT 1 FROM runs WHERE id = ?", [file_run_id],
                ).fetchone() is None:
                    break  # waits for its run (its primary's create_run)
                with open(path, "rb") as fh:
                    fh.seek(offset)
                    chunk = fh.read(MAX_BATCH_BYTES)
                    end = chunk.rfind(b"\n")
                    if end < 0 and len(chunk) == MAX_BATCH_BYTES:
                        # One line longer than a batch: read on to its end.
                        chunk += fh.readline()
                        end = chunk.rfind(b"\n")
                    size = fh.seek(0, 2)
            except FileNotFoundError:
                con.execute("DELETE FROM wal_progress WHERE path = ?", [name])
                return total
            if end < 0:
                break
            complete = chunk[: end + 1]
            run_id: str | None = file_run_id
            applied = 0
            last_op = "detach" if worker else "finish"
            for raw in complete.split(b"\n")[:-1]:
                record = _safe_json(raw.decode("utf-8", errors="replace"))
                if not record:
                    continue
                run_id = _apply_record(db, data_dir, blobs, record, run_id, worker=worker)
                applied += 1
                finished = 1 if record.get("op") == last_op else 0
            offset += len(complete)
            con.execute(
                """INSERT INTO wal_progress (path, run_id, "offset", finished, updated_at, worker)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT (path) DO UPDATE SET "offset" = excluded."offset",
                       finished = excluded.finished, updated_at = excluded.updated_at""",
                [name, file_run_id, offset, finished, _now(), int(worker)],
            )
            if applied and not finished and not worker:
                # A crashed run that logs again is running again.
                con.execute(
                    "UPDATE runs SET status = 'running', ended_at = NULL "
                    "WHERE id = ? AND status = 'crashed'",
                    [file_run_id],
                )
            total += applied
        if offset >= size:
            break
    if finished and offset >= size:
        _delete_log(db, path)
    return total


def _delete_log(db: Database, path: Path) -> None:
    """A finished, fully ingested log: the file first, then its row (a crash
    in between leaves a row without a file, dropped by the next cycle)."""
    path.unlink(missing_ok=True)
    db.write("DELETE FROM wal_progress WHERE path = ?", [path.name])



def _cleanup_legacy(data_dir: DataDir) -> None:
    """Files of the logs before 0.4: ``.done`` copies were fully ingested
    already, and ``.lock`` files no longer mean anything."""
    for pattern in ("*.done", "*.lock"):
        for p in wal_dir(data_dir).glob(pattern):
            p.unlink(missing_ok=True)


def _primary_log_mtimes(
    db: Database, data_dir: DataDir, names: set[str] | None = None,
) -> dict[str, float]:
    """Each running run's newest record time over its primary's unfinished
    logs (a worker's log never counts: the run's liveness is its primary's).
    ``names``: the log files present, when the caller listed them already."""
    rows = db.read_columns(
        "SELECT w.path, w.run_id FROM wal_progress w JOIN runs r ON r.id = w.run_id "
        "WHERE r.status = 'running' AND w.finished = 0 AND w.worker = 0",
    )
    latest: dict[str, float] = {}
    for row in rows:
        if names is not None and row["path"] not in names:
            continue
        try:
            mtime = (wal_dir(data_dir) / row["path"]).stat().st_mtime
        except FileNotFoundError:
            continue
        latest[row["run_id"]] = max(mtime, latest.get(row["run_id"], mtime))
    return latest


def mark_crashed(db: Database, data_dir: DataDir, now: float | None = None) -> list[str]:
    """Mark ``crashed`` every running run whose primary's log (not finished)
    has had no new record for ``STALE_SECONDS``; alert on each. Returns
    their ids."""
    now = time.time() if now is None else now
    crashed = []
    for run_id, mtime in _primary_log_mtimes(db, data_dir).items():
        if now - mtime <= STALE_SECONDS:
            continue
        ended = datetime.fromtimestamp(mtime, timezone.utc).isoformat()
        with db.transaction() as con:
            hit = con.execute(
                "UPDATE runs SET status = 'crashed', ended_at = ? "
                "WHERE id = ? AND status = 'running' RETURNING display_name",
                [ended, run_id],
            ).fetchone()
        if hit is None:
            continue
        crashed.append(run_id)
        ingest_ops.insert_alert(
            db, run_id,
            title=f"Run {hit[0] or run_id[:8]} crashed",
            text=f"no log record for {int(STALE_SECONDS // 60)} min",
            level="error",
        )
    return crashed


def ingest_all(data_dir: DataDir, db: Database, blobs: BlobStore) -> int:
    """Ingest every run log of the repo, then mark stale runs crashed.

    Only the ingest-lease holder may call this. Returns the number of
    records applied."""
    directory = wal_dir(data_dir)
    if not directory.exists():
        return 0
    with _repo_lock(data_dir):
        _cleanup_legacy(data_dir)
        total = 0
        present = set()
        for path in sorted(directory.glob(f"*{LOG_SUFFIX}")):
            present.add(path.name)
            try:
                total += ingest_log(db, data_dir, blobs, path)
            except sqlite3.OperationalError:
                log.warning("ingesting %s failed; retried next cycle", path.name, exc_info=True)
        for r in db.read_columns("SELECT path FROM wal_progress"):
            if r["path"] not in present and not (directory / r["path"]).exists():
                db.write("DELETE FROM wal_progress WHERE path = ?", [r["path"]])
        mark_crashed(db, data_dir)
    return total


def has_pending(data_dir: DataDir, db: Database | None) -> bool:
    """Whether ``ingest_all`` has anything to do: a log with unread bytes or
    not seen yet, a finished log still to delete, a running run's log gone
    stale, or files of the old layout. A cheap check (directory listing,
    file sizes, one query) that lets a reader skip taking the lease."""
    directory = wal_dir(data_dir)
    if not directory.exists():
        return False
    names = [p.name for p in directory.iterdir()]
    if any(n.endswith((".done", ".lock")) for n in names):
        return True
    logs = [n for n in names if n.endswith(LOG_SUFFIX)]
    if not logs:
        return False
    if db is None:
        return True
    try:
        rows = {
            r["path"]: r for r in db.read_columns(
                'SELECT w.path, w."offset" AS "offset", w.finished '
                "FROM wal_progress w"
            )
        }
    except sqlite3.OperationalError:  # no such table yet: an old database
        return True
    for name in logs:
        row = rows.get(name)
        try:
            st = (directory / name).stat()
        except FileNotFoundError:
            continue
        if row is None:
            if not _waiting_worker_log(db, directory / name):
                return True
        elif st.st_size != row["offset"] or row["finished"]:
            return True
    now = time.time()
    try:
        latest = _primary_log_mtimes(db, data_dir, set(logs))
    except sqlite3.OperationalError:  # an old database
        return True
    return any(now - mtime > STALE_SECONDS for mtime in latest.values())


def _waiting_worker_log(db: Database, path: Path) -> bool:
    """A worker's log not started yet whose run does not exist yet: nothing
    to do until its primary's log (pending by itself) creates the run."""
    if LABEL_SEP not in path.name:
        return False
    try:
        if _first_op(path) != "join":
            return False
    except FileNotFoundError:
        return True
    return not db.read_columns("SELECT 1 FROM runs WHERE id = ?", [run_id_of(path.name)])


_HASH = re.compile(rb"[0-9a-f]{64}")


def pending_hashes(data_dir: DataDir, db: Database) -> set[str]:
    """Every sha256-looking string in the not-yet-ingested part of every log:
    garbage collection keeps the blobs those records will reference."""
    directory = wal_dir(data_dir)
    if not directory.exists():
        return set()
    offsets = {r["path"]: r["offset"] for r in db.read_columns(
        'SELECT path, "offset" AS "offset" FROM wal_progress'
    )}
    found: set[str] = set()
    for path in directory.glob(f"*{LOG_SUFFIX}"):
        try:
            with open(path, "rb") as fh:
                fh.seek(offsets.get(path.name, 0))
                found.update(m.decode() for m in _HASH.findall(fh.read()))
        except FileNotFoundError:
            continue
    return found
