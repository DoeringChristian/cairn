"""One-time import of cairn 0.5 run logs (``.cairn/wals/*.wal.jsonl``).

Up to 0.5 every local ``cairn.Run`` appended its writes to
``<repo>/wals/<run_id>[~<label>].wal.jsonl`` (one JSON record per line) and
whichever process held the repo's ingest lease applied them to the database.
0.6 has no client-side ingestion: runs upload to the server. A repo upgraded
from 0.5 may still hold logs that were not (fully) applied; the server
imports them once, at startup (``import_legacy_logs``), with the 0.5 ingester
logic kept here unchanged, then renames each fully imported log to
``<name>.imported`` (never deleting it).

Exactly once. Each log's ``wal_progress`` row (written by 0.5 too) holds the
byte offset just past the last complete line applied. A batch (up to
``MAX_BATCH_BYTES`` of complete lines) is applied in ONE write transaction
that first reads the offset and finally stores the new one: a crash anywhere
before the commit leaves neither the ops nor the offset, so the import
resumes at the same offset on the next start.

Several processes, one run. A worker's log (``cairn.Run(primary=False)``)
opens with a ``join`` record and ends with ``detach``; it never changes the
run's status: its lifecycle records are skipped. A worker's log whose run
does not exist waits (it is left in place and retried at the next start).

The record dispatcher ``_apply_op`` is also the apply step of the 0.6 upload
protocol (``record_apply.py``): the op vocabulary is unchanged.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import ingest_ops
from .record_apply import _apply_record
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
IMPORTED_SUFFIX = ".imported"


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


def _creation_key(path: Path) -> tuple[str, str]:
    """Sort key putting run logs in the order their runs were created (the
    ``created_at`` of a first ``create_run``/``fork_run`` record), so runs
    waiting together get their series versions in start order rather than
    run-id order. Logs without one (attached processes, incomplete first
    lines, gone files) sort after, by name."""
    try:
        with open(path, "rb") as fh:
            line = fh.readline()
    except FileNotFoundError:
        return ("~", path.name)
    record = _safe_json(line.decode("utf-8", errors="replace")) if line.endswith(b"\n") else None
    payload = (record or {}).get("payload") or {}
    created = payload.get("created_at") if (record or {}).get("op") in ("create_run", "fork_run") else None
    return (created if isinstance(created, str) else "~", path.name)


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
    return total


def _retire_log(db: Database, path: Path) -> None:
    """A fully imported log: renamed ``<name>.imported`` (kept, never
    deleted), then its row dropped (a crash in between leaves a row without
    a file, dropped by the next import)."""
    try:
        os.replace(path, path.with_name(path.name + IMPORTED_SUFFIX))
    except FileNotFoundError:
        pass
    db.write("DELETE FROM wal_progress WHERE path = ?", [path.name])



def _cleanup_legacy(data_dir: DataDir) -> None:
    """``.lock`` files of the logs before 0.4 no longer mean anything (their
    ``.done`` copies, fully ingested already, are kept like every imported
    log)."""
    for p in wal_dir(data_dir).glob("*.lock"):
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
    Returns the number of records applied."""
    directory = wal_dir(data_dir)
    if not directory.exists():
        return 0
    with _repo_lock(data_dir):
        _cleanup_legacy(data_dir)
        total = 0
        present = set()
        for path in sorted(directory.glob(f"*{LOG_SUFFIX}"), key=_creation_key):
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


def import_legacy_logs(data_dir: DataDir, db: Database, blobs: BlobStore) -> dict[str, int]:
    """Import every pending 0.5 run log of the repo (see the module
    docstring); rename each log read to its end ``<name>.imported``. Logs
    waiting for a run that does not exist (a worker's) stay for the next
    start. Returns ``{"records", "imported", "waiting"}``."""
    directory = wal_dir(data_dir)
    out = {"records": 0, "imported": 0, "waiting": 0}
    if not directory.is_dir():
        return out
    logs = sorted(directory.glob(f"*{LOG_SUFFIX}"), key=_creation_key)
    if not logs:
        return out
    log.warning("cairn: importing %d run log(s) of cairn 0.5 from %s", len(logs), directory)
    out["records"] = ingest_all(data_dir, db, blobs)
    offsets = {r["path"]: r["offset"] for r in db.read_columns(
        'SELECT path, "offset" AS "offset" FROM wal_progress'
    )}
    for path in logs:
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            continue
        if path.name not in offsets and size:
            out["waiting"] += 1  # a worker's log whose run does not exist
            log.warning("cairn: run log %s waits for its run; kept for the next start", path.name)
            continue
        offset = offsets.get(path.name, 0)
        if offset < size:
            log.warning(
                "cairn: run log %s ends in %d byte(s) of an incomplete record (kept in %s)",
                path.name, size - offset, path.name + IMPORTED_SUFFIX,
            )
        _retire_log(db, path)
        out["imported"] += 1
    log.warning(
        "cairn: imported %d record(s) from %d run log(s) (renamed *%s)",
        out["records"], out["imported"], IMPORTED_SUFFIX,
    )
    return out


_HASH = re.compile(rb"[0-9a-f]{64}")


def pending_hashes(data_dir: DataDir, db: Database) -> set[str]:
    """Every sha256-looking string in the not-yet-imported part of every
    legacy log still waiting (a worker's whose run does not exist): garbage
    collection keeps the blobs those records will reference."""
    directory = wal_dir(data_dir)
    if not directory.is_dir():
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
