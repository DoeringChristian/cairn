"""Sequence read endpoints.

Downsampling is REMOVED (refactor ruling 2026-08-27): sequences ship raw
(step windowing via step_from/step_to stays — generic row filtering); any
thinning for render performance is a client/renderer concern.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..storage.migrations import hash_context
from ._common import get_db, require_run

router = APIRouter(prefix="/api", tags=["sequences"])

# Max rows one /updates poll returns; the client pages on ``more``.
UPDATES_LIMIT = 5000

# ``sequences`` has an implicit SQLite rowid (its PK is not WITHOUT ROWID),
# and rows are only ever INSERT OR IGNOREd — never replaced — so the rowid is
# a stable, monotonic append cursor. That is what /updates pages through and
# what a sequence read hands back as its starting point.
_POINT_COLUMNS = """s.rowid AS _rowid,
               s.step, s.wall_time, s.scalar_value, s.artifact_hash,
               s.context, s.object_type,
               a.mime_type AS artifact_mime,
               a.size_bytes AS artifact_size,
               a.metadata AS artifact_metadata"""


def _take_cursor(rows: list[dict[str, Any]], since: int = 0) -> int:
    """Strip the internal ``_rowid`` key from ``rows``; return the max seen."""
    cursor = since
    for row in rows:
        rowid = row.pop("_rowid", None)
        if rowid is not None and rowid > cursor:
            cursor = rowid
    return cursor


@router.get("/runs/{run_id}/updates")
def get_updates(
    run_id: str,
    request: Request,
    since: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Every sequence point of ``run_id`` appended after cursor ``since``.

    One poll per run replaces the per-card sequence re-download: cards keep
    their own cached sequences and the live-updates poller appends the delta.
    ``since=0`` means "everything". ``cursor`` is the value to pass next;
    ``more`` says the LIMIT was hit and another poll should follow now.
    """
    db = get_db(request)
    require_run(db, run_id)  # 404 gate
    rows = db.read_columns(
        f"""
        SELECT s.name, s.context_hash,
               {_POINT_COLUMNS}
        FROM sequences s
        LEFT JOIN artifacts a ON a.hash = s.artifact_hash
        WHERE s.run_id = ? AND s.rowid > ?
        ORDER BY s.rowid
        LIMIT ?
        """,
        [run_id, since, UPDATES_LIMIT],
    )
    cursor = _take_cursor(rows, since)
    # Status is read AFTER the points on purpose: a client stops polling on a
    # terminal status, so that answer must never race ahead of the run's last
    # points. Reading it second means "completed" implies the rows above
    # already cover everything written before the run finished.
    status = db.read_columns("SELECT status FROM runs WHERE id = ?", [run_id])[0][
        "status"
    ]
    return {
        "run_id": run_id,
        "status": status,
        "cursor": cursor,
        "points": rows,
        "more": len(rows) >= UPDATES_LIMIT,
    }


@router.get("/runs/{run_id}/sequences")
def list_sequences(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)
    rows = db.read_columns(
        """
        SELECT name, object_type, context, context_hash,
               MIN(step) AS min_step, MAX(step) AS max_step,
               COUNT(*) AS count
        FROM sequences
        WHERE run_id = ?
        GROUP BY name, object_type, context, context_hash
        ORDER BY name
        """,
        [run_id],
    )
    return {"sequences": rows}


@router.get("/runs/{run_id}/sequences/{name:path}")
def get_sequence(
    run_id: str,
    name: str,
    request: Request,
    context: str | None = Query(default=None),
    step_from: int | None = Query(default=None),
    step_to: int | None = Query(default=None),
) -> dict[str, Any]:
    db = get_db(request)
    require_run(db, run_id)

    clauses = ["run_id = ?", "name = ?"]
    params: list[Any] = [run_id, name]
    if context is not None:
        # Accept either a raw JSON dict or the opaque context_hash.
        try:
            ctx_obj = json.loads(context)
            clauses.append("context_hash = ?")
            params.append(hash_context(ctx_obj))
        except json.JSONDecodeError:
            clauses.append("context_hash = ?")
            params.append(context)
    if step_from is not None:
        clauses.append("step >= ?")
        params.append(step_from)
    if step_to is not None:
        clauses.append("step <= ?")
        params.append(step_to)

    # LEFT JOIN so non-artifact (scalar) rows still come through. The UI
    # needs artifact_meta + mime_type for media cards (audio peaks, figure
    # has_source / source_hash, histogram bin count, etc.).
    prefixed_clauses = [c.replace("run_id", "s.run_id").replace("name", "s.name")
                        if ("run_id" in c or c.startswith("name ")) else c
                        for c in clauses]
    # Safer: just prefix explicitly since the clauses come from a small set.
    prefixed_clauses = []
    for c in clauses:
        # ``clauses`` values are like "run_id = ?", "name = ?",
        # "context_hash = ?", "step >= ?", "step <= ?". Prefix bare column refs
        # with ``s.`` so they're unambiguous after the JOIN.
        if c.startswith("run_id "):
            prefixed_clauses.append("s." + c)
        elif c.startswith("name "):
            prefixed_clauses.append("s." + c)
        elif c.startswith("context_hash "):
            prefixed_clauses.append("s." + c)
        elif c.startswith("step "):
            prefixed_clauses.append("s." + c)
        else:
            prefixed_clauses.append(c)

    rows = db.read_columns(
        f"""
        SELECT {_POINT_COLUMNS}
        FROM sequences s
        LEFT JOIN artifacts a ON a.hash = s.artifact_hash
        WHERE {' AND '.join(prefixed_clauses)}
        ORDER BY s.step
        """,
        params,
    )

    # ``cursor`` seeds the client's live-updates poller: everything in this
    # response is already cached there, so /updates resumes past it.
    cursor = _take_cursor(rows)
    return {"run_id": run_id, "name": name, "points": rows, "cursor": cursor}
