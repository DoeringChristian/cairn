from __future__ import annotations
from typing import Any

def scalar_series(db: Any, run_ids: list[str], metrics: list[str] | None) -> list[dict[str, Any]]:
    """Scalar points of ``run_ids`` grouped per ``(run_id, name)``, in one
    query; ``metrics=None`` selects every name. Each point carries its step,
    wall time and value."""
    placeholders_runs = ",".join(["?"] * len(run_ids))
    name_clause = ""
    params: list[Any] = list(run_ids)
    if metrics is not None:
        name_clause = f"AND name IN ({','.join(['?'] * len(metrics))})"
        params += metrics
    rows = db.read_columns(
        f"""
        SELECT run_id, name, step, wall_time, scalar_value
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
            {"step": r["step"], "wall_time": r["wall_time"], "value": r["scalar_value"]}
        )
    return [
        {"run_id": rid, "name": name, "points": pts}
        for (rid, name), pts in series.items()
    ]
