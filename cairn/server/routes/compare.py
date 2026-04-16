"""Compare endpoint: returns aligned series for a set of runs + metrics."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from ._common import get_db

router = APIRouter(prefix="/api", tags=["compare"])


class CompareRequest(BaseModel):
    run_ids: list[str]
    metrics: list[str]
    max_points: int | None = None


@router.post("/compare")
def compare(body: CompareRequest, request: Request) -> dict[str, Any]:
    db = get_db(request)
    if not body.run_ids or not body.metrics:
        return {"series": []}
    placeholders_runs = ",".join(["?"] * len(body.run_ids))
    placeholders_metrics = ",".join(["?"] * len(body.metrics))
    rows = db.read_columns(
        f"""
        SELECT run_id, name, step, scalar_value, context
        FROM sequences
        WHERE run_id IN ({placeholders_runs})
          AND name IN ({placeholders_metrics})
          AND object_type = 'scalar'
        ORDER BY run_id, name, step
        """,
        [*body.run_ids, *body.metrics],
    )
    # Group into (run_id, name) buckets.
    series: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        series.setdefault((r["run_id"], r["name"]), []).append(
            {"step": r["step"], "value": r["scalar_value"], "context": r["context"]}
        )
    return {
        "series": [
            {"run_id": rid, "name": name, "points": pts}
            for (rid, name), pts in series.items()
        ]
    }
