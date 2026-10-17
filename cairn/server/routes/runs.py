"""Runs list + detail read endpoints."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from cairn.server import auth
from cairn.backend import config_doc
from cairn.backend.storage.db import Database
from cairn.backend.run_query import RUN_LIST_COLUMNS, RunQueryError, docs_by_run, select_runs
from cairn.backend.metric_rules import resolved_values
from cairn.backend import artifact_registry_ops as artifact_ops
from cairn.backend.common import api_run_row
from cairn.server.routes._common import get_db, require_run
from .artifact_registry import with_files
from .sequences import sequence_catalogues

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






@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> dict[str, Any]:
    details = run_details(get_db(request), [run_id], share=False)
    if run_id not in details:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return details[run_id]






#: Most runs one ``POST /api/runs/batch`` may ask for (the UI sends 200).
RUNS_BATCH_LIMIT = 1000
#: What ``POST /api/runs/batch`` can return per run.
RUNS_BATCH_PARTS = ("run", "sequences", "outputs")


class RunsBatchBody(BaseModel):
    """``POST /api/runs/batch``: what to read for which runs."""

    ids: list[str] = Field(max_length=RUNS_BATCH_LIMIT)
    #: Per run: ``run`` (``GET /api/runs/{id}``), ``sequences`` (``GET
    #: /api/runs/{id}/sequences``), ``outputs`` (``GET
    #: /api/runs/{id}/outputs?include=files``).
    include: list[str] = Field(default_factory=lambda: list(RUNS_BATCH_PARTS))


@router.post("/runs/batch")
def runs_batch(body: RunsBatchBody, request: Request) -> dict[str, Any]:
    """Many runs' per-run reads in one request (a workspace bound to a
    thousand runs): ``{"runs": {id: {run?, sequences?, outputs?}},
    "missing": [id], "forbidden": [id]}``. Each part is exactly what its
    per-run route returns for that run (``run``: the ``GET /api/runs/{id}``
    body; ``sequences``: its ``sequences`` list; ``outputs``: its
    ``outputs`` list, with ``files``). ``missing``: ids of no run;
    ``forbidden``: through a share link, the ids outside the shared report
    (the per-run routes' 403), never read.
    """
    unknown = sorted(set(body.include) - set(RUNS_BATCH_PARTS))
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown include {unknown}; one of {list(RUNS_BATCH_PARTS)}")
    ids = list(dict.fromkeys(body.ids))
    forbidden: list[str] = []
    db = get_db(request)
    details = run_details(db, ids, share=False)
    found = [rid for rid in ids if rid in details]
    out: dict[str, dict[str, Any]] = {rid: {} for rid in found}
    if "run" in body.include:
        for rid in found:
            out[rid]["run"] = details[rid]
    if "sequences" in body.include:
        for rid, seqs in sequence_catalogues(db, found).items():
            out[rid]["sequences"] = seqs
    if "outputs" in body.include:
        outputs = artifact_ops.runs_outputs(db, found)
        with_files(db, [v for vs in outputs.values() for v in vs])
        for rid, vs in outputs.items():
            out[rid]["outputs"] = vs
    return {"runs": out, "missing": [rid for rid in ids if rid not in details], "forbidden": forbidden}


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

from cairn.backend.run_reads import _params_by_run, _metric_stats, _rows_by_run, run_details


@router.get('/runs/{run_id}/snapshot')
def snapshot_run(run_id: str, request: Request, revision: str | None = None):
    from cairn.backend.snapshots import capture_run
    try:
        return capture_run(get_db(request), run_id, revision)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


class RunEditBody(BaseModel):
    expected_revision: int
    changes: dict[str, Any]
    delete: dict[str, list[str]] | None = None


def _edit_call(function, *args, **kwargs):
    from cairn.backend.revisions import RevisionConflict
    try:
        return function(*args, **kwargs)
    except RevisionConflict as exc:
        raise HTTPException(409, {'message': str(exc), 'revision': exc.actual}) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/runs/{run_id}/edit')
def read_edit(run_id: str, request: Request):
    from cairn.backend.run_edits import read
    return _edit_call(read, get_db(request), run_id)


@router.patch('/runs/{run_id}/edit')
def edit_run(run_id: str, body: RunEditBody, request: Request):
    from cairn.backend.run_edits import edit
    return _edit_call(edit, get_db(request), run_id, **body.model_dump())


@router.get('/runs/{run_id}/revisions')
def run_revisions(run_id: str, request: Request, limit: int = 100, before: int | None = None):
    from cairn.backend.revisions import history
    return {'revisions': history(get_db(request), 'run', run_id, limit=limit, before=before)}
