"""Comment threads on a report.

A thread's first comment carries the anchor: the whole ``report``, one
``block`` or ``card`` (``anchor_id``), or a ``quote`` of text inside a block
(``anchor_id`` plus the quoted text). Replies name the thread root as
``parent_id`` and inherit its anchor; threads are one level deep. Any writer
may comment and resolve a thread; only a comment's author or an admin may
edit or delete it. With auth off every caller is the same local user and may
do everything.
"""

from __future__ import annotations

import secrets
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import auth
from ..storage.db import Database
from ._common import get_db, utc_now
from .report_assets import require_report

router = APIRouter(prefix="/api", tags=["reports"])
_write = Depends(auth.require_role("write"))

AnchorKind = Literal["report", "block", "card", "quote"]


class CommentCreate(BaseModel):
    body: str
    # Required on a thread root; ignored on a reply (it inherits the root's).
    anchor_kind: AnchorKind | None = None
    anchor_id: str | None = None
    quote: str | None = None
    parent_id: str | None = None


class CommentUpdate(BaseModel):
    body: str


class CommentResolve(BaseModel):
    resolved: bool = True


class _Caller:
    """Who is asking: the comment author identity and whether they're admin."""

    def __init__(self, author_id: str | None, author: str, admin: bool):
        self.author_id = author_id
        self.author = author
        self.admin = admin

    def may_edit(self, row: dict[str, Any]) -> bool:
        return self.admin or (self.author_id is not None and row["author_id"] == self.author_id)


def _caller(request: Request) -> _Caller:
    if not getattr(request.app.state, "auth_enabled", False):
        return _Caller(None, "local", admin=True)
    principal = auth.principal_from_request(request)
    if principal is None:  # the router's role dependency already refused this
        raise HTTPException(status_code=401, detail="authentication required")
    db = get_db(request)
    # A per-browser token is minted from a parent; the parent is the person.
    token = auth.get_token(db, principal.token_id)
    root = auth.get_token(db, token["parent_id"]) if token and token["parent_id"] else None
    root = root or token
    author_id = root["id"] if root else principal.token_id
    author = root["name"] if root else principal.name
    return _Caller(author_id, author, admin=principal.role == "admin")


_COLUMNS = (
    "id, report_id, parent_id, anchor_kind, anchor_id, quote, body, author_id, "
    "author, created_at, updated_at, resolved_at, resolved_by"
)


def _out(row: dict[str, Any], caller: _Caller) -> dict[str, Any]:
    return {**row, "can_edit": caller.may_edit(row)}


def _get_comment(db: Database, report_id: str, comment_id: str) -> dict[str, Any]:
    rows = db.read_columns(
        f"SELECT {_COLUMNS} FROM comments WHERE id = ? AND report_id = ?",
        [comment_id, report_id],
    )
    if not rows:
        raise HTTPException(status_code=404, detail="comment not found")
    return rows[0]


def _require_body(text: str) -> str:
    if not text.strip():
        raise HTTPException(status_code=400, detail="comment body is empty")
    return text


@router.get("/projects/{project_id}/reports/{report_id}/comments")
def list_comments(project_id: str, report_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_report(db, project_id, report_id)
    caller = _caller(request)
    rows = db.read_columns(
        f"SELECT {_COLUMNS} FROM comments WHERE report_id = ? ORDER BY created_at, id",
        [report_id],
    )
    return {"comments": [_out(r, caller) for r in rows]}


@router.post("/projects/{project_id}/reports/{report_id}/comments", dependencies=[_write])
def create_comment(
    project_id: str, report_id: str, body: CommentCreate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    require_report(db, project_id, report_id)
    caller = _caller(request)
    text = _require_body(body.body)

    if body.parent_id is not None:
        parent = _get_comment(db, report_id, body.parent_id)
        if parent["parent_id"] is not None:
            raise HTTPException(status_code=400, detail="reply to the thread's first comment")
        kind, anchor_id, quote = parent["anchor_kind"], parent["anchor_id"], parent["quote"]
    else:
        kind, anchor_id, quote = body.anchor_kind, body.anchor_id, body.quote
        if kind is None:
            raise HTTPException(status_code=400, detail="anchor_kind is required")
        if kind == "report":
            anchor_id, quote = None, None
        elif not anchor_id:
            raise HTTPException(status_code=400, detail=f"a {kind} anchor needs anchor_id")
        elif kind != "quote":
            quote = None
        elif not quote:
            raise HTTPException(status_code=400, detail="a quote anchor needs quote")

    cid = secrets.token_hex(8)
    now = utc_now().isoformat()
    db.write(
        f"""INSERT INTO comments ({_COLUMNS})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)""",
        [cid, report_id, body.parent_id, kind, anchor_id, quote, text,
         caller.author_id, caller.author, now, now],
    )
    return _out(_get_comment(db, report_id, cid), caller)


@router.put(
    "/projects/{project_id}/reports/{report_id}/comments/{comment_id}", dependencies=[_write],
)
def update_comment(
    project_id: str, report_id: str, comment_id: str, body: CommentUpdate, request: Request,
) -> dict[str, Any]:
    db = get_db(request)
    require_report(db, project_id, report_id)
    caller = _caller(request)
    row = _get_comment(db, report_id, comment_id)
    if not caller.may_edit(row):
        raise HTTPException(status_code=403, detail="only the author or an admin may edit")
    db.write(
        "UPDATE comments SET body = ?, updated_at = ? WHERE id = ?",
        [_require_body(body.body), utc_now().isoformat(), comment_id],
    )
    return _out(_get_comment(db, report_id, comment_id), caller)


@router.delete(
    "/projects/{project_id}/reports/{report_id}/comments/{comment_id}", dependencies=[_write],
)
def delete_comment(
    project_id: str, report_id: str, comment_id: str, request: Request,
) -> dict[str, Any]:
    """Delete one comment; deleting a thread's first comment deletes the thread."""
    db = get_db(request)
    require_report(db, project_id, report_id)
    caller = _caller(request)
    row = _get_comment(db, report_id, comment_id)
    if not caller.may_edit(row):
        raise HTTPException(status_code=403, detail="only the author or an admin may delete")
    replies = [
        r[0] for r in db.read("SELECT id FROM comments WHERE parent_id = ?", [comment_id])
    ]
    db.write(
        "DELETE FROM comments WHERE (id = ? OR parent_id = ?) AND report_id = ?",
        [comment_id, comment_id, report_id],
    )
    return {"deleted": [comment_id, *replies]}


@router.post(
    "/projects/{project_id}/reports/{report_id}/comments/{comment_id}/resolve",
    dependencies=[_write],
)
def resolve_comment(
    project_id: str, report_id: str, comment_id: str, body: CommentResolve, request: Request,
) -> dict[str, Any]:
    """Resolve (or reopen, with ``resolved: false``) a thread by its first comment."""
    db = get_db(request)
    require_report(db, project_id, report_id)
    caller = _caller(request)
    row = _get_comment(db, report_id, comment_id)
    if row["parent_id"] is not None:
        raise HTTPException(status_code=400, detail="resolve the thread's first comment")
    if body.resolved:
        db.write(
            "UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?",
            [utc_now().isoformat(), caller.author, comment_id],
        )
    else:
        db.write(
            "UPDATE comments SET resolved_at = NULL, resolved_by = NULL WHERE id = ?",
            [comment_id],
        )
    return _out(_get_comment(db, report_id, comment_id), caller)
