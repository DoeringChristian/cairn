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
    run = _require_run(db, run_id)
    db.write(
        "UPDATE runs SET status = ?, ended_at = ?, exit_code = ? WHERE id = ?",
        [status, parse_timestamp(ended_at) or utc_now(), exit_code, run_id],
    )
    # Alert only on a real transition, so a WAL replayed a second time (or a
    # repeated finish) doesn't alert twice.
    if run["status"] == "running" and status in _ALERT_ON_STATUS:
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


KEY_TABLES = ("params", "summary")


def delete_keys(db: Database, run_id: str, table: str, keys: list[str]) -> None:
    """Delete config (``params``) or summary keys. Keys are the flattened
    dotted keys, and a key also removes the keys nested under it
    (``hparams`` takes ``hparams.lr`` with it), since a nested mapping was
    written as exactly those keys."""
    if table not in KEY_TABLES:
        raise ValueError(f"table must be one of {KEY_TABLES}, got {table!r}")
    _require_run(db, run_id)
    with db.transaction() as con:
        for key in keys:
            con.execute(
                f"DELETE FROM {table} WHERE run_id = ? AND (key = ? OR substr(key, 1, ?) = ?)",
                [run_id, key, len(key) + 1, key + "."],
            )


def heartbeat(db: Database, run_id: str) -> str | None:
    """Update the heartbeat timestamp for a running run; return its
    ``stop_requested`` timestamp (None unless someone asked it to stop)."""
    with db.transaction() as con:
        row = con.execute(
            "UPDATE runs SET last_heartbeat = ? WHERE id = ? AND status = 'running' "
            "RETURNING stop_requested",
            [utc_now().isoformat(), run_id],
        ).fetchone()
    return row[0] if row else None


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
