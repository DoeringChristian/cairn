"""Runs list + detail read endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Request

from ._common import get_db, require_run

router = APIRouter(prefix="/api", tags=["runs"])


@router.get("/runs")
def list_runs(
    request: Request,
    project: str | None = Query(default=None),
    task: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = get_db(request)
    clauses: list[str] = []
    params: list[Any] = []
    if project:
        clauses.append("project_id = ?")
        params.append(project)
    if task:
        # task may be the full id (project/slug) or just the slug. Be permissive.
        clauses.append("(task_id = ? OR task_id LIKE ?)")
        params.append(task)
        params.append(f"%/{task}")
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
