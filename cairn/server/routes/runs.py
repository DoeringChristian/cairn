"""Runs list + detail read endpoints."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .. import auth, config_doc
from ..storage.db import Database
from ..run_query import RUN_LIST_COLUMNS, RunQueryError, docs_by_run, select_runs
from ..summary_rules import resolved_values
from ._common import api_run_row, get_db, require_run

router = APIRouter(prefix="/api", tags=["runs"])

def _extras(include: str | list[str] | None) -> set[str]:
    if include is None:
        return set()
    parts = include.split(",") if isinstance(include, str) else include
    return {p.strip() for p in parts if p.strip()}


def _decorate(db: Database, rows: list[dict[str, Any]], extras: set[str]) -> None:
    """Add the requested per-run extras to a page of rows (one query each)."""
    run_ids = [r["id"] for r in rows]
    run_params = _params_by_run(db, run_ids) if "params" in extras else None
    run_stats = _metric_stats(db, run_ids) if "stats" in extras else None
    docs = docs_by_run(db, run_ids) if "config" in extras else None
    for row in rows:
        if run_params is not None:
            row["params"] = run_params.get(row["id"], {})
        if run_stats is not None:
            row["stats"] = run_stats.get(row["id"], {})
        if docs is not None:
            d = docs.get(row["id"], {})
            row["config_doc"] = config_doc.json_safe(d.get("config", {}))
            # Summary MEDIA values are not table values: left out here (the
            # run's own page, get_run, shows them).
            row["summary_doc"] = config_doc.json_safe(config_doc.without_media(d.get("summary", {})))


def _archived_param(value: str) -> bool | None:
    if value == "false":
        return False
    if value == "true":
        return True
    if value == "all":
        return None
    raise HTTPException(status_code=400, detail="archived must be false, true or all")


@router.get("/runs")
def list_runs(
    request: Request,
    project: str | None = Query(default=None),
    status: str | None = Query(default=None),
    group: str | None = Query(default=None),
    job_type: str | None = Query(default=None),
    sweep_id: str | None = Query(default=None),
    ids: str | None = Query(
        default=None,
        description="Comma-separated run ids: only these runs (the UI's poll "
                    "of its running runs).",
    ),
    archived: str = Query(
        default="false",
        description="'false' (default) leaves archived runs out, 'true' lists "
                    "only them, 'all' both.",
    ),
    sort: str = Query(
        default="created_at",
        description="created_at | ended_at | duration | name | version | status | id | "
                    "config.<path> | summary.<path> | metrics.<name>",
    ),
    desc: bool = Query(default=False),
    include: str | None = Query(
        default=None,
        description="Comma-separated extras per run: 'params' adds a "
                    "{key: value} map of the run's config (flat dotted keys, values "
                    "JSON-decoded); 'config' adds the nested 'config_doc' and "
                    "'summary_doc'; 'stats' adds per-metric scalar statistics "
                    "(see _metric_stats).",
    ),
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Runs, ordered and paged by the shared evaluator (``run_query``)."""
    db = get_db(request)
    spec: dict[str, Any] = {
        "project": project, "status": status, "group": group, "job_type": job_type,
        "sweep_id": sweep_id, "archived": _archived_param(archived),
        "sort": {"key": sort, "desc": desc}, "limit": limit, "offset": offset,
    }
    if ids is not None:
        spec["ids"] = [i for i in (part.strip() for part in ids.split(",")) if i]
    try:
        rows, total = select_runs(db, spec)
    except RunQueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    _decorate(db, rows, _extras(include))
    return {"runs": rows, "total": total, "limit": limit, "offset": offset}


class RunQueryBody(BaseModel):
    """``POST /api/runs/query``: the reader's ``RunQuery`` on the wire."""

    project: str | None = None
    #: False: not archived (default); True: only archived; None: both.
    archived: bool | None = False
    status: str | None = None
    #: ``[field, op, sub, value]``; see ``run_query``.
    predicates: list[list[Any]] = Field(default_factory=list)
    where: list[str] = Field(default_factory=list)
    sort: dict[str, Any] | None = None
    #: Reverse the final order (``RunQuery.last``).
    reverse: bool = False
    limit: int | None = Field(default=None, ge=0)
    offset: int = Field(default=0, ge=0)
    include: list[str] = Field(default_factory=list)


@router.post("/runs/query")
def query_runs(body: RunQueryBody, request: Request) -> dict[str, Any]:
    """Evaluate a run query (``run_query.select_runs``) -> ``{runs, total}``."""
    db = get_db(request)
    spec = body.model_dump(exclude={"include"})
    try:
        rows, total = select_runs(db, spec)
    except RunQueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    _decorate(db, rows, _extras(body.include))
    return {"runs": rows, "total": total}


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

    One query for the whole page, over ``metric_stats`` (maintained at
    ingest; see ``storage/metric_stats.py``). ``first``/``last`` are the
    values at the lowest/highest step; ``rule`` is the run's
    ``metric_defs.summary`` for the name (min|max|mean|last, or None). Points
    without a scalar value (media, NaN) are ignored, so non-scalar sequences
    never appear.
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, dict[str, Any]]] = {rid: {} for rid in run_ids}
    for r in db.read_columns(
        f"""SELECT s.run_id AS run_id, s.name AS name, s.count AS count,
                   s.first_value AS first, s.last_value AS last,
                   s.min AS min, s.max AS max, s.sum / s.count AS mean,
                   s.first_step AS first_step, s.last_step AS last_step,
                   d.summary AS rule
              FROM metric_stats s
              LEFT JOIN metric_defs d
                ON d.run_id = s.run_id AND d.name = s.name
             WHERE s.run_id IN ({holes})""",
        list(run_ids),
    ):
        rid, name = r.pop("run_id"), r.pop("name")
        out[rid][name] = r
    return out


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    db = get_db(request)
    run = require_run(db, run_id)
    docs = docs_by_run(db, [run_id]).get(run_id, {})
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
    return {
        "run": run, "params": params, "summary": summary, "metric_defs": metric_defs,
        # The nested documents as logged; ``params`` / ``summary`` are their
        # flat index. A summary MEDIA value is its marker leaf
        # ``{"$media": {hash, object_type, mime_type, caption?}}`` (the
        # Overview shows a thumbnail of it); it has no flat row, and it is
        # also a series of the run (``/sequences``, ``"summary": true``).
        "config_doc": config_doc.json_safe(docs.get("config", {})),
        "summary_doc": config_doc.json_safe(docs.get("summary", {})),
    }


@router.get("/runs/{run_id}/documents")
def get_run_documents(run_id: str, request: Request) -> Response:
    """The run's config and summary documents exactly as stored:
    ``{"config": {...}, "summary": {...}}``. Python's JSON dialect: a NaN or
    infinite float is the bare token ``NaN`` / ``Infinity`` (the reader's
    exact round trip); ``/api/runs/{id}`` carries browser-safe copies."""
    db = get_db(request)
    require_run(db, run_id)
    row = db.read_one("SELECT config, summary FROM runs WHERE id = ?", [run_id])
    body = '{"config":%s,"summary":%s}' % (row[0] or "{}", row[1] or "{}")
    return Response(content=body, media_type="application/json")
