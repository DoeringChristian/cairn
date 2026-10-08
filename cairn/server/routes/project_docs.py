"""A project's shared UI documents: its workspace views.

All live in ``project_docs`` and carry a ``rev`` that every write bumps. A
write names the revision it was based on (``base_rev``); when another tab or
user wrote in between, the server refuses with 409 and returns its own
document so the client can rebase and retry.

* A **view** is one named workspace layout. The run page always shows one of
  them, the project's *current view* (``project_view_state``: the same on
  every browser). A project always has at least one view: until one is
  stored, the list holds a virtual "Default" (``rev`` 0, null payload) under
  a fixed id, which the first write to it (or any other view write) stores,
  so reading never writes. The last view cannot be deleted.
  A view's payload is the UI's workspace document: its layout and the
  workspace page's run state (search, grouping, eyes, version picks).

The server does not interpret payloads.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
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


class ViewRename(BaseModel):
    name: str


class CurrentViewPut(BaseModel):
    view_id: str


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
            "payload": _parse(row["payload"]) if row["payload"] is not None else None,
        },
    )


def _rows(con: sqlite3.Connection, sql: str, params: list[Any]) -> list[dict[str, Any]]:
    cur = con.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


_DOC_COLUMNS = "id, project_id, name, rev, created_at, updated_at, payload"


# ── Views ─────────────────────────────────────────────────────────────────

DEFAULT_VIEW_NAME = "Default"
_LAST_VIEW = {"detail": "a project keeps at least one view"}

_VIEWS_SQL = (
    f"SELECT {_DOC_COLUMNS} FROM project_docs "
    "WHERE project_id = ? AND kind = 'view' ORDER BY created_at, rowid"
)
_VIEW_SQL = (
    f"SELECT {_DOC_COLUMNS} FROM project_docs "
    "WHERE id = ? AND project_id = ? AND kind = 'view'"
)


def default_view_id(project_id: str) -> str:
    """The fixed id of a project's first view (stored or still virtual)."""
    return "d" + hashlib.sha256(project_id.encode()).hexdigest()[:15]


def _virtual_default(project_id: str) -> dict[str, Any]:
    return {
        "id": default_view_id(project_id),
        "project_id": project_id,
        "name": DEFAULT_VIEW_NAME,
        "rev": 0,
        "created_at": None,
        "updated_at": None,
        "payload": None,
    }


