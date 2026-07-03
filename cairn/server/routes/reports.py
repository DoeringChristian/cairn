"""Server-side report persistence — CRUD for wandb-style report documents.

Mirrors routes/comparisons.py conventions (plain-dict responses, Pydantic
request bodies only, secrets.token_hex(8) ids) with two deliberate
improvements over that module:

* GET list is paginated (limit/offset bounded, like runs.py) instead of
  returning the whole project's reports unbounded.
* DELETE 404s when the report doesn't exist instead of silently no-oping.
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from .. import auth
from ._common import get_db, utc_now

router = APIRouter(prefix="/api", tags=["reports"])
_write = Depends(auth.require_role("write"))


class ReportCreate(BaseModel):
    name: str
    payload: dict[str, Any]


class ReportUpdate(BaseModel):
    name: str | None = None
    payload: dict[str, Any] | None = None


def _parse_payload(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


@router.get("/projects/{project_id}/reports")
def list_reports(
    project_id: str,
    request: Request,
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        """SELECT id, name, created_at, updated_at, payload
           FROM reports WHERE project_id = ?
           ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
        [project_id, limit, offset],
    )
    (total,) = db.read_one(
        "SELECT COUNT(*) FROM reports WHERE project_id = ?", [project_id]
    ) or (0,)
    result = []
    for r in rows:
        payload = _parse_payload(r["payload"])
        result.append({
            "id": r["id"],
            "name": r["name"],
            "updated_at": r["updated_at"],
            "block_count": len(payload.get("blocks", [])),
        })
    return {"reports": result, "total": total, "limit": limit, "offset": offset}


@router.get("/projects/{project_id}/reports/{report_id}")
def get_report(project_id: str, report_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT * FROM reports WHERE id = ? AND project_id = ?",
        [report_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="report not found")
    r = rows[0]
    return {
        "id": r["id"],
        "project_id": r["project_id"],
        "name": r["name"],
        "created_at": r["created_at"],
        "updated_at": r["updated_at"],
        "payload": _parse_payload(r["payload"]),
    }


@router.post("/projects/{project_id}/reports", dependencies=[_write])
def create_report(project_id: str, body: ReportCreate, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rid = secrets.token_hex(8)
    now = utc_now().isoformat()
    db.write(
        """INSERT INTO reports (id, project_id, name, created_at, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [rid, project_id, body.name, now, now, json.dumps(body.payload)],
    )
    return {"id": rid, "name": body.name, "created_at": now}


@router.put("/projects/{project_id}/reports/{report_id}", dependencies=[_write])
def update_report(
    project_id: str, report_id: str, body: ReportUpdate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT id FROM reports WHERE id = ? AND project_id = ?",
        [report_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="report not found")

    now = utc_now().isoformat()
    if body.name is not None:
        db.write(
            "UPDATE reports SET name = ?, updated_at = ? WHERE id = ?",
            [body.name, now, report_id],
        )
    if body.payload is not None:
        db.write(
            "UPDATE reports SET payload = ?, updated_at = ? WHERE id = ?",
            [json.dumps(body.payload), now, report_id],
        )
    return {"id": report_id, "updated_at": now}


@router.delete("/projects/{project_id}/reports/{report_id}", dependencies=[_write])
def delete_report(project_id: str, report_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT id FROM reports WHERE id = ? AND project_id = ?",
        [report_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="report not found")
    db.write(
        "DELETE FROM reports WHERE id = ? AND project_id = ?",
        [report_id, project_id],
    )
    return {"deleted": report_id}
