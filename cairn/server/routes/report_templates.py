"""Server-side report-template persistence — CRUD, mirrors comparison_templates.py.

Report templates carry the same "unbound cards" payload shape as comparison
templates (multi-run cards keyed by type, series cards by metricName +
settings) — see lib/reports/templates.ts on the client, which reuses the
`ComparisonTemplateCard` shape and matching helpers from
lib/comparisons/apply-template.ts rather than duplicating them. DELETE 404s
when the template doesn't exist, matching comparison_templates.py's fix over
comparisons.py's silent no-op.
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import auth
from ._common import get_db, utc_now

router = APIRouter(prefix="/api", tags=["report-templates"])
_write = Depends(auth.require_role("write"))


class ReportTemplateCreate(BaseModel):
    name: str
    payload: dict[str, Any]


class ReportTemplateUpdate(BaseModel):
    name: str | None = None
    payload: dict[str, Any] | None = None


@router.get("/projects/{project_id}/report-templates")
def list_report_templates(project_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        """SELECT id, name, created_at, updated_at, payload
           FROM report_templates WHERE project_id = ?
           ORDER BY updated_at DESC""",
        [project_id],
    )
    result = []
    for r in rows:
        payload = {}
        try:
            payload = json.loads(r["payload"])
        except (json.JSONDecodeError, TypeError):
            pass
        result.append({
            "id": r["id"],
            "name": r["name"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "card_count": len(payload.get("cards", [])),
        })
    return {"report_templates": result}


@router.get("/projects/{project_id}/report-templates/{template_id}")
def get_report_template(project_id: str, template_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT * FROM report_templates WHERE id = ? AND project_id = ?",
        [template_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="report template not found")
    r = rows[0]
    payload = {}
    try:
        payload = json.loads(r["payload"])
    except (json.JSONDecodeError, TypeError):
        pass
    return {
        "id": r["id"],
        "project_id": r["project_id"],
        "name": r["name"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "payload": payload,
    }


@router.post("/projects/{project_id}/report-templates", dependencies=[_write])
def create_report_template(
    project_id: str, body: ReportTemplateCreate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    tid = secrets.token_hex(8)
    now = utc_now().isoformat()
    db.write(
        """INSERT INTO report_templates (id, project_id, name, created_at, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [tid, project_id, body.name, now, now, json.dumps(body.payload)],
    )
    return {"id": tid, "name": body.name, "created_at": now}


@router.put("/projects/{project_id}/report-templates/{template_id}", dependencies=[_write])
def update_report_template(
    project_id: str, template_id: str, body: ReportTemplateUpdate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT id FROM report_templates WHERE id = ? AND project_id = ?",
        [template_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="report template not found")

    now = utc_now().isoformat()
    if body.name is not None:
        db.write(
            "UPDATE report_templates SET name = ?, updated_at = ? WHERE id = ?",
            [body.name, now, template_id],
        )
    if body.payload is not None:
        db.write(
            "UPDATE report_templates SET payload = ?, updated_at = ? WHERE id = ?",
            [json.dumps(body.payload), now, template_id],
        )
    return {"id": template_id, "updated_at": now}


@router.delete("/projects/{project_id}/report-templates/{template_id}", dependencies=[_write])
def delete_report_template(project_id: str, template_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT id FROM report_templates WHERE id = ? AND project_id = ?",
        [template_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="report template not found")
    db.write(
        "DELETE FROM report_templates WHERE id = ? AND project_id = ?",
        [template_id, project_id],
    )
    return {"deleted": template_id}
