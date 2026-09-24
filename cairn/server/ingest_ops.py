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

from .routes._common import flatten, parse_timestamp, slugify, utc_now, value_type
from .storage.blobs import BlobStore
from .storage.datadir import DataDir
from .storage.db import Database
from .storage.migrations import hash_context


class RunNotFound(LookupError):
    """Raised when an operation targets a run id that doesn't exist."""


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
    """
    project_id = slugify(project)
    if not run_id:
        run_id = secrets.token_hex(16)
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


def _upsert_flat_values(
    db: Database, table: str, run_id: str, values: dict[str, Any]
) -> int:
    """Flatten a mapping to dotted keys and upsert it into a key/value table.

    ``params`` and ``summary`` are the same shape carrying different meanings —
    inputs versus declared results — so the write is implemented once. ``table``
    is never caller-supplied; both call sites pass a literal.
    """
    _require_run(db, run_id)
    flat = flatten(values)
    rows = [(run_id, k, json.dumps(v), value_type(v)) for k, v in flat.items()]
    with db.transaction() as con:
        for row in rows:
            con.execute(
                f"""
                INSERT INTO {table} (run_id, key, value, value_type)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (run_id, key) DO UPDATE
                  SET value = EXCLUDED.value, value_type = EXCLUDED.value_type
                """,
                list(row),
            )
    return len(rows)


def set_params(db: Database, run_id: str, params: dict[str, Any]) -> int:
    """Run inputs: hyperparameters, argv, anything decided before the work."""
    return _upsert_flat_values(db, "params", run_id, params)


def set_summary(db: Database, run_id: str, summary: dict[str, Any]) -> int:
    """Run results the author DECLARED.

    Nothing writes here implicitly. A metric's last value is not a summary
    entry; the run table resolves that at read time, preferring an explicit
    summary key over the last point of the series with the same name. Keeping
    the write explicit is what makes "who claimed this number" answerable.
    """
    return _upsert_flat_values(db, "summary", run_id, summary)


def insert_batch(
    db: Database, run_id: str, points: list[dict[str, Any]]
) -> int:
    _require_run(db, run_id)
    rows = []
    for p in points:
        ctx = p.get("context")
        ctx_json = json.dumps(ctx) if ctx is not None else None
        rows.append(
            (
                run_id,
                p["name"],
                p["step"],
                p["wall_time"],
                ctx_json,
                hash_context(ctx),
                p["object_type"],
                p.get("scalar_value"),
                p.get("artifact_hash"),
                json.dumps(p["metadata"]) if p.get("metadata") is not None else None,
            )
        )
    db.executemany(
        """
        INSERT OR IGNORE INTO sequences (
            run_id, name, step, wall_time, context, context_hash,
            object_type, scalar_value, artifact_hash, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


def insert_logs(
    db: Database,
    data_dir: DataDir,
    run_id: str,
    lines: list[dict[str, Any]],
) -> int:
    _require_run(db, run_id)
    rows = [
        (run_id, line["stream"], line["wall_time"], line["line_no"], line["content"])
        for line in lines
    ]
    db.executemany("INSERT OR IGNORE INTO log_lines VALUES (?, ?, ?, ?, ?)", rows)
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
            comb_fh.write(f"[{line['stream']}] {raw}\n")
    return len(rows)


def put_artifact(
    db: Database,
    blobs: BlobStore,
    data: bytes,
    mime_type: str,
    metadata: dict[str, Any] | None = None,
    object_type: str | None = None,
) -> dict[str, Any]:
    digest, size = blobs.put(data, mime_type, metadata or {})
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


def attach_artifact(
    db: Database,
    blobs: BlobStore,
    run_id: str,
    name: str,
    digest: str,
    step: int | None = None,
) -> None:
    _require_run(db, run_id)
    if not blobs.exists(digest):
        raise ValueError(f"artifact {digest} unknown")
    step_val = -1 if step is None else step
    db.write(
        """
        INSERT INTO run_artifacts (run_id, name, hash, step, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (run_id, name, step) DO UPDATE
          SET hash = EXCLUDED.hash, created_at = EXCLUDED.created_at
        """,
        [run_id, name, digest, step_val, utc_now()],
    )


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
    _require_run(db, run_id)
    db.write(
        "UPDATE runs SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?",
        [status, parse_timestamp(ended_at) or utc_now(), exit_code, run_id],
    )


def set_tags(db: Database, run_id: str, tags: list[str]) -> None:
    _require_run(db, run_id)
    db.write("UPDATE runs SET tags = ? WHERE id = ?", [json.dumps(tags), run_id])


def set_notes(db: Database, run_id: str, notes: str) -> None:
    _require_run(db, run_id)
    db.write("UPDATE runs SET notes = ? WHERE id = ?", [notes, run_id])


def heartbeat(db: Database, run_id: str) -> None:
    """Update the heartbeat timestamp for a running run."""
    db.write(
        "UPDATE runs SET last_heartbeat = ? WHERE id = ? AND status = 'running'",
        [utc_now().isoformat(), run_id],
    )


def define_metric(
    db: Database,
    run_id: str,
    name: str,
    step_metric: str | None = None,
    summary: str | None = None,
) -> None:
    """Record how a metric (or an fnmatch glob of metrics) is read: the
    series to plot it against, and its summary rule (see ``summary_rules``).
    A later definition of the same name replaces the earlier one."""
    from .summary_rules import SUMMARY_KINDS

    _require_run(db, run_id)
    if summary is not None and summary not in SUMMARY_KINDS:
        raise ValueError(f"summary must be one of {SUMMARY_KINDS}, got {summary!r}")
    db.write(
        """
        INSERT INTO metric_defs (run_id, name, step_metric, summary)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (run_id, name) DO UPDATE
          SET step_metric = EXCLUDED.step_metric, summary = EXCLUDED.summary
        """,
        [run_id, name, step_metric, summary],
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
    "name, step, wall_time, context, context_hash, object_type, "
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
        con.execute(
            "DELETE FROM run_artifacts WHERE run_id = ? AND step > ?", [run_id, step],
        )
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
    (see ``_HISTORY_KEEP``; run artifacts with step <= step, run-level ones
    included), its params, summary and metric definitions. ``fields`` are the
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
        for table in ("params", "summary"):
            con.execute(
                f"""INSERT OR IGNORE INTO {table} (run_id, key, value, value_type)
                    SELECT ?, key, value, value_type FROM {table} WHERE run_id = ?""",
                [run_id, parent_id],
            )
        con.execute(
            """INSERT OR IGNORE INTO metric_defs (run_id, name, step_metric, summary)
               SELECT ?, name, step_metric, summary FROM metric_defs WHERE run_id = ?""",
            [run_id, parent_id],
        )
        con.execute(
            """INSERT OR IGNORE INTO run_artifacts (run_id, name, hash, step, created_at)
               SELECT ?, name, hash, step, created_at FROM run_artifacts
                WHERE run_id = ? AND step <= ?""",
            [run_id, parent_id, step],
        )
    project_id = parent["project_id"]
    return {"run_id": run_id, "project_id": project_id, "url": f"/p/{project_id}/r/{run_id}"}


def delete_run(db: Database, data_dir: DataDir, run_id: str) -> None:
    _require_run(db, run_id)
    # FK enforcement inside an explicit transaction doesn't recognize deleted
    # child rows; run each DELETE as its own auto-committed stmt.
    db.write("DELETE FROM sequences WHERE run_id = ?", [run_id])
    db.write("DELETE FROM params WHERE run_id = ?", [run_id])
    db.write("DELETE FROM summary WHERE run_id = ?", [run_id])
    db.write("DELETE FROM run_inputs WHERE run_id = ?", [run_id])
    db.write("DELETE FROM log_lines WHERE run_id = ?", [run_id])
    db.write("DELETE FROM run_artifacts WHERE run_id = ?", [run_id])
    db.write("DELETE FROM alerts WHERE run_id = ?", [run_id])
    db.write("DELETE FROM metric_defs WHERE run_id = ?", [run_id])
    # Trials and forks outlive the run; they just lose the link.
    db.write("UPDATE sweep_trials SET run_id = NULL WHERE run_id = ?", [run_id])
    db.write("DELETE FROM runs WHERE id = ?", [run_id])
    for d in (data_dir.logs_dir / run_id, data_dir.sources_dir / run_id):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
