from __future__ import annotations
import json
from typing import Any
from cairn.backend import config_doc
from cairn.backend.storage.db import Database
from cairn.backend.run_query import docs_by_run
from cairn.backend.metric_rules import resolved_values
from cairn.backend.common import api_run_row

def _params_by_run(db: Database, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Each run's params as ``{key: decoded value}``, one query for the page."""
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, Any]] = {rid: {} for rid in run_ids}
    for r in db.read_columns(
        f"SELECT run_id, key, value FROM params WHERE run_id IN ({holes})",
        list(run_ids),
    ):
        out[r["run_id"]][r["key"]] = json.loads(r["value"])
    return out

def _metric_stats(
    db: Database, run_ids: list[str]
) -> dict[str, dict[str, dict[str, Any]]]:
    """Per run, per scalar metric: ``{count, first, last, min, max, mean,
    first_step, last_step}``.

    One query for the whole page, over ``metric_stats`` (maintained at
    ingest; see ``storage/metric_stats.py``). ``first``/``last`` are the
    values at the lowest/highest step. Points without a scalar value (media,
    NaN) are ignored, so non-scalar sequences never appear. The metric's
    rule is the project's (``GET /api/projects/{p}/metric-rules``).
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, dict[str, Any]]] = {rid: {} for rid in run_ids}
    for r in db.read_columns(
        f"""SELECT run_id, name, count, first_value AS first, last_value AS last,
                   min, max, sum / count AS mean, first_step, last_step
              FROM metric_stats
             WHERE run_id IN ({holes})""",
        list(run_ids),
    ):
        rid, name = r.pop("run_id"), r.pop("name")
        out[rid][name] = r
    return out

def _rows_by_run(db: Database, sql: str, run_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """``sql`` (``... WHERE run_id IN ({holes}) ...``, selecting ``run_id``
    first) per run, the ``run_id`` column dropped, one query per 500 runs."""
    out: dict[str, list[dict[str, Any]]] = {rid: [] for rid in run_ids}
    for i in range(0, len(run_ids), 500):
        chunk = run_ids[i:i + 500]
        for r in db.read_columns(sql.format(holes=",".join("?" * len(chunk))), chunk):
            out[r.pop("run_id")].append(r)
    return out

def run_details(db: Database, run_ids: list[str], *, share: bool = False) -> dict[str, dict[str, Any]]:
    """``{run_id: GET /api/runs/{id} body}`` for the runs that exist (an
    unknown id is left out), a few queries for the lot. ``share``: the
    caller is a share link, which never sees a run's environment."""
    runs: dict[str, dict[str, Any]] = {}
    for i in range(0, len(run_ids), 500):
        chunk = run_ids[i:i + 500]
        for row in db.read_columns(f"SELECT * FROM runs WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            runs[row["id"]] = api_run_row(row)
    ids = [rid for rid in run_ids if rid in runs]
    if not ids:
        return {}
    docs = docs_by_run(db, ids)
    params = _rows_by_run(
        db, "SELECT run_id, key, value, value_type FROM params WHERE run_id IN ({holes}) ORDER BY run_id, key", ids,
    )
    summary = _rows_by_run(
        db, "SELECT run_id, key, value, value_type FROM summary WHERE run_id IN ({holes}) ORDER BY run_id, key", ids,
    )
    metric_defs = _rows_by_run(
        db, "SELECT run_id, name, x, summary FROM metric_defs WHERE run_id IN ({holes}) ORDER BY run_id, name", ids,
    )
    values = resolved_values(db, ids)
    stats = _metric_stats(db, ids)
    out: dict[str, dict[str, Any]] = {}
    for rid in ids:
        run = runs[rid]
        if share:
            run.pop("env_snapshot", None)
        run["values"] = values[rid]
        run["stats"] = stats[rid]
        d = docs.get(rid, {})
        out[rid] = {
            "run": run, "params": params[rid], "summary": summary[rid], "metric_defs": metric_defs[rid],
            # The nested documents as logged; ``params`` / ``summary`` are their
            # flat index. A summary MEDIA value is its marker leaf
            # ``{"$media": {hash, object_type, mime_type, caption?}}`` (the
            # Overview shows a thumbnail of it); it has no flat row, and it is
            # also a series of the run (``/sequences``, ``"summary": true``).
            "config_doc": config_doc.json_safe(d.get("config", {})),
            "summary_doc": config_doc.json_safe(d.get("summary", {})),
        }
    return out
