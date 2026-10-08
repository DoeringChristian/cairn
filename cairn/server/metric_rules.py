"""Metric rules: how a metric's final value is read and which way is better.

A metric has one **effective rule** per project, ``{summary, goal}``:

* ``summary`` (``min | max | mean | last``, or None = the last point) picks
  the number the runs table, the Summary cards and ``Run.final`` show;
* ``goal`` (``lower | higher | none``) says which way is better: delta
  colouring, the run comparer's best/worst, a sweep's default goal.

It comes from two sources. The **logged** rule is
``run.track(..., summary=)`` (the ``metric_defs`` table, per run); the
project's rule is the one of its NEWEST run that logged one for the name.
A **project override** (the ``metric_overrides`` table, set through
``PUT /api/projects/{p}/metric-rules/{name}``) replaces either field.

``effective_rule`` is the one resolver, mirrored by cairn-ui
``src/lib/metric-rules.ts``; both run the vectors in cairn-ui
``docs/schemas/metric-rule-vectors.json``:

1. ``summary``: the override's, else the logged one, else None.
2. ``goal``: the override's; else from the effective summary (min -> lower,
   max -> higher); else from the logged summary (an override of the summary
   to ``last`` keeps a logged ``min``'s "lower is better"); else ``none``.

Rules apply when values are read and never change the logged points or the
``summary`` table: an explicit ``run.summary()`` key of the same name still
wins over any rule.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Mapping

from .storage.db import Database

SUMMARY_KINDS = ("min", "max", "mean", "last")
GOALS = ("lower", "higher", "none")

#: The goal a summary implies.
_GOAL_OF_SUMMARY = {"min": "lower", "max": "higher"}


def effective_rule(override: Mapping[str, Any] | None, logged: str | None) -> dict[str, Any]:
    """``{"summary": str | None, "goal": str}`` from a project override
    (``{summary?, goal?}``, a None field is unset) and the logged summary."""
    o = override or {}
    summary = o.get("summary") or logged or None
    goal = (
        o.get("goal")
        or _GOAL_OF_SUMMARY.get(summary or "")
        or _GOAL_OF_SUMMARY.get(logged or "")
        or "none"
    )
    return {"summary": summary, "goal": goal}


def validate_override(summary: Any, goal: Any) -> None:
    """``ValueError`` unless both fields are None or one of their kinds."""
    if summary is not None and summary not in SUMMARY_KINDS:
        raise ValueError(f"summary must be one of {', '.join(SUMMARY_KINDS)}, got {summary!r}")
    if goal is not None and goal not in GOALS:
        raise ValueError(f"goal must be one of {', '.join(GOALS)}, got {goal!r}")


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


def logged_rules(
    db: Database, project_ids: list[str], run_ids: list[str] | None = None,
) -> dict[str, dict[str, str]]:
    """``{project: {metric: summary}}``: each metric's logged rule from the
    newest run (``created_at``) that logged one. ``run_ids`` limits the runs
    that count (a share link sees only its report's runs)."""
    if not project_ids:
        return {}
    holes = ",".join("?" * len(project_ids))
    params: list[Any] = list(project_ids)
    only = ""
    if run_ids is not None:
        if not run_ids:
            return {p: {} for p in project_ids}
        only = f" AND r.id IN ({','.join('?' * len(run_ids))})"
        params += list(run_ids)
    out: dict[str, dict[str, str]] = {p: {} for p in project_ids}
    # Oldest first: a newer run's rule overwrites an older one's.
    for r in db.read_columns(
        f"""SELECT r.project_id AS project_id, d.name AS name, d.summary AS summary
              FROM metric_defs d JOIN runs r ON r.id = d.run_id
             WHERE r.project_id IN ({holes}) AND d.summary IS NOT NULL{only}
             ORDER BY r.created_at, r.rowid""",
        params,
    ):
        out[r["project_id"]][r["name"]] = r["summary"]
    return out


def overrides(db: Database, project_ids: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
    """``{project: {metric: {"summary", "goal"}}}``: the project overrides."""
    if not project_ids:
        return {}
    holes = ",".join("?" * len(project_ids))
    out: dict[str, dict[str, dict[str, Any]]] = {p: {} for p in project_ids}
    for r in db.read_columns(
        f"""SELECT project_id, name, summary, goal FROM metric_overrides
             WHERE project_id IN ({holes})""",
        list(project_ids),
    ):
        out[r["project_id"]][r["name"]] = {"summary": r["summary"], "goal": r["goal"]}
    return out


def project_rules(
    db: Database, project_ids: list[str], run_ids: list[str] | None = None,
) -> dict[str, dict[str, dict[str, Any]]]:
    """``{project: {metric: effective rule}}`` for every metric with a logged
    rule or an override."""
    logged = logged_rules(db, project_ids, run_ids)
    over = overrides(db, project_ids)
    out: dict[str, dict[str, dict[str, Any]]] = {}
    for p in project_ids:
        lg, ov = logged.get(p, {}), over.get(p, {})
        out[p] = {n: effective_rule(ov.get(n), lg.get(n)) for n in sorted(set(lg) | set(ov))}
    return out


def rules_document(
    db: Database, project_id: str, run_ids: list[str] | None = None,
    metric_names: set[str] | None = None,
) -> dict[str, Any]:
    """``GET /api/projects/{p}/metric-rules``: ``{logged: {metric: summary},
    overrides: {metric: {summary, goal}}, rules: {metric: {summary, goal}}}``.
    ``metric_names`` keeps only those metrics (a share link)."""
    lg = logged_rules(db, [project_id], run_ids)[project_id]
    ov = overrides(db, [project_id])[project_id]
    if metric_names is not None:
        lg = {k: v for k, v in lg.items() if k in metric_names}
        ov = {k: v for k, v in ov.items() if k in metric_names}
    return {
        "logged": lg,
        "overrides": ov,
        "rules": {n: effective_rule(ov.get(n), lg.get(n)) for n in sorted(set(lg) | set(ov))},
    }


def set_override(
    db: Database, project_id: str, name: str, *, summary: str | None, goal: str | None,
) -> None:
    """Set the project's override of ``name`` (both fields None: remove it)."""
    validate_override(summary, goal)
    if not name:
        raise ValueError("a metric name is required")
    with db.transaction() as con:
        if summary is None and goal is None:
            con.execute(
                "DELETE FROM metric_overrides WHERE project_id = ? AND name = ?", [project_id, name],
            )
            return
        con.execute(
            """INSERT INTO metric_overrides (project_id, name, summary, goal, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (project_id, name) DO UPDATE
                 SET summary = EXCLUDED.summary, goal = EXCLUDED.goal,
                     updated_at = EXCLUDED.updated_at""",
            [project_id, name, summary, goal, datetime.now(timezone.utc).isoformat()],
        )


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------


def _projects_of(db: Database, run_ids: list[str]) -> dict[str, str]:
    holes = ",".join("?" * len(run_ids))
    return {
        r["id"]: r["project_id"]
        for r in db.read_columns(f"SELECT id, project_id FROM runs WHERE id IN ({holes})", list(run_ids))
    }


def resolved_values(db: Database, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    """What the run table shows per run (``run.values``, the reader's
    ``Run.final``): each scalar metric's value under its effective rule (the
    last point without one), replaced by an explicit summary key of the same
    name.

    The merge lives here rather than at ingest so summary stays a record of
    what was DECLARED, and an override changes every run's value at once.
    A few queries for the whole page, not a few per run; the metric side
    reads ``metric_stats`` (maintained at ingest), so the cost is per metric,
    not per point.
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    out: dict[str, dict[str, Any]] = {rid: {} for rid in run_ids}
    project_of = _projects_of(db, run_ids)
    rules = project_rules(db, sorted(set(project_of.values())))

    for r in db.read_columns(
        f"""SELECT run_id, name, last_value AS last, min, max, sum / count AS mean
              FROM metric_stats WHERE run_id IN ({holes})""",
        list(run_ids),
    ):
        rule = rules.get(project_of.get(r["run_id"], ""), {}).get(r["name"])
        kind = (rule or {}).get("summary") or "last"
        out[r["run_id"]][r["name"]] = r[kind]

    # An explicit summary key replaces the metric's value.
    for r in db.read_columns(
        f"SELECT run_id, key, value FROM summary WHERE run_id IN ({holes})",
        list(run_ids),
    ):
        out[r["run_id"]][r["key"]] = json.loads(r["value"])
    return out
