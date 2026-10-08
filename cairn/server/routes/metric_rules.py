"""A project's metric rules (``cairn.server.metric_rules``).

* ``GET /api/projects/{p}/metric-rules`` -> ``{logged: {metric: summary},
  overrides: {metric: {summary, goal}}, rules: {metric: {summary, goal}}}``:
  the logged rules (the newest run's ``track(..., summary=)`` per metric),
  the project's overrides and the effective rule of every metric that has
  either. Read role; a share link sees only its report's runs and metrics.
* ``PUT /api/projects/{p}/metric-rules/{metric}`` with ``{summary, goal}``
  (each a kind or null = not overridden) sets the override; both null
  removes it. Write role.
* ``DELETE /api/projects/{p}/metric-rules/{metric}`` removes the override.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import auth, metric_rules
from ._common import get_db, slugify

router = APIRouter(prefix="/api", tags=["metric-rules"])
_write = Depends(auth.require_role("write"))


def _project(request: Request, project_id: str) -> str:
    try:
        pid = slugify(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if get_db(request).read_one("SELECT 1 FROM projects WHERE id = ?", [pid]) is None:
        raise HTTPException(status_code=404, detail=f"project {pid} not found")
    return pid


def _document(request: Request, project: str) -> dict[str, Any]:
    db = get_db(request)
    grant = auth.request_share(request)
    if grant is None:
        return metric_rules.rules_document(db, project)
    run_ids = sorted(auth.share_scope(request, grant).run_ids)
    names: set[str] = set()
    if run_ids:
        holes = ",".join("?" * len(run_ids))
        names = {r[0] for r in db.read(
            f"SELECT DISTINCT name FROM metric_stats WHERE run_id IN ({holes})", run_ids,
        )}
    return metric_rules.rules_document(db, project, run_ids, names)


@router.get("/projects/{project_id}/metric-rules")
def get_metric_rules(project_id: str, request: Request) -> dict[str, Any]:
    """The project's logged rules, overrides and effective rules."""
    return _document(request, _project(request, project_id))


class OverrideBody(BaseModel):
    #: min | max | mean | last; null: not overridden.
    summary: str | None = None
    #: lower | higher | none; null: not overridden.
    goal: str | None = None


@router.put("/projects/{project_id}/metric-rules/{name:path}", dependencies=[_write])
def put_metric_rule(project_id: str, name: str, body: OverrideBody, request: Request) -> dict[str, Any]:
    """Override one metric's summary and/or goal -> the project's rules."""
    project = _project(request, project_id)
    try:
        metric_rules.set_override(get_db(request), project, name, summary=body.summary, goal=body.goal)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return _document(request, project)


@router.delete("/projects/{project_id}/metric-rules/{name:path}", dependencies=[_write])
def delete_metric_rule(project_id: str, name: str, request: Request) -> dict[str, Any]:
    """Back to the logged rule -> the project's rules."""
    project = _project(request, project_id)
    metric_rules.set_override(get_db(request), project, name, summary=None, goal=None)
    return _document(request, project)
