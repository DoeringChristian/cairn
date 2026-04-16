"""Sequence read endpoints with server-side downsampling."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ..downsample import downsample
from ..storage.migrations import hash_context
from ._common import get_db, require_run

router = APIRouter(prefix="/api", tags=["sequences"])


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


@router.get("/runs/{run_id}/sequences/{name}")
def get_sequence(
    run_id: str,
    name: str,
    request: Request,
    context: str | None = Query(default=None),
    step_from: int | None = Query(default=None),
    step_to: int | None = Query(default=None),
    max_points: int | None = Query(default=None, ge=1, le=10_000_000),
    method: str = Query(default="lttb"),
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
        SELECT s.step, s.wall_time, s.scalar_value, s.artifact_hash,
               s.context, s.object_type,
               a.mime_type AS artifact_mime,
               a.size_bytes AS artifact_size,
               a.metadata AS artifact_metadata
        FROM sequences s
        LEFT JOIN artifacts a ON a.hash = s.artifact_hash
        WHERE {' AND '.join(prefixed_clauses)}
        ORDER BY s.step
        """,
        params,
    )

    # Downsample scalar points only; media/artifact series are usually small
    # enough to return as-is.
    if rows and rows[0]["object_type"] == "scalar" and max_points:
        pts = [(r["step"], r["scalar_value"]) for r in rows]
        reduced = downsample(pts, max_points, method=method)
        # Build a fast lookup so we keep the original rows with wall_time etc.
        kept = set(id(p) for p in reduced)  # identity-based; fine for LTTB output
        # Since downsample returns a subset of the inputs, reconstruct by index.
        reduced_set = {(step, val) for step, val in reduced}
        rows = [r for r in rows if (r["step"], r["scalar_value"]) in reduced_set]

    return {"run_id": run_id, "name": name, "points": rows}
