"""Projects read + create endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import auth
from cairn.server.routes._common import get_db
from cairn.backend.common import slugify, utc_now

router = APIRouter(prefix="/api", tags=["projects"])


@router.get("/projects")
def list_projects(request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        """
        SELECT p.id, p.name, p.created_at, p.description, p.tags,
               COALESCE(agg.run_count, 0) AS run_count,
               COALESCE(agg.active_run_count, 0) AS active_run_count,
               agg.last_run_at,
               COALESCE(reports.report_count, 0) AS report_count,
               COALESCE(artifacts.artifact_count, 0) AS artifact_count,
               reports.last_report_at, artifacts.last_artifact_at
        FROM projects p
        LEFT JOIN (
            SELECT project_id,
                   COUNT(*) AS run_count,
                   SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS active_run_count,
                   MAX(COALESCE(ended_at, created_at)) AS last_run_at
            FROM runs
            GROUP BY project_id
        ) agg ON agg.project_id = p.id
        LEFT JOIN (
            SELECT project_id, COUNT(*) AS report_count, MAX(updated_at) AS last_report_at
            FROM reports r WHERE EXISTS (SELECT 1 FROM report_publications rp WHERE rp.report_id=r.id)
            GROUP BY project_id
        ) reports ON reports.project_id = p.id
        LEFT JOIN (
            SELECT project_id, COUNT(*) AS artifact_count, MAX(updated_at) AS last_artifact_at
            FROM artifact_families WHERE type != 'report' GROUP BY project_id
        ) artifacts ON artifacts.project_id = p.id
        ORDER BY CASE WHEN agg.last_run_at IS NULL THEN 1 ELSE 0 END,
                 agg.last_run_at DESC, p.created_at DESC
        """
    )
    for row in rows:
        activity = [row['created_at'], row['last_run_at'], row.pop('last_report_at'), row.pop('last_artifact_at')]
        row['last_activity_at'] = max(value for value in activity if value)
    return {"projects": rows}


class CreateProjectRequest(BaseModel):
    name: str


@router.post("/projects", dependencies=[Depends(auth.require_auth)])
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
