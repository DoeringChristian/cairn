"""Server-side comparison persistence — CRUD for saved comparisons."""

from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ._common import get_db, utc_now

router = APIRouter(prefix="/api", tags=["comparisons"])


class ComparisonCreate(BaseModel):
    name: str
    payload: dict[str, Any]


class ComparisonUpdate(BaseModel):
    name: str | None = None
    payload: dict[str, Any] | None = None


@router.get("/projects/{project_id}/comparisons")
def list_comparisons(project_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        """SELECT id, name, created_at, updated_at, payload
           FROM comparisons WHERE project_id = ?
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
    return {"comparisons": result}


@router.get("/projects/{project_id}/comparisons/{comparison_id}")
def get_comparison(project_id: str, comparison_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT * FROM comparisons WHERE id = ? AND project_id = ?",
        [comparison_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="comparison not found")
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


@router.post("/projects/{project_id}/comparisons")
def create_comparison(project_id: str, body: ComparisonCreate, request: Request) -> dict[str, Any]:
    db = get_db(request)
    cid = secrets.token_hex(8)
    now = utc_now().isoformat()
    db.write(
        """INSERT INTO comparisons (id, project_id, name, created_at, updated_at, payload)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [cid, project_id, body.name, now, now, json.dumps(body.payload)],
    )
    return {"id": cid, "name": body.name, "created_at": now}


@router.put("/projects/{project_id}/comparisons/{comparison_id}")
def update_comparison(
    project_id: str, comparison_id: str, body: ComparisonUpdate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    rows = db.read_columns(
        "SELECT id FROM comparisons WHERE id = ? AND project_id = ?",
        [comparison_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="comparison not found")

    now = utc_now().isoformat()
    if body.name is not None:
        db.write(
            "UPDATE comparisons SET name = ?, updated_at = ? WHERE id = ?",
            [body.name, now, comparison_id],
        )
    if body.payload is not None:
        db.write(
            "UPDATE comparisons SET payload = ?, updated_at = ? WHERE id = ?",
            [json.dumps(body.payload), now, comparison_id],
        )
    return {"id": comparison_id, "updated_at": now}


@router.delete("/projects/{project_id}/comparisons/{comparison_id}")
def delete_comparison(project_id: str, comparison_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    db.write(
        "DELETE FROM comparisons WHERE id = ? AND project_id = ?",
        [comparison_id, project_id],
    )
    return {"deleted": comparison_id}
