"""Projects read endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from ._common import get_db

router = APIRouter(prefix="/api", tags=["projects"])


@router.get("/projects")
def list_projects(request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        """
        SELECT p.id, p.name, p.created_at, p.description, p.tags,
               (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS run_count,
               (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id
                                               AND r.status = 'running')
                   AS active_run_count,
               (SELECT MAX(COALESCE(r.ended_at, r.created_at)) FROM runs r
                  WHERE r.project_id = p.id) AS last_run_at
        FROM projects p
        ORDER BY CASE WHEN last_run_at IS NULL THEN 1 ELSE 0 END,
                 last_run_at DESC, p.created_at DESC
        """
    )
    return {"projects": rows}


@router.get("/projects/{project_id}")
def get_project(project_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT * FROM projects WHERE id = ?", [project_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="project not found")
    return rows[0]
