"""Sequence read endpoints.

Downsampling is REMOVED (refactor ruling 2026-08-27): sequences ship raw
(step windowing via step_from/step_to stays — generic row filtering); any
thinning for render performance is a client/renderer concern.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .. import auth
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
# it, and a client holding a cursor from another epoch starts over. The
# other: a summary media value (``summary = 1``) is replaced or deleted when
# its summary key is, which bumps ``data_epoch`` the same way.
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
    series mixes them), first and last step, and point count; a scalar series
    also says whether its values never decrease along its steps
    (``monotonic``: what an x-axis needs). A ``custom``
    series also has its data ``kind`` (that of its latest point). A summary
    media value (``run.summary(fig=cairn.Figure(f))``) is a series of ONE
    point at step 0 marked ``"summary": true`` (no other series has the key):
    its name is the summary key's dotted path, and every series read
    (``/series``, ``/sequences/{name}``, ``/updates``) returns that point.

    Read from ``metric_stats`` (the run's scalar points, any object type)
    plus the partial index ``idx_sequences_unsummarized`` (every point that
    is not a scalar of type ``scalar``), so the cost is the number of
    metrics and media points rather than every point. A point in both (a
    scalar value under another object type) is counted once.
    """
    db = get_db(request)
    require_run(db, run_id)
    return {"sequences": sequence_catalogues(db, [run_id])[run_id]}


def sequence_catalogues(db: Any, run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """``{run_id: [series]}``: each run's ``GET /api/runs/{id}/sequences``
    list (by name), a few queries per 500 runs (``POST /api/runs/batch``
    reads many runs' catalogues at once). A run without series, or unknown,
    has an empty list."""
    out: dict[str, dict[str, dict[str, Any]]] = {rid: {} for rid in run_ids}
    for i in range(0, len(run_ids), 500):
        chunk = run_ids[i:i + 500]
        holes = ",".join("?" * len(chunk))
        for rid, name, count, first, last, monotonic in db.read(
            f"SELECT run_id, name, count, first_step, last_step, monotonic FROM metric_stats WHERE run_id IN ({holes})",
            chunk,
        ):
            out[rid][name] = {
                "name": name, "object_type": "scalar", "min_step": first, "max_step": last, "count": count,
                "monotonic": bool(monotonic),
            }
        for rid, name, otype, lo, hi, count, valued, summary in db.read(
            f"""
            SELECT run_id, name, MAX(object_type), MIN(step), MAX(step), COUNT(*), COUNT(scalar_value),
                   MAX(summary)
            FROM sequences
            WHERE run_id IN ({holes}) AND (object_type != 'scalar' OR scalar_value IS NULL)
            GROUP BY run_id, name
            """,
            chunk,
        ):
            seqs = out[rid]
            seq = seqs.get(name)
            if seq is None:
                seqs[name] = {"name": name, "object_type": otype, "min_step": lo, "max_step": hi, "count": count}
                if summary:
                    seqs[name]["summary"] = True
                continue
            # ``valued`` points carry a scalar under another object type: already
            # counted by metric_stats. Only when every summarized point is one of
            # them does no point of type ``scalar`` exist.
            typed_scalar = seq["count"] > valued
            seq["object_type"] = max(otype, "scalar") if typed_scalar else otype
            seq["min_step"] = min(seq["min_step"], lo)
            seq["max_step"] = max(seq["max_step"], hi)
            seq["count"] += count - valued
        for rid, kinds in custom_kinds(db, chunk).items():
            for name, kind in kinds.items():
                seq = out[rid].get(name)
                if seq is not None and seq["object_type"] == "custom":
                    seq["kind"] = kind
    return {rid: [seqs[n] for n in sorted(seqs)] for rid, seqs in out.items()}


def custom_kinds(db: Any, run_ids: list[str]) -> dict[str, dict[str, str]]:
    """``{run_id: {name: kind}}`` for the runs' ``custom`` series: the data
    kind (artifact metadata ``kind``) of each series' latest-step point. Reads
    only ``custom`` points (through ``idx_sequences_unsummarized``)."""
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, str]] = {}
    # SQLite: the bare column next to MAX(step) comes from the max-step row.
    for run_id, name, _step, kind in db.read(
        f"""
        SELECT s.run_id, s.name, MAX(s.step), json_extract(a.metadata, '$.kind')
        FROM sequences s
        JOIN artifacts a ON a.hash = s.artifact_hash
        WHERE s.run_id IN ({holes}) AND s.object_type = 'custom'
        GROUP BY s.run_id, s.name
        """,
        run_ids,
    ):
        if isinstance(kind, str):
            out.setdefault(run_id, {})[name] = kind
    return out


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
    return JSONResponse(_series(db, run_id, run["data_epoch"] or 0, list(dict.fromkeys(name))))


def _series(db: Any, run_id: str, data_epoch: int, names: list[str]) -> dict[str, Any]:
    """One run's ``GET /runs/{id}/series`` body for ``names`` (distinct)."""
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
    return {"run_id": run_id, "data_epoch": data_epoch, "cursor": top, "series": series}


# Most names (over every run) one ``POST /api/runs/series`` may ask for.
SERIES_MANY_LIMIT = 5000


class SeriesManyBody(BaseModel):
    """``POST /api/runs/series``: ``{run_id: [name]}``."""

    runs: dict[str, list[str]]


@router.post("/runs/series")
def get_series_many(body: SeriesManyBody, request: Request) -> JSONResponse:
    """Several runs' ``GET /runs/{id}/series`` in one request (a workspace's
    charts over a thousand runs): ``{"runs": {id: <that run's /series
    body>}, "missing": [id], "forbidden": [id]}``. At most
    ``SERIES_BATCH_LIMIT`` names per run and ``SERIES_MANY_LIMIT`` in all.
    ``missing``: ids of no run; ``forbidden``: through a share link, the ids
    outside the shared report (the per-run route's 403), never read.
    """
    if any(len(names) > SERIES_BATCH_LIMIT for names in body.runs.values()):
        raise HTTPException(status_code=400, detail=f"at most {SERIES_BATCH_LIMIT} names per run")
    if sum(len(names) for names in body.runs.values()) > SERIES_MANY_LIMIT:
        raise HTTPException(status_code=400, detail=f"at most {SERIES_MANY_LIMIT} names per request")
    ids = list(body.runs)
    forbidden: list[str] = []
    grant = auth.request_share(request)
    if grant is not None:
        scope = auth.share_scope(request, grant)
        forbidden = [rid for rid in ids if rid not in scope.run_ids]
        ids = [rid for rid in ids if rid in scope.run_ids]
    db = get_db(request)
    epochs: dict[str, int] = {}
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        for rid, epoch in db.read(f"SELECT id, data_epoch FROM runs WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            epochs[rid] = epoch or 0
    out = {rid: _series(db, rid, epochs[rid], list(dict.fromkeys(body.runs[rid]))) for rid in ids if rid in epochs}
    return JSONResponse({"runs": out, "missing": [rid for rid in ids if rid not in epochs], "forbidden": forbidden})


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
