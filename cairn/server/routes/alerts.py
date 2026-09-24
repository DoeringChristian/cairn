"""Alert read endpoint (the UI's bell and run-page banners)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from ._common import get_db, parse_timestamp

router = APIRouter(prefix="/api", tags=["alerts"])


@router.get("/projects/{project_id}/alerts")
def list_alerts(
    project_id: str,
    request: Request,
    since: str | None = Query(default=None, description="ISO-8601; only newer alerts"),
    run_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=1000),
) -> dict[str, Any]:
    """A project's alerts, newest first, with the run's display name."""
    db = get_db(request)
    clauses = ["a.project_id = ?"]
    params: list[Any] = [project_id]
    if since:
        try:
            ts = parse_timestamp(since)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"bad since: {since!r}") from None
        clauses.append("a.created_at > ?")
        params.append(ts.isoformat())
    if run_id:
        clauses.append("a.run_id = ?")
        params.append(run_id)
    rows = db.read_columns(
        f"""
        SELECT a.id, a.run_id, r.display_name AS run_name, a.level, a.title,
               a.text, a.created_at, a.delivered_at
        FROM alerts a LEFT JOIN runs r ON r.id = a.run_id
        WHERE {" AND ".join(clauses)}
        ORDER BY a.created_at DESC
        LIMIT ?
        """,
        [*params, limit],
    )
    return {"alerts": rows}
