"""Runs list + detail read endpoints."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Query, Request

from .. import auth
from ..storage.db import Database
from ..summary_rules import resolved_values
from ._common import api_run_row, get_db, require_run

router = APIRouter(prefix="/api", tags=["runs"])

#: A run row as run lists return it: every column but ``env_snapshot``, which
#: is large and only shown on the run page.
RUN_LIST_COLUMNS = """id, project_id, display_name, created_at, ended_at, status,
                   exit_code, git_sha, git_dirty, git_branch, git_remote, cli_args,
                   hostname, "user", tags, notes, last_heartbeat,
                   parent_run_id, fork_step, data_epoch, run_group, job_type,
                   sweep_id, stop_requested"""


@router.get("/runs")
def list_runs(
    request: Request,
    project: str | None = Query(default=None),
    status: str | None = Query(default=None),
    group: str | None = Query(default=None),
    job_type: str | None = Query(default=None),
    sweep_id: str | None = Query(default=None),
    include: str | None = Query(
        default=None,
        description="Comma-separated extras per run: 'params' adds a "
                    "{key: value} map of the run's config (values JSON-decoded); "
                    "'stats' adds per-metric scalar statistics (see _metric_stats).",
    ),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = get_db(request)

    clauses: list[str] = []
    params: list[Any] = []
    for column, value in (
        ("project_id", project),
        ("status", status),
        ("run_group", group),
        ("job_type", job_type),
        ("sweep_id", sweep_id),
    ):
        if value:
            clauses.append(f"{column} = ?")
            params.append(value)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.read_columns(
        f"""SELECT {RUN_LIST_COLUMNS}
            FROM runs {where} ORDER BY created_at DESC LIMIT ? OFFSET ?""",
        [*params, limit, offset],
    )
    (total,) = db.read_one(f"SELECT COUNT(*) FROM runs {where}", params) or (0,)
    run_ids = [r["id"] for r in rows]
    resolved = resolved_values(db, run_ids)
    extras = {part.strip() for part in (include or "").split(",") if part.strip()}
    run_params = _params_by_run(db, run_ids) if "params" in extras else None
    run_stats = _metric_stats(db, run_ids) if "stats" in extras else None
    for row in rows:
        api_run_row(row)
        row["values"] = resolved.get(row["id"], {})
        if run_params is not None:
            row["params"] = run_params.get(row["id"], {})
        if run_stats is not None:
            row["stats"] = run_stats.get(row["id"], {})
    return {"runs": rows, "total": total, "limit": limit, "offset": offset}


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
    first_step, last_step, rule}``.

    One grouped query for the whole page. ``first``/``last`` are the values at
    the lowest/highest step (primary-key lookups on the aggregate's steps);
    ``rule`` is the run's ``metric_defs.summary`` for the name (min|max|mean|
    last, or None). Points without a scalar value (media, NaN) are ignored,
    so non-scalar sequences never appear.
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, dict[str, Any]]] = {rid: {} for rid in run_ids}
    for r in db.read_columns(
        f"""SELECT g.run_id AS run_id, g.name AS name, g.count AS count,
                   f.scalar_value AS first, l.scalar_value AS last,
                   g.min AS min, g.max AS max, g.mean AS mean,
                   g.first_step AS first_step, g.last_step AS last_step,
                   d.summary AS rule
              FROM (SELECT run_id, name, COUNT(*) AS count,
                           MIN(scalar_value) AS min, MAX(scalar_value) AS max,
                           AVG(scalar_value) AS mean,
                           MIN(step) AS first_step, MAX(step) AS last_step
                      FROM sequences
                     WHERE run_id IN ({holes}) AND scalar_value IS NOT NULL
                     GROUP BY run_id, name) g
              JOIN sequences f
                ON f.run_id = g.run_id AND f.name = g.name AND f.step = g.first_step
              JOIN sequences l
                ON l.run_id = g.run_id AND l.name = g.name AND l.step = g.last_step
              LEFT JOIN metric_defs d
                ON d.run_id = g.run_id AND d.name = g.name""",
        list(run_ids),
    ):
        rid, name = r.pop("run_id"), r.pop("name")
        out[rid][name] = r
    return out


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    run = require_run(db, run_id)
    if auth.request_share(request) is not None:
        # A share link never reveals a run's environment.
        run.pop("env_snapshot", None)
    params = db.read_columns(
        "SELECT key, value, value_type FROM params WHERE run_id = ? ORDER BY key",
        [run_id],
    )
    summary = db.read_columns(
        "SELECT key, value, value_type FROM summary WHERE run_id = ? ORDER BY key",
        [run_id],
    )
    metric_defs = db.read_columns(
        "SELECT name, x, summary FROM metric_defs WHERE run_id = ? ORDER BY name",
        [run_id],
    )
    run["values"] = resolved_values(db, [run_id])[run_id]
    run["stats"] = _metric_stats(db, [run_id])[run_id]
    return {"run": run, "params": params, "summary": summary, "metric_defs": metric_defs}
