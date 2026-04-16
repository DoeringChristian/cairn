"""Paginated log-line reads."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request

from ._common import get_db, require_run

router = APIRouter(prefix="/api", tags=["logs"])


@router.get("/runs/{run_id}/logs")
def list_logs(
    run_id: str,
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=10_000),
    stream: str | None = Query(default=None),
    since: str | None = Query(default=None),
    search: str | None = Query(default=None),
) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    clauses = ["run_id = ?"]
    params: list[Any] = [run_id]
    if stream:
        clauses.append("stream = ?")
        params.append(stream)
    if since:
        clauses.append("wall_time >= ?")
        params.append(since)
    if search:
        clauses.append("content LIKE ?")
        params.append(f"%{search}%")
    where = " AND ".join(clauses)
    rows = db.read_columns(
        f"""
        SELECT stream, wall_time, line_no, content
        FROM log_lines WHERE {where}
        ORDER BY wall_time, line_no
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    )
    (total,) = db.read_one(
        f"SELECT COUNT(*) FROM log_lines WHERE {where}", params
    ) or (0,)
    return {"lines": rows, "total": total, "offset": offset, "limit": limit}
