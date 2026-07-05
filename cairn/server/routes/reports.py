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
import re
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


_FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$")


def _count_source_segments(source: str) -> int:
    """B11 fix: count top-level blocks directly from `source` for a
    source-only report (SDK/`cairn.Report` ships `{source}` with no
    `blocks[]` cache — see AR1 §6) instead of misreporting "0 blocks".

    Approximates `lib/reports/markdown-source.ts`'s `splitFences`: a run of
    prose lines is one block, and every ```cairn fence is its own block; any
    other fenced code block stays embedded in its surrounding prose (not
    split out), same as the TS splitter. Good enough for this list-page
    badge — the TS parser stays the single source of truth for the actual
    `blocks[]` a report compiles to.
    """
    lines = source.split("\n")
    n = len(lines)
    segments = 0
    prose_buf: list[str] = []
    i = 0

    def flush_prose() -> None:
        nonlocal segments
        if prose_buf:
            segments += 1
            prose_buf.clear()

    while i < n:
        m = _FENCE_OPEN_RE.match(lines[i])
        if not m:
            prose_buf.append(lines[i])
            i += 1
            continue
        run, info = m.group(1), m.group(2)
        char, min_len = run[0], len(run)
        lang = info.strip().split()[0] if info.strip() else ""
        close_re = re.compile(rf"^ {{0,3}}{re.escape(char)}{{{min_len},}}[ \t]*$")
        close_idx = next((j for j in range(i + 1, n) if close_re.match(lines[j])), -1)
        closed = close_idx != -1
        end_idx = close_idx if closed else n - 1

        if lang == "cairn":
            flush_prose()
            segments += 1
        else:
            prose_buf.append("\n".join(lines[i : end_idx + 1]))
        i = close_idx + 1 if closed else n

    flush_prose()
    return segments


def _block_count(payload: dict[str, Any]) -> int:
    blocks = payload.get("blocks")
    if blocks:
        return len(blocks)
    source = payload.get("source")
    if isinstance(source, str) and source.strip():
        return _count_source_segments(source)
    return 0


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
            "block_count": _block_count(payload),
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
