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


def scalar_series(db: Any, run_ids: list[str], metrics: list[str] | None) -> list[dict[str, Any]]:
    """Scalar points of ``run_ids`` grouped per ``(run_id, name)``, in one
    query; ``metrics=None`` selects every name. Each point carries its step,
    wall time, value and context (the stored JSON string)."""
    placeholders_runs = ",".join(["?"] * len(run_ids))
    name_clause = ""
    params: list[Any] = list(run_ids)
    if metrics is not None:
        name_clause = f"AND name IN ({','.join(['?'] * len(metrics))})"
        params += metrics
    rows = db.read_columns(
        f"""
        SELECT run_id, name, step, wall_time, scalar_value, context
        FROM sequences
        WHERE run_id IN ({placeholders_runs})
          {name_clause}
          AND object_type = 'scalar'
        ORDER BY run_id, name, step
        """,
        params,
    )
    # Group into (run_id, name) buckets.
    series: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        series.setdefault((r["run_id"], r["name"]), []).append(
            {"step": r["step"], "wall_time": r["wall_time"], "value": r["scalar_value"], "context": r["context"]}
        )
    return [
        {"run_id": rid, "name": name, "points": pts}
        for (rid, name), pts in series.items()
    ]
