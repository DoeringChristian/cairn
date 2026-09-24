"""Runs list + detail read endpoints."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query, Request

from ..storage.db import Database
from ..summary_rules import resolve_summary_rules
from ._common import api_run_row, get_data_dir, get_db, require_run

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["runs"])

# Runs with status "running" and no heartbeat for this many seconds
# are auto-transitioned to "killed" at query time.
STALE_HEARTBEAT_SECONDS = 120


def _reap_stale_runs(db: Any, data_dir: Any = None) -> None:
    """Mark running runs as killed if their heartbeat is too old.

    Also removes stale WAL lock files so the ingestion thread can
    do a full ingest and rename the WAL to .done.
    """
    cutoff = datetime.now(timezone.utc).isoformat()
    stale = db.read_columns(
        """SELECT id FROM runs
           WHERE status = 'running'
             AND (
               (last_heartbeat IS NOT NULL
                AND julianday('now') - julianday(last_heartbeat) > ?/86400.0)
               OR
               (last_heartbeat IS NULL
                AND julianday('now') - julianday(created_at) > ?/86400.0)
             )""",
        [STALE_HEARTBEAT_SECONDS, STALE_HEARTBEAT_SECONDS],
    )
    if stale:
        for row in stale:
            run_id = row["id"]
            db.write(
                "UPDATE runs SET status = 'killed', ended_at = ? WHERE id = ?",
                [cutoff, run_id],
            )
            # Remove stale WAL lock file so ingestion can finalize.
            if data_dir is not None:
                lock_path = data_dir.root / "wals" / f"{run_id}.lock"
                if lock_path.exists():
                    lock_path.unlink(missing_ok=True)
                    _log.info("removed stale WAL lock for killed run %s", run_id[:8])


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
                    "{key: value} map of the run's config (values JSON-decoded).",
    ),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    db = get_db(request)
    dd = get_data_dir(request)

    # Auto-kill stale "running" runs before listing.
    _reap_stale_runs(db, dd)

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
    # Exclude env_snapshot from list responses — it's large and only needed
    # on the run detail page.  SELECT * would include it for every row.
    rows = db.read_columns(
        f"""SELECT id, project_id, display_name, created_at, ended_at, status,
                   exit_code, git_sha, git_dirty, git_branch, git_remote, cli_args,
                   hostname, "user", tags, notes, last_heartbeat,
                   parent_run_id, fork_step, data_epoch, run_group, job_type,
                   sweep_id, stop_requested
            FROM runs {where} ORDER BY created_at DESC LIMIT ? OFFSET ?""",
        [*params, limit, offset],
    )
    (total,) = db.read_one(f"SELECT COUNT(*) FROM runs {where}", params) or (0,)
    run_ids = [r["id"] for r in rows]
    resolved = _resolved_values(db, run_ids)
    extras = {part.strip() for part in (include or "").split(",") if part.strip()}
    run_params = _params_by_run(db, run_ids) if "params" in extras else None
    for row in rows:
        api_run_row(row)
        row["values"] = resolved.get(row["id"], {})
        if run_params is not None:
            row["params"] = run_params.get(row["id"], {})
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


def _resolved_values(
    db: Database, run_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """What the run table shows per run: last metric, summary wins.

    Two sources, one column set. A scalar sequence contributes its LAST point,
    which is what "acc" usually means in a table; an explicit ``summary`` key of
    the same name replaces it, because the author saying "this is the number"
    outranks whatever the series happened to end on (early stopping, a final
    eval batch, a crash mid-epoch).

    The merge lives here rather than at ingest so summary stays a record of what
    was DECLARED. Auto-filling it on every track() would make this preference
    unobservable and leave no way to tell a claim from a leftover.

    Two queries for the whole page, not two per run: a run table is the one
    place where an N+1 is guaranteed to be N=limit.
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, Any]] = {rid: {} for rid in run_ids}

    # Last scalar point per (run, name). MAX(step) can tie across contexts;
    # either tied row is an equally good "last", so the dict keeps one.
    for r in db.read_columns(
        f"""SELECT s.run_id AS run_id, s.name AS name, s.scalar_value AS value
              FROM sequences s
              JOIN (SELECT run_id, name, MAX(step) AS step
                      FROM sequences
                     WHERE run_id IN ({holes}) AND scalar_value IS NOT NULL
                     GROUP BY run_id, name) m
                ON s.run_id = m.run_id AND s.name = m.name AND s.step = m.step
             WHERE s.scalar_value IS NOT NULL""",
        list(run_ids),
    ):
        out[r["run_id"]][r["name"]] = r["value"]

    # define_metric(summary=...) rules replace the last point...
    for rid, values in resolve_summary_rules(db, run_ids).items():
        out[rid].update(values)

    # ...and an explicit summary key replaces both.
    for r in db.read_columns(
        f"SELECT run_id, key, value FROM summary WHERE run_id IN ({holes})",
        list(run_ids),
    ):
        out[r["run_id"]][r["key"]] = json.loads(r["value"])
    return out


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    run = require_run(db, run_id)
    params = db.read_columns(
        "SELECT key, value, value_type FROM params WHERE run_id = ? ORDER BY key",
        [run_id],
    )
    summary = db.read_columns(
        "SELECT key, value, value_type FROM summary WHERE run_id = ? ORDER BY key",
        [run_id],
    )
    metric_defs = db.read_columns(
        "SELECT name, step_metric, summary FROM metric_defs WHERE run_id = ? ORDER BY name",
        [run_id],
    )
    run["values"] = _resolved_values(db, [run_id])[run_id]
    return {"run": run, "params": params, "summary": summary, "metric_defs": metric_defs}
