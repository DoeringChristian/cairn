"""Sequence read endpoints.

Downsampling is REMOVED (refactor ruling 2026-08-27): sequences ship raw
(step windowing via step_from/step_to stays — generic row filtering); any
thinning for render performance is a client/renderer concern.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from ._common import get_db, require_run

router = APIRouter(prefix="/api", tags=["sequences"])

# Max rows one /updates poll returns; the client pages on ``more``.
UPDATES_LIMIT = 5000

# ``sequences`` has an implicit SQLite rowid (its PK is not WITHOUT ROWID),
# and rows are only ever INSERT OR IGNOREd — never replaced — so the rowid is
# a monotonic append cursor. That is what /updates pages through and what a
# sequence read hands back as its starting point. The one exception is a
# rewind, which deletes rows (their rowids get reused, there's no
# AUTOINCREMENT) and bumps the run's ``data_epoch``: both endpoints return
# it, and a client holding a cursor from another epoch starts over.
_POINT_COLUMNS = """s.rowid AS _rowid,
               s.step, s.wall_time, s.scalar_value, s.artifact_hash,
               s.object_type, s.metadata,
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
        SELECT s.name,
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
    run = db.read_columns(
        "SELECT status, data_epoch FROM runs WHERE id = ?", [run_id],
    )[0]
    return {
        "run_id": run_id,
        "status": run["status"],
        "data_epoch": run["data_epoch"] or 0,
        "cursor": cursor,
        "points": rows,
        "more": len(rows) >= UPDATES_LIMIT,
    }


@router.get("/runs/{run_id}/sequences")
def list_sequences(run_id: str, request: Request) -> dict[str, Any]:
    """Every sequence of the run: name, object type (the greatest one, if a
    series mixes them), first and last step, and point count.

    Read from ``metric_stats`` (the run's scalar points, any object type)
    plus the partial index ``idx_sequences_unsummarized`` (every point that
    is not a scalar of type ``scalar``), so the cost is the number of
    metrics and media points rather than every point. A point in both (a
    scalar value under another object type) is counted once.
    """
    db = get_db(request)
    require_run(db, run_id)
    stats = db.read(
        "SELECT name, count, first_step, last_step FROM metric_stats WHERE run_id = ?",
        [run_id],
    )
    rest = db.read(
        """
        SELECT name, MAX(object_type), MIN(step), MAX(step), COUNT(*), COUNT(scalar_value)
        FROM sequences
        WHERE run_id = ? AND (object_type != 'scalar' OR scalar_value IS NULL)
        GROUP BY name
        """,
        [run_id],
    )
    out: dict[str, dict[str, Any]] = {}
    for name, count, first, last in stats:
        out[name] = {"name": name, "object_type": "scalar", "min_step": first, "max_step": last, "count": count}
    for name, otype, lo, hi, count, valued in rest:
        seq = out.get(name)
        if seq is None:
            out[name] = {"name": name, "object_type": otype, "min_step": lo, "max_step": hi, "count": count}
            continue
        # ``valued`` points carry a scalar under another object type: already
        # counted by metric_stats. Only when every summarized point is one of
        # them does no point of type ``scalar`` exist.
        typed_scalar = seq["count"] > valued
        seq["object_type"] = max(otype, "scalar") if typed_scalar else otype
        seq["min_step"] = min(seq["min_step"], lo)
        seq["max_step"] = max(seq["max_step"], hi)
        seq["count"] += count - valued
    return {"sequences": [out[n] for n in sorted(out)]}


# Most names one /series request may ask for (the client splits bigger batches).
SERIES_BATCH_LIMIT = 200

# The point fields, in the order /series sends them as columns.
_SERIES_COLUMNS = (
    "step", "wall_time", "scalar_value", "artifact_hash", "object_type",
    "metadata", "artifact_mime", "artifact_size", "artifact_metadata",
)


