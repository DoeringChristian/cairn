"""General record lookup; the same domain queries serve Python and the UI."""
import json
from fastapi import APIRouter, HTTPException, Request
from cairn.backend import records
from ._common import get_db

router = APIRouter(prefix="/api/runs", tags=["records"])


def _call(function, request, run_id, **kwargs):
    try:
        if isinstance(kwargs.get("where"), str):
            kwargs["where"] = json.loads(kwargs["where"])
        return function(get_db(request), run_id, **kwargs)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/{run_id}/records")
def page(run_id: str, request: Request, limit: int = 100, cursor: int = 0, where: str | None = None):
    return _call(records.page, request, run_id, limit=limit, cursor=cursor, where=where)


@router.get("/{run_id}/record-fields")
def fields(run_id: str, request: Request):
    return _call(records.fields, request, run_id)


@router.get("/{run_id}/record-series")
def series(run_id: str, request: Request, key: str, x: str | None = "step",
           where: str | None = None, max_points: int = 1200):
    return _call(records.series, request, run_id, key=key, x=x, where=where, max_points=max_points)
