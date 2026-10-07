"""Pure ingest operations, independent of HTTP.

Both the FastAPI routes and the local SDK transport call these functions.
They do *not* handle HTTP concerns (validation, status codes) — that's the
caller's job. They raise ``ValueError`` or ``LookupError`` on user errors;
callers translate those to HTTP status codes.
"""

from __future__ import annotations

import json
import secrets
import shutil
from datetime import datetime
from typing import Any

from . import config_doc, progress
from .routes._common import parse_timestamp, slugify, utc_now, value_type
from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database
from .storage.metric_stats import insert_points, rebuild_metric_stats


class RunNotFound(LookupError):
    """Raised when an operation targets a run id that doesn't exist."""


class RunExists(ValueError):
    """Raised when a new run is created with the id of an existing one."""


def _require_run(db: Database, run_id: str) -> dict[str, Any]:
    rows = db.read_columns("SELECT * FROM runs WHERE id = ?", [run_id])
    if not rows:
        raise RunNotFound(f"run {run_id} not found")
    return rows[0]


#: Every optional ``create_run`` field, as the create body / WAL payload
#: spells it. LocalTransport and the WAL replay forward exactly these keys, so
#: a new field is added here, to ``create_run``'s signature, and to
#: ``CreateRunRequest``.
CREATE_RUN_FIELDS: tuple[str, ...] = (
    "run_id", "name", "tags", "notes", "env", "git", "cli_args", "hostname",
    "user", "created_at", "group", "job_type", "sweep_id", "parent_run_id",
    "fork_step",
)


def create_run(
    db: Database,
    *,
    project: str,
    run_id: str | None = None,
    name: str | None = None,
    tags: list[str] | None = None,
    notes: str | None = None,
    env: dict[str, Any] | None = None,
    git: dict[str, Any] | None = None,
    cli_args: list[str] | None = None,
    hostname: str | None = None,
    user: str | None = None,
    created_at: str | datetime | None = None,
    group: str | None = None,
    job_type: str | None = None,
    sweep_id: str | None = None,
    parent_run_id: str | None = None,
    fork_step: int | None = None,
) -> dict[str, Any]:
    """Create a run (and its project if needed). Returns metadata dict.

    ``created_at`` backdates the run (imports, WAL replay); default now.
    ``group`` is stored in the ``run_group`` column.

    Raises:
        RunExists: A run with ``run_id`` exists already.
    """
    project_id = slugify(project)
    if not run_id:
        run_id = secrets.token_hex(16)
    elif db.read_columns("SELECT id FROM runs WHERE id = ?", [run_id]):
        raise RunExists(f"a run with id {run_id} exists already")
    now = utc_now()
    created = parse_timestamp(created_at) or now

    with db.transaction() as con:
        con.execute(
            """
            INSERT INTO projects (id, name, created_at, description, tags)
            VALUES (?, ?, ?, NULL, NULL)
            ON CONFLICT (id) DO NOTHING
            """,
            [project_id, project, now],
        )
        con.execute(
            """
            INSERT INTO runs (
                id, project_id, display_name, created_at, ended_at,
                status, exit_code, git_sha, git_dirty, git_branch, git_remote,
                cli_args, env_snapshot, hostname, "user", tags, notes,
                last_heartbeat, parent_run_id, fork_step, run_group, job_type,
                sweep_id
            ) VALUES (?, ?, ?, ?, NULL, 'running', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?, ?, ?)
            """,
            [
                run_id,
                project_id,
                name,
                created,
                git.get("sha") if git else None,
                git.get("dirty") if git else None,
                git.get("branch") if git else None,
                git.get("remote") if git else None,
                json.dumps(cli_args) if cli_args is not None else None,
                json.dumps(env) if env is not None else None,
                hostname,
                user,
                json.dumps(tags) if tags is not None else None,
                notes,
                now,  # last_heartbeat
                parent_run_id,
                fork_step,
                group,
                job_type,
                sweep_id,
            ],
        )

    return {
        "run_id": run_id,
        "project_id": project_id,
        "url": f"/p/{project_id}/r/{run_id}",
    }


#: The document column on ``runs`` and its flat index table, per kind.
KEY_TABLES = ("params", "summary")
DOC_COLUMN = {"params": "config", "summary": "summary"}


