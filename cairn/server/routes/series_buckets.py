"""Server-side downsampling of a scalar series: ``GET /api/runs/{id}/series/{name}``.

``?x=step&buckets=N&from=&to=`` splits the step range ``[from, to]``
(default: the series' first and last step) into ``N`` equal-width buckets and
returns, per non-empty bucket, ``{x0, x1, min, max, last, n}``: the first and
last step that fell in it, the min and max scalar value, the value at its
last step (``last``; null when that point has no value, e.g. NaN) and the
number of points with a value (``n``). Min/max per bucket keep every spike a
chart of that width could show (W&B's full-fidelity charts); a chart asks
for its pixel width and asks again on zoom with a narrower ``from``/``to``.

One SQL statement over the ``sequences`` primary key ``(run_id, name,
step)``: a range scan of the window, grouped by bucket in SQLite, plus one
primary-key lookup per bucket for its last value; nothing is read into
Python beyond the buckets.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ._common import get_db, require_run

router = APIRouter(prefix="/api", tags=["sequences"])

#: Most buckets one request may ask for.
MAX_BUCKETS = 10_000


@router.get("/runs/{run_id}/series/{name:path}")
def series_buckets(
    run_id: str,
    name: str,
    request: Request,
    x: str = Query("step"),
    buckets: int = Query(1000, ge=1, le=MAX_BUCKETS),
    from_: int | None = Query(None, alias="from"),
    to: int | None = Query(None),
) -> dict[str, Any]:
    if x != "step":
        raise HTTPException(status_code=422, detail="only x=step is supported")
    db = get_db(request)
    require_run(db, run_id)
    lo, hi = from_, to
    if lo is None or hi is None:
        bounds = db.read_one(
            "SELECT MIN(step), MAX(step) FROM sequences "
            "WHERE run_id = ? AND name = ? AND object_type = 'scalar' AND summary = 0",
            [run_id, name],
        )
        if bounds is None or bounds[0] is None:
            return {"run_id": run_id, "name": name, "x": x, "from": lo, "to": hi,
                    "buckets": [], "points": 0}
        lo = bounds[0] if lo is None else lo
        hi = bounds[1] if hi is None else hi
    if hi < lo:
        raise HTTPException(status_code=422, detail="`to` must not be below `from`")
    rows = db.read(
        """
        WITH agg AS (
            SELECT (step - :lo) * :n / (:hi - :lo + 1) AS b,
                   MIN(step) AS x0, MAX(step) AS x1,
                   MIN(scalar_value) AS mn, MAX(scalar_value) AS mx,
                   COUNT(scalar_value) AS cnt, COUNT(*) AS total
            FROM sequences
            WHERE run_id = :run AND name = :name AND step BETWEEN :lo AND :hi
              AND object_type = 'scalar' AND summary = 0
            GROUP BY b
        )
        SELECT agg.x0, agg.x1, agg.mn, agg.mx, s.scalar_value, agg.cnt, agg.total
        FROM agg JOIN sequences s
          ON s.run_id = :run AND s.name = :name AND s.step = agg.x1
        ORDER BY agg.b
        """,
        {"lo": lo, "hi": hi, "n": buckets, "run": run_id, "name": name},
    )
    return {
        "run_id": run_id,
        "name": name,
        "x": x,
        "from": lo,
        "to": hi,
        "buckets": [
            {"x0": r[0], "x1": r[1], "min": r[2], "max": r[3], "last": r[4], "n": r[5]}
            for r in rows
        ],
        "points": sum(r[6] for r in rows),
    }
