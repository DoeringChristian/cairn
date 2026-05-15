"""Runs list + detail read endpoints."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query, Request

from ._common import get_data_dir, get_db, require_run

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["runs"])

# Runs with status "running" and no heartbeat for this many seconds
# are auto-transitioned to "killed" at query time.
STALE_HEARTBEAT_SECONDS = 120


def _reap_stale_runs(db: Any, data_dir: Any = None) -> None:
    """Mark running runs as killed if their heartbeat is too old.

    Also removes stale WAL lock files so the ingestion thread can
    do a full ingest and rename the WAL to .done.
    """
    cutoff = datetime.now(timezone.utc).isoformat()
    stale = db.read_columns(
        """SELECT id FROM runs
           WHERE status = 'running'
             AND (
               (last_heartbeat IS NOT NULL
                AND julianday('now') - julianday(last_heartbeat) > ?/86400.0)
               OR
               (last_heartbeat IS NULL
                AND julianday('now') - julianday(created_at) > ?/86400.0)
             )""",
        [STALE_HEARTBEAT_SECONDS, STALE_HEARTBEAT_SECONDS],
    )
    if stale:
        for row in stale:
            run_id = row["id"]
            db.write(
                "UPDATE runs SET status = 'killed', ended_at = ? WHERE id = ?",
                [cutoff, run_id],
            )
            # Remove stale WAL lock file so ingestion can finalize.
            if data_dir is not None:
                lock_path = data_dir.root / "wals" / f"{run_id}.lock"
                if lock_path.exists():
                    lock_path.unlink(missing_ok=True)
                    _log.info("removed stale WAL lock for killed run %s", run_id[:8])


@router.get("/runs")
def list_runs(
    request: Request,
    project: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)

    # Auto-kill stale "running" runs before listing.
    _reap_stale_runs(db, dd)

    clauses: list[str] = []
    params: list[Any] = []
    if project:
        clauses.append("project_id = ?")
        params.append(project)
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    # Exclude env_snapshot from list responses — it's large and only needed
    # on the run detail page.  SELECT * would include it for every row.
    rows = db.read_columns(
        f"""SELECT id, project_id, display_name, created_at, ended_at, status,
                   exit_code, git_sha, git_dirty, git_branch, cli_args,
                   hostname, "user", tags, notes, last_heartbeat
            FROM runs {where} ORDER BY created_at DESC LIMIT ? OFFSET ?""",
        [*params, limit, offset],
    )
    (total,) = db.read_one(f"SELECT COUNT(*) FROM runs {where}", params) or (0,)
    return {"runs": rows, "total": total, "limit": limit, "offset": offset}


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    run = require_run(db, run_id)
    params = db.read_columns(
        "SELECT key, value, value_type FROM params WHERE run_id = ? ORDER BY key",
        [run_id],
    )
    return {"run": run, "params": params}
