"""Hyperparameter sweeps: create/list/get, pause/resume/stop/cancel, and the
worker protocol (``/next`` claims a trial, ``/report`` records its outcome).
The logic lives in ``sweep_ops``; every mutation needs the write role."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

from .. import auth, sweep_ops
from ._common import get_db, slugify

router = APIRouter(prefix="/api", tags=["sweeps"])
_write = Depends(auth.require_role("write"))


class SweepCreate(BaseModel):
    #: Unknown keys are kept so ``create_sweep`` can name them in its error.
    model_config = ConfigDict(extra="allow")

    project: str
    #: The search space (wandb's ``parameters`` block).
    parameters: dict[str, Any]
    method: str = "random"
    metric: str | None = None
    goal: str | None = None
    command: str | list[str] | None = None
    program: str | None = None
    run_cap: int | None = None
    description: str | None = None
    name: str | None = None
    sweep_id: str | None = None
class TrialReport(BaseModel):
    run_id: str | None = None
    value: float | None = None
    status: str | None = None


def _call(fn: Any, *args: Any, **kwargs: Any) -> Any:
    try:
        return fn(*args, **kwargs)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sweeps", dependencies=[_write])
def create_sweep(body: SweepCreate, request: Request) -> dict[str, Any]:
    _call(sweep_ops.check_keys, body.model_extra or {})
    return _call(
        sweep_ops.create_sweep, get_db(request),
        project=body.project, space=body.parameters, method=body.method,
        metric=body.metric, goal=body.goal, command=body.command, program=body.program,
        run_cap=body.run_cap, description=body.description, name=body.name,
        sweep_id=body.sweep_id,
    )


@router.get("/sweeps")
def list_sweeps(request: Request, project: str | None = Query(default=None)) -> dict[str, Any]:
    return {"sweeps": sweep_ops.list_sweeps(get_db(request), slugify(project) if project else None)}


@router.get("/sweeps/{sweep_id}")
def get_sweep(sweep_id: str, request: Request) -> dict[str, Any]:
    return _call(sweep_ops.get_sweep, get_db(request), sweep_id)


@router.post("/sweeps/{sweep_id}/next", dependencies=[_write])
def next_trial(sweep_id: str, request: Request) -> dict[str, Any]:
    """Claim a trial: ``{"status", "trial"}``; ``trial`` is null unless running."""
    return _call(sweep_ops.next_trial, get_db(request), sweep_id)


@router.post("/sweeps/{sweep_id}/{action}", dependencies=[_write])
def sweep_action(sweep_id: str, action: str, request: Request) -> dict[str, Any]:
    """``pause`` / ``resume`` / ``stop`` / ``cancel``."""
    if action not in sweep_ops.ACTIONS:
        raise HTTPException(status_code=404, detail=f"unknown sweep action {action!r}")
    return _call(sweep_ops.set_status, get_db(request), sweep_id, action)


@router.post("/sweeps/{sweep_id}/trials/{trial_id}/report", dependencies=[_write])
def report_trial(sweep_id: str, trial_id: str, body: TrialReport, request: Request) -> dict[str, Any]:
    return _call(
        sweep_ops.report_trial, get_db(request), sweep_id, trial_id,
        run_id=body.run_id, value=body.value, status=body.status,
    )
