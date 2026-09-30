"""``metric_stats``: a per-(run, metric) summary of the scalar points.

Every read that shows a run's metrics as numbers (the runs table's values
and stats columns, ``summary=`` rules, ``Run.final``, query predicates on
``metrics.x``) needs the same few aggregates of a series: count, sum, min,
max, and the values at the first and last step. Computing them at read time
scans every point of every run on the page, so its cost grows with the
length of the histories. This table holds them instead, maintained in the
same transaction as the point writes.

Semantics are exactly those of the scans it replaces: only points with a
scalar value count (media points, and NaN, which SQLite stores as NULL,
are ignored), and ``first``/``last`` are the values at the lowest/highest
step, whatever order the points arrived in.

It is a derived index, never a source of truth:

* ``apply_inserted`` folds in points a write actually inserted (points are
  ``INSERT OR IGNORE``, so a re-sent point must not count twice);
* ``rebuild_metric_stats`` recomputes runs from their points, for every
  operation that deletes or copies history (rewind, fork, archive import);
* ``backfill_metric_stats`` builds the whole table once for a repo written
  before it existed.
"""

from __future__ import annotations

import logging
import math
import sqlite3
import time
from collections.abc import Iterable, Sequence
from typing import Any

log = logging.getLogger(__name__)


def _sum(values: list[float]) -> float:
    """Correctly rounded sum; NaN (bound as NULL, like SQLite's SUM) when
    +inf and -inf cancel."""
    try:
        return math.fsum(values)
    except ValueError:  # -inf + inf
        return math.nan
    except OverflowError:  # finite values summing past the float range
        return sum(values)


def apply_inserted(
    con: sqlite3.Connection, run_id: str, inserted: Iterable[Sequence[Any]],
) -> None:
    """Fold newly inserted points ``(name, step, scalar_value)`` into
    ``run_id``'s rows. Non-scalar points (``scalar_value`` None) are skipped.

    One upsert per metric. A batch may arrive out of order relative to what
    is stored: ``first`` moves only to a lower step, ``last`` only to a
    higher one. SET expressions all see the row before the update.
    """
    groups: dict[str, list[tuple[int, float]]] = {}
    for name, step, value in inserted:
        if value is not None:
            groups.setdefault(name, []).append((step, value))
    if not groups:
        return
    rows = []
    for name, pts in groups.items():
        values = [v for _, v in pts]
        first = min(pts)
        last = max(pts)
        rows.append((
            run_id, name, len(pts), _sum(values), min(values), max(values),
            first[0], first[1], last[0], last[1],
        ))
    con.executemany(
        """
        INSERT INTO metric_stats (
            run_id, name, count, sum, min, max,
            first_step, first_value, last_step, last_value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id, name) DO UPDATE SET
            count = count + excluded.count,
            sum = sum + excluded.sum,
            min = MIN(min, excluded.min),
            max = MAX(max, excluded.max),
            first_value = CASE WHEN excluded.first_step < first_step
                               THEN excluded.first_value ELSE first_value END,
            first_step = MIN(first_step, excluded.first_step),
            last_value = CASE WHEN excluded.last_step > last_step
                              THEN excluded.last_value ELSE last_value END,
            last_step = MAX(last_step, excluded.last_step)
        """,
        rows,
    )


def rebuild_metric_stats(con: sqlite3.Connection, run_ids: Sequence[str]) -> None:
    """Recompute ``run_ids``' rows from their points (run inside the
    caller's transaction). A run without scalar points ends with no rows."""
    run_ids = list(run_ids)
    for i in range(0, len(run_ids), 500):
        chunk = run_ids[i:i + 500]
        holes = ",".join("?" * len(chunk))
        con.execute(f"DELETE FROM metric_stats WHERE run_id IN ({holes})", chunk)
        con.execute(
            f"""
            INSERT INTO metric_stats (
                run_id, name, count, sum, min, max,
                first_step, first_value, last_step, last_value
            )
            SELECT g.run_id, g.name, g.count, g.sum, g.min, g.max,
                   g.first_step, f.scalar_value, g.last_step, l.scalar_value
              FROM (SELECT run_id, name, COUNT(*) AS count,
                           SUM(scalar_value) AS sum,
                           MIN(scalar_value) AS min, MAX(scalar_value) AS max,
                           MIN(step) AS first_step, MAX(step) AS last_step
                      FROM sequences
                     WHERE run_id IN ({holes}) AND scalar_value IS NOT NULL
                     GROUP BY run_id, name) g
              JOIN sequences f
                ON f.run_id = g.run_id AND f.name = g.name AND f.step = g.first_step
              JOIN sequences l
                ON l.run_id = g.run_id AND l.name = g.name AND l.step = g.last_step
            """,
            chunk,
        )


def backfill_metric_stats(con: sqlite3.Connection) -> None:
    """Build the table for a repo whose points predate it: once, when it is
    empty while ``sequences`` is not. Re-checked under the write lock, so two
    processes opening the repo together build it once."""
    if con.execute("SELECT 1 FROM metric_stats LIMIT 1").fetchone():
        return
    if not con.execute("SELECT 1 FROM sequences LIMIT 1").fetchone():
        return
    t0 = time.perf_counter()
    run_ids: list[str] = []
    con.execute("BEGIN IMMEDIATE")
    try:
        if con.execute("SELECT 1 FROM metric_stats LIMIT 1").fetchone() is None:
            run_ids = [r[0] for r in con.execute("SELECT id FROM runs")]
            rebuild_metric_stats(con, run_ids)
    except BaseException:
        con.rollback()
        raise
    con.commit()
    if not run_ids:
        return
    log.warning(
        "cairn: built the metric_stats index for %d runs in %.1f s (one-time)",
        len(run_ids), time.perf_counter() - t0,
    )


def insert_points(
    con: sqlite3.Connection, run_id: str, rows: Sequence[Sequence[Any]],
) -> None:
    """``INSERT OR IGNORE`` sequence rows ``(name, step, wall_time,
    object_type, scalar_value, artifact_hash, metadata)`` for ``run_id`` and
    fold the ones actually inserted into ``metric_stats``. Run it inside the
    caller's IMMEDIATE transaction: it reads before it writes.

    A point already stored at its step is kept, and the re-sent one must not
    count. The usual batch has no such point, which ``total_changes`` shows
    for free: then the inserted rows are exactly ``rows`` (numbers as SQLite
    stores them in a REAL column). Otherwise they are read back by rowid: ``sequences`` has no AUTOINCREMENT, so a new row's
    rowid is above every rowid present when the insert began.
    """
    if not rows:
        return
    (top,) = con.execute("SELECT COALESCE(MAX(rowid), 0) FROM sequences").fetchone()
    before = con.total_changes
    con.executemany(
        """
        INSERT OR IGNORE INTO sequences (
            run_id, name, step, wall_time,
            object_type, scalar_value, artifact_hash, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(run_id, *r) for r in rows],
    )
    if con.total_changes - before == len(rows) and all(
        r[4] is None or isinstance(r[4], (int, float)) for r in rows
    ):
        inserted: Iterable[Sequence[Any]] = (
            (r[0], r[1], _stored(r[4])) for r in rows
        )
    else:
        inserted = con.execute(
            "SELECT name, step, scalar_value FROM sequences WHERE rowid > ?", [top],
        ).fetchall()
    apply_inserted(con, run_id, inserted)


def _stored(value: Any) -> float | None:
    """A scalar as SQLite stores it in a REAL column: NaN becomes NULL,
    an int becomes a float."""
    if value is None:
        return None
    value = float(value)
    return None if math.isnan(value) else value
