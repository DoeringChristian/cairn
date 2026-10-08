"""Projects read + create endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import auth, run_groups
from ._common import get_db, slugify, utc_now

router = APIRouter(prefix="/api", tags=["projects"])


@router.get("/projects")
def list_projects(request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        """
        SELECT p.id, p.name, p.created_at, p.description, p.tags,
               COALESCE(agg.run_count, 0) AS run_count,
               COALESCE(agg.active_run_count, 0) AS active_run_count,
               agg.last_run_at
        FROM projects p
        LEFT JOIN (
            SELECT project_id,
                   COUNT(*) AS run_count,
                   SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active_run_count,
                   MAX(COALESCE(ended_at, created_at)) AS last_run_at
            FROM runs
            GROUP BY project_id
        ) agg ON agg.project_id = p.id
        ORDER BY CASE WHEN agg.last_run_at IS NULL THEN 1 ELSE 0 END,
                 agg.last_run_at DESC, p.created_at DESC
        """
    )
    return {"projects": rows}


class CreateProjectRequest(BaseModel):
    name: str


@router.post("/projects", dependencies=[Depends(auth.require_role("write"))])
def create_project(body: CreateProjectRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    project_id = slugify(body.name)
    now = utc_now().isoformat()
    existing = db.read_columns("SELECT id FROM projects WHERE id = ?", [project_id])
    if existing:
        raise HTTPException(status_code=409, detail=f"project '{project_id}' already exists")
    db.write(
        "INSERT INTO projects (id, name, created_at, description, tags) VALUES (?, ?, ?, NULL, NULL)",
        [project_id, body.name, now],
    )
    return {"id": project_id, "name": body.name, "created_at": now}


@router.get("/projects/{project_id}")
def get_project(project_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT * FROM projects WHERE id = ?", [project_id]
    )
    if not rows:
        raise HTTPException(status_code=404, detail="project not found")
    return rows[0]


def _require_project(db: Any, project_id: str) -> None:
    if not db.read_columns("SELECT 1 FROM projects WHERE id = ?", [project_id]):
        raise HTTPException(status_code=404, detail="project not found")


@router.get("/projects/{project_id}/groups")
def list_groups(project_id: str, request: Request) -> dict[str, Any]:
    """``{groups: [{group, run_count, last_activity}]}``: the project's run
    groups over its non-archived runs, most recently active first."""
    db = get_db(request)
    _require_project(db, project_id)
    return {"groups": run_groups.list_groups(db, project_id)}


@router.get("/projects/{project_id}/groups/{group:path}/graph")
def group_graph(project_id: str, group: str, request: Request) -> dict[str, Any]:
    """``{group, runs, edges}``: one group's runs and the lineage among them
    (shapes: ``run_groups.group_graph``). An unknown group has no runs."""
    db = get_db(request)
    _require_project(db, project_id)
    return run_groups.group_graph(db, project_id, group)