def _columnar(rows: list[tuple[Any, ...]], start: int, end: int) -> tuple[dict[str, list[Any]], dict[str, Any]]:
    """Rows ``[start, end)`` (``rowid, name, *_SERIES_COLUMNS``) as columns.

    A field with one value at every point (``object_type``, and every
    artifact field of a scalar series, which is null) is sent once in
    ``constant`` instead of as a column; a reader expands it back.
    """
    columns: dict[str, list[Any]] = {}
    constant: dict[str, Any] = {}
    for j, key in enumerate(_SERIES_COLUMNS, start=2):
        col = [rows[i][j] for i in range(start, end)]
        first = col[0] if col else None
        if all(v == first and type(v) is type(first) for v in col):
            constant[key] = first
        else:
            columns[key] = col
    return columns, constant


@router.get("/runs/{run_id}/series")
def get_series(
    run_id: str,
    request: Request,
    name: list[str] = Query(default=[]),
) -> JSONResponse:
    """Several of ``run_id``'s sequences in one response, as columns.

    The same points ``GET /runs/{id}/sequences/{name}`` returns, for every
    ``name`` given (a name the run never logged comes back with no points),
    but column-wise: ``columns`` maps a field to its values in step order,
    ``constant`` holds a field that is the same at every point. ``cursor`` is
    the max rowid of the points sent (what the live-updates poller resumes
    from), per series and for the whole response.
    """
    if len(name) > SERIES_BATCH_LIMIT:
        raise HTTPException(status_code=400, detail=f"at most {SERIES_BATCH_LIMIT} names per request")
    db = get_db(request)
    run = require_run(db, run_id)
    names = list(dict.fromkeys(name))
    rows: list[tuple[Any, ...]] = []
    if names:
        holes = ",".join("?" * len(names))
        rows = db.read(
            f"""
            SELECT s.rowid, s.name, s.step, s.wall_time, s.scalar_value,
                   s.artifact_hash, s.object_type, s.metadata,
                   a.mime_type, a.size_bytes, a.metadata
            FROM sequences s
            LEFT JOIN artifacts a ON a.hash = s.artifact_hash
            WHERE s.run_id = ? AND s.name IN ({holes})
            ORDER BY s.name, s.step
            """,
            [run_id, *names],
        )
    spans: dict[str, tuple[int, int]] = {}
    i = 0
    while i < len(rows):
        j = i
        while j < len(rows) and rows[j][1] == rows[i][1]:
            j += 1
        spans[rows[i][1]] = (i, j)
        i = j
    series = []
    top = 0
    for n in names:
        start, end = spans.get(n, (0, 0))
        columns, constant = _columnar(rows, start, end)
        cursor = max((rows[k][0] for k in range(start, end)), default=0)
        top = max(top, cursor)
        series.append({"name": n, "count": end - start, "cursor": cursor, "columns": columns, "constant": constant})
    return JSONResponse({
        "run_id": run_id, "data_epoch": run["data_epoch"] or 0, "cursor": top, "series": series,
    })


@router.get("/runs/{run_id}/sequences/{name:path}")
def get_sequence(
    run_id: str,
    name: str,
    request: Request,
    step_from: int | None = Query(default=None),
    step_to: int | None = Query(default=None),
) -> dict[str, Any]:
    db = get_db(request)
    run = require_run(db, run_id)

    clauses = ["run_id = ?", "name = ?"]
    params: list[Any] = [run_id, name]
    if step_from is not None:
        clauses.append("step >= ?")
        params.append(step_from)
    if step_to is not None:
        clauses.append("step <= ?")
        params.append(step_to)

    # LEFT JOIN so non-artifact (scalar) rows still come through. The UI
    # needs artifact_meta + mime_type for media cards (audio peaks, figure
    # has_source / source_hash, histogram bin count, etc.). Every clause is
    # on a ``sequences`` column, so prefix it with ``s.`` after the JOIN.
    prefixed_clauses = ["s." + c for c in clauses]

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
    return {
        "run_id": run_id, "name": name, "points": rows, "cursor": cursor,
        "data_epoch": run["data_epoch"] or 0,
    }