def write_doc(con: Any, table: str, run_id: str, doc: dict[str, Any]) -> int:
    """Store ``doc`` on the run and rebuild its flat index in ``table``.

    Raises ValueError (before writing anything) when two paths of ``doc``
    share a flat key.
    """
    flat = config_doc.flatten(doc)
    con.execute(
        f"UPDATE runs SET {DOC_COLUMN[table]} = ? WHERE id = ?",
        [config_doc.dumps(doc), run_id],
    )
    con.execute(f"DELETE FROM {table} WHERE run_id = ?", [run_id])
    con.executemany(
        f"INSERT INTO {table} (run_id, key, value, value_type) VALUES (?, ?, ?, ?)",
        [(run_id, k, json.dumps(v), value_type(v)) for k, v in flat.items()],
    )
    return len(flat)


def _read_doc(con: Any, table: str, run_id: str) -> dict[str, Any]:
    row = con.execute(
        f"SELECT {DOC_COLUMN[table]} FROM runs WHERE id = ?", [run_id],
    ).fetchone()
    if row is None:
        raise RunNotFound(f"run {run_id} not found")
    return config_doc.loads(row[0])


def _merge_doc(db: Database, table: str, run_id: str, values: dict[str, Any]) -> int:
    """Deep-merge ``values`` into the run's document (see ``config_doc``) and
    rebuild the flat index, in one transaction. ``params`` and ``summary``
    are the same shape carrying different meanings — inputs versus declared
    results — so the write is implemented once. ``table`` is never
    caller-supplied; both call sites pass a literal.

    Raises:
        TypeError: A value is not JSON.
        ValueError: The merged document has two paths with one flat key.
    """
    update = config_doc.normalize(values)
    # Read-modify-write: take the write lock up front, or a concurrent writer
    # (sweep workers, other processes) makes the lock upgrade fail at once.
    with db.transaction(immediate=True) as con:
        doc = config_doc.merge(_read_doc(con, table, run_id), update)
        return write_doc(con, table, run_id, doc)


def set_params(db: Database, run_id: str, params: dict[str, Any]) -> int:
    """Run inputs: hyperparameters, argv, anything decided before the work."""
    return _merge_doc(db, "params", run_id, params)


def set_summary(db: Database, run_id: str, summary: dict[str, Any]) -> int:
    """Run results the author DECLARED.

    Nothing writes here implicitly. A metric's last value is not a summary
    entry; the run table resolves that at read time, preferring an explicit
    summary key over the last point of the series with the same name. Keeping
    the write explicit is what makes "who claimed this number" answerable.
    """
    return _merge_doc(db, "summary", run_id, summary)


def run_docs(db: Database, run_id: str) -> dict[str, Any]:
    """The run's ``{"config": doc, "summary": doc}``."""
    row = db.read_one("SELECT config, summary FROM runs WHERE id = ?", [run_id])
    if row is None:
        raise RunNotFound(f"run {run_id} not found")
    return {"config": config_doc.loads(row[0]), "summary": config_doc.loads(row[1])}


#: Points written per transaction. A transaction holds the process's write
#: lock, so this bounds how long any other write (a comparison created from
#: the UI, another run's batch) waits behind a large batch: ~5 ms. (Smaller
#: transactions measured no slower: 1000 points ~190k points/s, 5000 ~145k.)
INGEST_CHUNK = 1000


def insert_batch(
    db: Database, run_id: str, points: list[dict[str, Any]]
) -> int:
    """Insert points (a point already stored at its step is kept) and fold
    the inserted ones into ``metric_stats``, in transactions of at most
    ``INGEST_CHUNK`` points (each consistent on its own: the points it
    inserted and their stats)."""
    _require_run(db, run_id)
    rows = [
        (
            p["name"],
            p["step"],
            p["wall_time"],
            p["object_type"],
            p.get("scalar_value"),
            p.get("artifact_hash"),
            json.dumps(p["metadata"]) if p.get("metadata") is not None else None,
        )
        for p in points
    ]
    # IMMEDIATE: insert_points reads the top rowid before writing, and a
    # deferred read lock cannot be upgraded while another process writes.
    for i in range(0, len(rows), INGEST_CHUNK):
        with db.transaction(immediate=True) as con:
            insert_points(con, run_id, rows[i:i + INGEST_CHUNK])
            progress.fold_points(con, run_id, rows[i:i + INGEST_CHUNK])
    return len(rows)


