"""Compare endpoint: returns aligned series for a set of runs + metrics."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ._common import get_db

router = APIRouter(prefix="/api", tags=["compare"])


class CompareRequest(BaseModel):
    run_ids: list[str]
    # None means every scalar sequence of the runs.
    metrics: list[str] | None = None


@router.post("/compare")
def compare(body: CompareRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    if not body.run_ids or body.metrics == []:
        return {"series": []}
    return {"series": scalar_series(db, body.run_ids, body.metrics)}


from cairn.backend.series import scalar_series
