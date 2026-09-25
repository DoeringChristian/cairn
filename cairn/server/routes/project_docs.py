"""A project's shared UI documents: the workspace and saved views.

Both live in ``project_docs`` and carry a ``rev`` that every write bumps. A
write names the revision it was based on (``base_rev``); when another tab or
user wrote in between, the server refuses with 409 and returns its own
document so the client can rebase and retry. The workspace is one row per
project (created by its first PUT, with ``base_rev`` 0); views are a plain
collection.
"""

from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import auth
from ..storage.db import Database
from ._common import get_db, utc_now

router = APIRouter(prefix="/api", tags=["project-docs"])
_write = Depends(auth.require_role("write"))


class WorkspacePut(BaseModel):
    base_rev: int
    payload: dict[str, Any]


class ViewCreate(BaseModel):
    name: str
    payload: dict[str, Any]


class ViewUpdate(BaseModel):
    name: str | None = None
    payload: dict[str, Any] | None = None
    # When given, the update is refused with 409 unless it matches the
    # view's current rev.
    base_rev: int | None = None


def _require_project(db: Database, project_id: str) -> None:
    if db.read_one("SELECT 1 FROM projects WHERE id = ?", [project_id]) is None:
        raise HTTPException(status_code=404, detail=f"project {project_id} not found")


def _parse(raw: str) -> dict[str, Any]:
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}


def _doc(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "name": row["name"],
        "rev": row["rev"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "payload": _parse(row["payload"]),
    }


def _conflict(row: dict[str, Any]) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={
            "detail": "stale base_rev",
            "rev": row["rev"],
            "updated_at": row["updated_at"],
            "payload": _parse(row["payload"]),
        },
    )


_DOC_COLUMNS = "id, project_id, name, rev, created_at, updated_at, payload"


# ── Workspace ─────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/workspace")
def get_workspace(project_id: str, request: Request) -> dict[str, Any]:
    """The project's workspace; ``rev`` 0 and a null payload before its first save."""
    db = get_db(request)
    _require_project(db, project_id)
    rows = db.read_columns(
        f"SELECT {_DOC_COLUMNS} FROM project_docs "
        "WHERE project_id = ? AND kind = 'workspace'",
        [project_id],
    )
    if not rows:
        return {"rev": 0, "updated_at": None, "payload": None}
    r = rows[0]
    return {"rev": r["rev"], "updated_at": r["updated_at"], "payload": _parse(r["payload"])}


@router.put("/projects/{project_id}/workspace", dependencies=[_write], response_model=None)
def put_workspace(
    project_id: str, body: WorkspacePut, request: Request,
) -> dict[str, Any] | JSONResponse:
    db = get_db(request)
    _require_project(db, project_id)
    now = utc_now().isoformat()
    payload = json.dumps(body.payload)
    with db.transaction(immediate=True) as con:
        cur = con.execute(
            f"SELECT {_DOC_COLUMNS} FROM project_docs "
            "WHERE project_id = ? AND kind = 'workspace'",
            [project_id],
        )
        cols = [d[0] for d in cur.description]
        found = cur.fetchone()
        row = dict(zip(cols, found)) if found else None
        current = row["rev"] if row else 0
        if body.base_rev != current:
            if row is None:
                return JSONResponse(
                    status_code=409,
                    content={"detail": "stale base_rev", "rev": 0,
                             "updated_at": None, "payload": None},
                )
            return _conflict(row)
        rev = current + 1
        if row is None:
            con.execute(
                """INSERT INTO project_docs
                       (id, project_id, kind, name, rev, created_at, updated_at, payload)
                   VALUES (?, ?, 'workspace', '', ?, ?, ?, ?)""",
                [secrets.token_hex(8), project_id, rev, now, now, payload],
            )
        else:
            con.execute(
                "UPDATE project_docs SET rev = ?, updated_at = ?, payload = ? WHERE id = ?",
                [rev, now, payload, row["id"]],
            )
    return {"rev": rev, "updated_at": now}


# ── Saved views ───────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/views")
def list_views(project_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    _require_project(db, project_id)
    rows = db.read_columns(
        """SELECT id, name, rev, created_at, updated_at FROM project_docs
           WHERE project_id = ? AND kind = 'view' ORDER BY updated_at DESC""",
        [project_id],
    )
    return {"views": rows}


def _get_view_row(db: Database, project_id: str, view_id: str) -> dict[str, Any]:
    rows = db.read_columns(
        f"SELECT {_DOC_COLUMNS} FROM project_docs "
        "WHERE id = ? AND project_id = ? AND kind = 'view'",
        [view_id, project_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="view not found")
    return rows[0]


@router.get("/projects/{project_id}/views/{view_id}")
def get_view(project_id: str, view_id: str, request: Request) -> dict[str, Any]:
    return _doc(_get_view_row(get_db(request), project_id, view_id))


@router.post("/projects/{project_id}/views", dependencies=[_write])
def create_view(project_id: str, body: ViewCreate, request: Request) -> dict[str, Any]:
    db = get_db(request)
    _require_project(db, project_id)
    vid = secrets.token_hex(8)
    now = utc_now().isoformat()
    db.write(
        """INSERT INTO project_docs
               (id, project_id, kind, name, rev, created_at, updated_at, payload)
           VALUES (?, ?, 'view', ?, 1, ?, ?, ?)""",
        [vid, project_id, body.name, now, now, json.dumps(body.payload)],
    )
    return {"id": vid, "name": body.name, "rev": 1, "created_at": now}


@router.put("/projects/{project_id}/views/{view_id}", dependencies=[_write], response_model=None)
def update_view(
    project_id: str, view_id: str, body: ViewUpdate, request: Request,
) -> dict[str, Any] | JSONResponse:
    db = get_db(request)
    now = utc_now().isoformat()
    with db.transaction(immediate=True) as con:
        cur = con.execute(
            f"SELECT {_DOC_COLUMNS} FROM project_docs "
            "WHERE id = ? AND project_id = ? AND kind = 'view'",
            [view_id, project_id],
        )
        cols = [d[0] for d in cur.description]
        found = cur.fetchone()
        if found is None:
            raise HTTPException(status_code=404, detail="view not found")
        row = dict(zip(cols, found))
        if body.base_rev is not None and body.base_rev != row["rev"]:
            return _conflict(row)
        rev = row["rev"] + 1
        con.execute(
            """UPDATE project_docs SET name = ?, payload = ?, rev = ?, updated_at = ?
               WHERE id = ?""",
            [
                body.name if body.name is not None else row["name"],
                json.dumps(body.payload) if body.payload is not None else row["payload"],
                rev, now, view_id,
            ],
        )
    return {"id": view_id, "rev": rev, "updated_at": now}


@router.delete("/projects/{project_id}/views/{view_id}", dependencies=[_write])
def delete_view(project_id: str, view_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    _get_view_row(db, project_id, view_id)
    db.write(
        "DELETE FROM project_docs WHERE id = ? AND project_id = ? AND kind = 'view'",
        [view_id, project_id],
    )
    return {"deleted": view_id}
