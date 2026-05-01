"""Runs list + detail read endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query, Request

from ._common import get_db, require_run

router = APIRouter(prefix="/api", tags=["runs"])

# Runs with status "running" and no heartbeat for this many seconds
# are auto-transitioned to "killed" at query time.
STALE_HEARTBEAT_SECONDS = 120


def _reap_stale_runs(db: Any) -> None:
    """Mark running runs as killed if their heartbeat is too old."""
    cutoff = datetime.now(timezone.utc).isoformat()
    # Find running runs whose last_heartbeat is older than the threshold.
    # Also catch runs with NULL heartbeat that were created > threshold ago
    # (pre-heartbeat runs or runs that never sent a heartbeat).
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
            db.write(
                "UPDATE runs SET status = 'killed', ended_at = ? WHERE id = ?",
                [cutoff, row["id"]],
            )


@router.get("/runs")
def list_runs(
    request: Request,
    project: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = get_db(request)

    # Auto-kill stale "running" runs before listing.
    _reap_stale_runs(db)

    clauses: list[str] = []
    params: list[Any] = []
    if project:
        clauses.append("project_id = ?")
        params.append(project)
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.read_columns(
        f"SELECT * FROM runs {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
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