def insert_logs(
    db: Database,
    data_dir: DataDir,
    run_id: str,
    lines: list[dict[str, Any]],
) -> int:
    """Store captured console lines. A line's ``label`` names the process
    that printed it (None: an unlabelled one); ``line_no`` counts per
    process, so ``(label, line_no)`` identifies a line within its run."""
    _require_run(db, run_id)
    rows = [
        (run_id, line["stream"], line["wall_time"], line["line_no"], line["content"],
         line.get("label"))
        for line in lines
    ]
    db.executemany(
        "INSERT OR IGNORE INTO log_lines (run_id, stream, wall_time, line_no, content, label) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )

    def append_files() -> None:
        # Append to on-disk log files, preserving ANSI if provided.
        log_dir = data_dir.run_log_dir(run_id)
        combined_path = log_dir / "combined.log"
        stream_paths = {
            "stdout": log_dir / "stdout.log",
            "stderr": log_dir / "stderr.log",
        }
        with combined_path.open("a", encoding="utf-8") as comb_fh:
            for line in lines:
                raw = line.get("content_raw") or line["content"]
                stream_path = stream_paths.get(line["stream"])
                if stream_path is not None:
                    with stream_path.open("a", encoding="utf-8") as fh:
                        fh.write(raw + "\n")
                who = f"{line['label']} " if line.get("label") else ""
                comb_fh.write(f"[{who}{line['stream']}] {raw}\n")

    # Only once the rows are committed: a log batch whose transaction rolls
    # back is applied again, and must not append its lines twice.
    db.after_commit(append_files)
    return len(rows)


def put_artifact(
    db: Database,
    blobs: BlobStore,
    data: bytes,
    mime_type: str,
    metadata: dict[str, Any] | None = None,
    object_type: str | None = None,
) -> dict[str, Any]:
    digest, size = blobs.put(data)
    db.write(
        """
        INSERT INTO artifacts (hash, mime_type, size_bytes, metadata, object_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (hash) DO UPDATE SET
            object_type = COALESCE(EXCLUDED.object_type, artifacts.object_type)
        """,
        [digest, mime_type, size, json.dumps(metadata or {}), object_type, utc_now()],
    )
    return {"hash": digest, "size_bytes": size}


def save_source(
    db: Database,
    data_dir: DataDir,
    run_id: str,
    archive: bytes,
    manifest: dict[str, Any],
) -> dict[str, Any]:
    _require_run(db, run_id)
    src_dir = data_dir.run_source_dir(run_id)
    (src_dir / "tree.tar.zst").write_bytes(archive)
    (src_dir / "manifest.json").write_text(json.dumps(manifest))
    return {
        "run_id": run_id,
        "archive_bytes": len(archive),
        "num_files": len(manifest.get("files", [])),
    }


def finish_run(
    db: Database,
    run_id: str,
    status: str = "completed",
    exit_code: int | None = None,
    ended_at: str | datetime | None = None,
) -> None:
    """End a run. ``ended_at`` defaults to now (imports and WAL replay pass
    the time the run actually ended)."""
    run = _require_run(db, run_id)
    db.write(
        "UPDATE runs SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?",
        [status, parse_timestamp(ended_at) or utc_now(), exit_code, run_id],
    )
    # Alert only on a real transition, so a WAL replayed a second time (or a
    # repeated finish) doesn't alert twice.
    if run["status"] in ("running", "crashed") and status in _ALERT_ON_STATUS:
        name = run.get("display_name") or run_id[:8]
        insert_alert(
            db, run_id,
            title=f"Run {name} {status}",
            text=f"exit code {exit_code}" if exit_code is not None else "",
            level=_ALERT_ON_STATUS[status],
        )


#: Final statuses that raise an automatic alert, with the alert's level.
_ALERT_ON_STATUS = {"failed": "error", "killed": "warn"}

ALERT_LEVELS = ("info", "warn", "error")


def insert_alert(
    db: Database,
    run_id: str,
    title: str,
    text: str = "",
    level: str = "info",
    *,
    alert_id: str | None = None,
    created_at: str | datetime | None = None,
) -> str:
    """Write an alert row (delivery is the server's background task).

    ``alert_id`` is client-generated on the SDK paths so replaying a WAL is
    idempotent (``INSERT OR IGNORE``)."""
    if level not in ALERT_LEVELS:
        raise ValueError(f"alert level must be one of {ALERT_LEVELS}, not {level!r}")
    run = _require_run(db, run_id)
    alert_id = alert_id or secrets.token_hex(16)
    ts = parse_timestamp(created_at) or utc_now()
    db.write(
        """
        INSERT OR IGNORE INTO alerts (id, run_id, project_id, level, title, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [alert_id, run_id, run["project_id"], level, title, text or "", ts.isoformat()],
    )
    return alert_id


def set_tags(db: Database, run_id: str, tags: list[str]) -> None:
    _require_run(db, run_id)
    db.write("UPDATE runs SET tags = ? WHERE id = ?", [json.dumps(tags), run_id])


def set_notes(db: Database, run_id: str, notes: str) -> None:
    _require_run(db, run_id)
    db.write("UPDATE runs SET notes = ? WHERE id = ?", [notes, run_id])


def rename_run(db: Database, run_id: str, display_name: str) -> None:
    _require_run(db, run_id)
    db.write("UPDATE runs SET display_name = ? WHERE id = ?", [display_name, run_id])


def delete_keys(db: Database, run_id: str, table: str, keys: list[str]) -> None:
    """Delete config (``params``) or summary keys. A key is a dotted path into
    the document and removes that node with everything under it (``hparams``
    takes ``hparams.lr`` with it)."""
    if table not in KEY_TABLES:
        raise ValueError(f"table must be one of {KEY_TABLES}, got {table!r}")
    with db.transaction() as con:
        doc = _read_doc(con, table, run_id)
        for key in keys:
            doc = config_doc.delete(doc, key)
        write_doc(con, table, run_id, doc)


def set_archived(db: Database, run_id: str, archived: bool) -> str | None:
    """Archive (or unarchive) a run; its ``status`` is untouched. Archiving an
    archived run keeps its first ``archived_at``. Returns ``archived_at``."""
    _require_run(db, run_id)
    if archived:
        db.write(
            "UPDATE runs SET archived_at = COALESCE(archived_at, ?) WHERE id = ?",
            [utc_now().isoformat(), run_id],
        )
    else:
        db.write("UPDATE runs SET archived_at = NULL WHERE id = ?", [run_id])
    (archived_at,) = db.read_one("SELECT archived_at FROM runs WHERE id = ?", [run_id])
    return archived_at


def heartbeat(db: Database, run_id: str, *, primary: bool = True) -> str | None:
    """Update the heartbeat timestamp for a running run (a ``crashed`` one is
    running again); return its ``stop_requested`` timestamp (None unless
    someone asked it to stop).

    A worker's heartbeat (``primary=False``) only reads ``stop_requested``:
    the run's liveness is its primary's."""
    if not primary:
        row = db.read_one("SELECT stop_requested FROM runs WHERE id = ?", [run_id])
        return row[0] if row else None
    with db.transaction() as con:
        row = con.execute(
            "UPDATE runs SET last_heartbeat = ?, status = 'running', ended_at = NULL "
            "WHERE id = ? AND status IN ('running', 'crashed') "
            "RETURNING stop_requested",
            [utc_now().isoformat(), run_id],
        ).fetchone()
    return row[0] if row else None


def join_run(db: Database, run_id: str) -> dict[str, Any]:
    """What a worker process (``cairn.Run(primary=False)``) joining the run
    needs: its project, tags, documents, status and pending stop request.
    Changes nothing.

    Raises:
        RunNotFound: No such run (yet).
    """
    row = _require_run(db, run_id)
    return {
        "run_id": run_id,
        "project_id": row["project_id"],
        "url": f"/p/{row['project_id']}/r/{run_id}",
        "tags": json.loads(row["tags"]) if row.get("tags") else [],
        "config": config_doc.loads(row.get("config")),
        "summary": config_doc.loads(row.get("summary")),
        "status": row["status"],
        "stop_requested": row.get("stop_requested"),
    }


def request_stop(db: Database, run_id: str) -> str | None:
    """Ask a running run to stop; the SDK sees it on its next heartbeat.

    Returns the request timestamp (the first one, if asked twice), or None
    when the run is not running."""
    _require_run(db, run_id)
    with db.transaction() as con:
        row = con.execute(
            "UPDATE runs SET stop_requested = COALESCE(stop_requested, ?) "
            "WHERE id = ? AND status = 'running' RETURNING stop_requested",
            [utc_now().isoformat(), run_id],
        ).fetchone()
    return row[0] if row else None


def set_total_steps(db: Database, run_id: str, total_steps: int | None) -> None:
    """The run's declared number of steps (None clears it); see ``progress``."""
    with db.transaction(immediate=True) as con:
        progress.set_total_steps(con, run_id, total_steps)


def set_progress(
    db: Database, run_id: str, value: float, total: float | None = None,
    wall_time: str | None = None,
) -> None:
    """An explicit ``run.progress(value, total)`` made at ``wall_time``."""
    with db.transaction(immediate=True) as con:
        progress.set_progress(con, run_id, value, total, wall_time)


def set_metric_rule(
    db: Database,
    run_id: str,
    name: str,
    x: str | None = None,
    summary: str | None = None,
) -> None:
    """Record how the metric ``name`` is read: the series ``x`` to plot it
    against, and its summary rule (see ``summary_rules``). Fields merge: a
    later call replaces the fields it sets and keeps the ones it leaves None."""
    from .summary_rules import SUMMARY_KINDS

    _require_run(db, run_id)
    if summary is not None and summary not in SUMMARY_KINDS:
        raise ValueError(f"summary must be one of {SUMMARY_KINDS}, got {summary!r}")
    db.write(
        """
        INSERT INTO metric_defs (run_id, name, x, summary)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (run_id, name) DO UPDATE
          SET x = COALESCE(EXCLUDED.x, x),
              summary = COALESCE(EXCLUDED.summary, summary)
        """,
        [run_id, name, x, summary],
    )


# ---- resume / fork / rewind --------------------------------------------------

#: The rows of a run's history that survive a fork or rewind at step ``k``.
#: Training series keep ``step <= k``. ``system.*`` steps are the sampler's own
#: counters, not training steps, so those rows are kept by time instead: up to
#: the latest wall_time among the kept training rows (the second parameter).
_HISTORY_KEEP = (
    "((substr(name, 1, 7) != 'system.' AND step <= ?)"
    " OR (substr(name, 1, 7) = 'system.' AND wall_time <= ?))"
)

_SEQUENCE_COLUMNS = (
    "name, step, wall_time, object_type, "
    "scalar_value, artifact_hash, metadata"
)


def _history_params(db: Database, run_id: str, step: int) -> list[Any]:
    """The two parameters of ``_HISTORY_KEEP`` for ``run_id`` at ``step``."""
    (cutoff,) = db.read_one(
        "SELECT MAX(wall_time) FROM sequences WHERE run_id = ? "
        "AND substr(name, 1, 7) != 'system.' AND step <= ?",
        [run_id, step],
    ) or (None,)
    return [step, cutoff]


def resume_run(db: Database, run_id: str) -> dict[str, Any]:
    """Reopen a run: running again, no end, no exit code, no pending stop."""
    row = _require_run(db, run_id)
    db.write(
        """UPDATE runs SET status = 'running', ended_at = NULL, exit_code = NULL,
                  stop_requested = NULL, last_heartbeat = ?
            WHERE id = ?""",
        [utc_now().isoformat(), run_id],
    )
    return {
        "run_id": run_id,
        "project_id": row["project_id"],
        "url": f"/p/{row['project_id']}/r/{run_id}",
        "tags": json.loads(row["tags"]) if row.get("tags") else [],
        # The stored documents, so the SDK can check later writes against them.
        "config": config_doc.loads(row.get("config")),
        "summary": config_doc.loads(row.get("summary")),
    }


def rewind_run(db: Database, run_id: str, step: int) -> dict[str, Any]:
    """Drop everything after ``step`` from a run's history, then resume it.

    ``data_epoch`` is bumped because the deleted rowids get reused (sequences
    has no AUTOINCREMENT): a live client's rowid cursor is stale afterwards.
    """
    _require_run(db, run_id)
    keep = _history_params(db, run_id, step)
    with db.transaction() as con:
        con.execute(
            f"DELETE FROM sequences WHERE run_id = ? AND NOT {_HISTORY_KEEP}",
            [run_id, *keep],
        )
        rebuild_metric_stats(con, [run_id])
        progress.recompute_max_step(con, run_id)
        con.execute(
            "UPDATE runs SET data_epoch = COALESCE(data_epoch, 0) + 1 WHERE id = ?",
            [run_id],
        )
    return resume_run(db, run_id)


def fork_run(
    db: Database, *, parent_id: str, step: int, run_id: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    """Create a run from ``parent_id``'s history up to ``step``.

    The child is independent: it gets a COPY of the parent's history <= step
    (see ``_HISTORY_KEEP``), its config and summary documents and its metric
    definitions. ``fields`` are the
    other ``create_run`` fields (name, tags, env, ...).

    Idempotent for WAL replay: an existing child is not re-created, and the
    copies are INSERT OR IGNORE, so rows the child wrote itself win.
    """
    parent = _require_run(db, parent_id)
    exists = run_id is not None and db.read_columns(
        "SELECT id FROM runs WHERE id = ?", [run_id],
    )
    if not exists:
        (project,) = db.read_one(
            "SELECT name FROM projects WHERE id = ?", [parent["project_id"]],
        ) or (parent["project_id"],)
        fields = {k: fields.get(k) for k in CREATE_RUN_FIELDS if k != "run_id"}
        fields.update(parent_run_id=parent_id, fork_step=step)
        run_id = create_run(db, project=project, run_id=run_id, **fields)["run_id"]
    assert run_id is not None
    keep = _history_params(db, parent_id, step)
    with db.transaction() as con:
        con.execute(
            f"""INSERT OR IGNORE INTO sequences (run_id, {_SEQUENCE_COLUMNS})
                SELECT ?, {_SEQUENCE_COLUMNS} FROM sequences
                 WHERE run_id = ? AND {_HISTORY_KEEP}""",
            [run_id, parent_id, *keep],
        )
        rebuild_metric_stats(con, [run_id])
        progress.recompute_max_step(con, run_id)
        for table in KEY_TABLES:
            # The child's own writes (a replayed WAL) merge over the parent's.
            doc = config_doc.merge(
                _read_doc(con, table, parent_id), _read_doc(con, table, run_id),
            )
            write_doc(con, table, run_id, doc)
        con.execute(
            """INSERT OR IGNORE INTO metric_defs (run_id, name, x, summary)
               SELECT ?, name, x, summary FROM metric_defs WHERE run_id = ?""",
            [run_id, parent_id],
        )
    project_id = parent["project_id"]
    return {
        "run_id": run_id, "project_id": project_id, "url": f"/p/{project_id}/r/{run_id}",
        **run_docs(db, run_id),
    }


def delete_run(db: Database, data_dir: DataDir, run_id: str) -> None:
    _require_run(db, run_id)
    # FK enforcement inside an explicit transaction doesn't recognize deleted
    # child rows; run each DELETE as its own auto-committed stmt.
    db.write("DELETE FROM sequences WHERE run_id = ?", [run_id])
    db.write("DELETE FROM metric_stats WHERE run_id = ?", [run_id])
    db.write("DELETE FROM params WHERE run_id = ?", [run_id])
    db.write("DELETE FROM summary WHERE run_id = ?", [run_id])
    db.write("DELETE FROM run_inputs WHERE run_id = ?", [run_id])
    db.write("DELETE FROM log_lines WHERE run_id = ?", [run_id])
    db.write("DELETE FROM alerts WHERE run_id = ?", [run_id])
    db.write("DELETE FROM metric_defs WHERE run_id = ?", [run_id])
    # Trials and forks outlive the run; they just lose the link.
    db.write("UPDATE sweep_trials SET run_id = NULL WHERE run_id = ?", [run_id])
    db.write("DELETE FROM runs WHERE id = ?", [run_id])
    # The run's logs (its primary's, its labelled processes'), if not
    # ingested to their end yet: their later records have no run to go to (a
    # writer still appending writes to the unlinked file).
    wals = data_dir.root / "wals"
    (wals / f"{run_id}.wal.jsonl").unlink(missing_ok=True)
    for path in wals.glob(f"{run_id}~*.wal.jsonl"):
        path.unlink(missing_ok=True)
    db.write("DELETE FROM wal_progress WHERE run_id = ?", [run_id])
    for d in (data_dir.logs_dir / run_id, data_dir.sources_dir / run_id):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