def _view_list(project_id: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The views oldest first; the virtual "Default" when none is stored."""
    return [_doc(r) for r in rows] if rows else [_virtual_default(project_id)]


def _current_of(view_ids: list[str], stored: str | None) -> str:
    """The stored current view, else (unset or deleted) the first view."""
    return stored if stored in view_ids else view_ids[0]


def _stored_current(con: sqlite3.Connection, project_id: str) -> str | None:
    row = con.execute(
        "SELECT view_id FROM project_view_state WHERE project_id = ?", [project_id],
    ).fetchone()
    return row[0] if row else None


def _set_current(con: sqlite3.Connection, project_id: str, view_id: str) -> None:
    con.execute(
        "INSERT INTO project_view_state (project_id, view_id) VALUES (?, ?) "
        "ON CONFLICT(project_id) DO UPDATE SET view_id = excluded.view_id",
        [project_id, view_id],
    )


def _store_default(con: sqlite3.Connection, project_id: str, now: str) -> None:
    """Store the virtual "Default" (an empty layout) when the project has no view yet."""
    if _rows(con, _VIEWS_SQL, [project_id]):
        return
    con.execute(
        """INSERT INTO project_docs
               (id, project_id, kind, name, rev, created_at, updated_at, payload)
           VALUES (?, ?, 'view', ?, 1, ?, ?, '{}')""",
        [default_view_id(project_id), project_id, DEFAULT_VIEW_NAME, now, now],
    )


def _view_row(con: sqlite3.Connection, project_id: str, view_id: str) -> dict[str, Any]:
    rows = _rows(con, _VIEW_SQL, [view_id, project_id])
    if not rows:
        raise HTTPException(status_code=404, detail="view not found")
    return rows[0]


@router.get("/projects/{project_id}/views")
def list_views(project_id: str, request: Request) -> dict[str, Any]:
    """Every view with its layout, oldest first, and the current view's id."""
    db = get_db(request)
    _require_project(db, project_id)
    views = _view_list(project_id, db.read_columns(_VIEWS_SQL, [project_id]))
    stored = db.read_one(
        "SELECT view_id FROM project_view_state WHERE project_id = ?", [project_id],
    )
    return {"views": views, "current": _current_of([v["id"] for v in views], stored[0] if stored else None)}


@router.get("/projects/{project_id}/views/{view_id}")
def get_view(project_id: str, view_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    _require_project(db, project_id)
    for v in _view_list(project_id, db.read_columns(_VIEWS_SQL, [project_id])):
        if v["id"] == view_id:
            return v
    raise HTTPException(status_code=404, detail="view not found")


@router.post("/projects/{project_id}/views", dependencies=[_write])
def create_view(project_id: str, body: ViewCreate, request: Request) -> dict[str, Any]:
    """A new view, last in the list (the virtual "Default" is stored first)."""
    db = get_db(request)
    _require_project(db, project_id)
    vid = secrets.token_hex(8)
    now = utc_now().isoformat()
    with db.transaction(immediate=True) as con:
        _store_default(con, project_id, now)
        con.execute(
            """INSERT INTO project_docs
                   (id, project_id, kind, name, rev, created_at, updated_at, payload)
               VALUES (?, ?, 'view', ?, 1, ?, ?, ?)""",
            [vid, project_id, body.name, now, now, json.dumps(body.payload)],
        )
    return {"id": vid, "name": body.name, "rev": 1, "created_at": now}


@router.put("/projects/{project_id}/views/{view_id}", dependencies=[_write], response_model=None)
def put_view(
    project_id: str, view_id: str, body: WorkspacePut, request: Request,
) -> dict[str, Any] | JSONResponse:
    """Write a view's layout against ``base_rev`` (409 + server doc when stale)."""
    db = get_db(request)
    _require_project(db, project_id)
    now = utc_now().isoformat()
    payload = json.dumps(body.payload)
    with db.transaction(immediate=True) as con:
        rows = _rows(con, _VIEW_SQL, [view_id, project_id])
        if not rows:
            if view_id != default_view_id(project_id) or _rows(con, _VIEWS_SQL, [project_id]):
                raise HTTPException(status_code=404, detail="view not found")
            # The virtual "Default" (rev 0): this write stores it.
            if body.base_rev != 0:
                return _conflict({"rev": 0, "updated_at": None, "payload": None})
            con.execute(
                """INSERT INTO project_docs
                       (id, project_id, kind, name, rev, created_at, updated_at, payload)
                   VALUES (?, ?, 'view', ?, 1, ?, ?, ?)""",
                [view_id, project_id, DEFAULT_VIEW_NAME, now, now, payload],
            )
            return {"rev": 1, "updated_at": now}
        row = rows[0]
        if body.base_rev != row["rev"]:
            return _conflict(row)
        rev = row["rev"] + 1
        con.execute(
            "UPDATE project_docs SET rev = ?, updated_at = ?, payload = ? WHERE id = ?",
            [rev, now, payload, view_id],
        )
    return {"rev": rev, "updated_at": now}


@router.patch("/projects/{project_id}/views/{view_id}", dependencies=[_write])
def rename_view(project_id: str, view_id: str, body: ViewRename, request: Request) -> dict[str, Any]:
    """Rename; the layout (and its rev) is untouched."""
    db = get_db(request)
    _require_project(db, project_id)
    with db.transaction(immediate=True) as con:
        if view_id == default_view_id(project_id):
            _store_default(con, project_id, utc_now().isoformat())
        _view_row(con, project_id, view_id)
        con.execute("UPDATE project_docs SET name = ? WHERE id = ?", [body.name, view_id])
    return {"id": view_id, "name": body.name}


@router.delete("/projects/{project_id}/views/{view_id}", dependencies=[_write], response_model=None)
def delete_view(project_id: str, view_id: str, request: Request) -> dict[str, Any] | JSONResponse:
    """Delete a view. The last one is refused (409); deleting the current
    view makes the first remaining one current."""
    db = get_db(request)
    _require_project(db, project_id)
    with db.transaction(immediate=True) as con:
        ids = [v["id"] for v in _view_list(project_id, _rows(con, _VIEWS_SQL, [project_id]))]
        if view_id not in ids:
            raise HTTPException(status_code=404, detail="view not found")
        if len(ids) == 1:
            return JSONResponse(status_code=409, content=_LAST_VIEW)
        if _current_of(ids, _stored_current(con, project_id)) == view_id:
            _set_current(con, project_id, next(i for i in ids if i != view_id))
        con.execute("DELETE FROM project_docs WHERE id = ?", [view_id])
    return {"deleted": view_id}


@router.get("/projects/{project_id}/current-view")
def get_current_view(project_id: str, request: Request) -> dict[str, Any]:
    """The run page's view (the same on every browser)."""
    return {"view_id": list_views(project_id, request)["current"]}


@router.put("/projects/{project_id}/current-view", dependencies=[_write])
def put_current_view(project_id: str, body: CurrentViewPut, request: Request) -> dict[str, Any]:
    db = get_db(request)
    _require_project(db, project_id)
    with db.transaction(immediate=True) as con:
        ids = [v["id"] for v in _view_list(project_id, _rows(con, _VIEWS_SQL, [project_id]))]
        if body.view_id not in ids:
            raise HTTPException(status_code=404, detail="view not found")
        _set_current(con, project_id, body.view_id)
    return {"view_id": body.view_id}
