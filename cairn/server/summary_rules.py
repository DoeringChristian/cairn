"""Read-time summary rules (the ``metric_defs`` table).

A run's metric normally resolves to its LAST point. A rule set with
``run.track(value, name, step, summary="min"|"max"|"mean"|"last")`` overrides
that for exactly that name. Rules apply at read time (from the
``metric_stats`` aggregates) and never write the ``summary`` table, so an
explicit ``run.summary()`` key of the same name still wins over them.
"""

from __future__ import annotations

import json
from typing import Any

from .storage.db import Database

SUMMARY_KINDS = ("min", "max", "mean", "last")


def resolve_summary_rules(
    db: Database, run_ids: list[str],
) -> dict[str, dict[str, float | None]]:
    """``{run_id: {metric: value}}`` for every scalar metric a rule covers.

    "last" rules are included too, so a caller can treat the result as the
    resolved value of every ruled metric. Runs without rules are absent.
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, float | None]] = {}
    for r in db.read_columns(
        f"""SELECT s.run_id AS run_id, s.name AS name, d.summary AS kind,
                   s.min AS min, s.max AS max, s.sum / s.count AS mean,
                   s.last_value AS last
              FROM metric_defs d
              JOIN metric_stats s ON s.run_id = d.run_id AND s.name = d.name
             WHERE d.run_id IN ({holes}) AND d.summary IS NOT NULL""",
        list(run_ids),
    ):
        out.setdefault(r["run_id"], {})[r["name"]] = r[r["kind"]]
    return out


def resolved_values(
    db: Database, run_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """What the run table shows per run (``run.values``, the reader's
    ``Run.final``): last metric, summary wins.

    Two sources, one column set. A scalar sequence contributes its LAST point,
    which is what "acc" usually means in a table; an explicit ``summary`` key of
    the same name replaces it, because the author saying "this is the number"
    outranks whatever the series happened to end on (early stopping, a final
    eval batch, a crash mid-epoch).

    The merge lives here rather than at ingest so summary stays a record of what
    was DECLARED. Auto-filling it on every track() would make this preference
    unobservable and leave no way to tell a claim from a leftover.

    A few queries for the whole page, not a few per run: a run table is the
    one place where an N+1 is guaranteed to be N=limit. The metric side reads
    ``metric_stats`` (maintained at ingest), so the cost is per metric, not
    per point.
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, Any]] = {rid: {} for rid in run_ids}

    # Last scalar point per (run, name).
    for r in db.read_columns(
        f"SELECT run_id, name, last_value FROM metric_stats WHERE run_id IN ({holes})",
        list(run_ids),
    ):
        out[r["run_id"]][r["name"]] = r["last_value"]

    # run.track(..., summary=...) rules replace the last point...
    for rid, values in resolve_summary_rules(db, run_ids).items():
        out[rid].update(values)

    # ...and an explicit summary key replaces both.
    for r in db.read_columns(
        f"SELECT run_id, key, value FROM summary WHERE run_id IN ({holes})",
        list(run_ids),
    ):
        out[r["run_id"]][r["key"]] = json.loads(r["value"])
    return out
