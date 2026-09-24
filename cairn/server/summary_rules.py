"""Read-time summary rules from ``define_metric`` (the ``metric_defs`` table).

A run's metric normally resolves to its LAST point. A metric definition with
``summary`` set ("min", "max", "mean", "last") overrides that per name, and a
definition's name may be an fnmatch glob (``val/*``). Rules apply at read time
and never write the ``summary`` table, so an explicit ``run.summary()`` key of
the same name still wins over them.
"""

from __future__ import annotations

from fnmatch import fnmatchcase

from .storage.db import Database

SUMMARY_KINDS = ("min", "max", "mean", "last")


def rule_for(name: str, defs: dict[str, str]) -> str | None:
    """The summary kind ``defs`` (``{name_or_glob: kind}``) assigns to ``name``.

    An exact name beats a glob; among globs the longest pattern wins, as the
    most specific one.
    """
    if name in defs:
        return defs[name]
    matches = [p for p in defs if fnmatchcase(name, p)]
    return defs[max(matches, key=len)] if matches else None


def resolve_summary_rules(
    db: Database, run_ids: list[str],
) -> dict[str, dict[str, float | None]]:
    """``{run_id: {metric: value}}`` for every scalar metric a rule covers.

    "last" rules are included too, so a caller can treat the result as the
    resolved value of every ruled metric. Runs without rules are absent.
    """
    if not run_ids:
        return {}
    holes = ",".join("?" * len(run_ids))
    defs: dict[str, dict[str, str]] = {}
    for r in db.read_columns(
        f"SELECT run_id, name, summary FROM metric_defs "
        f"WHERE run_id IN ({holes}) AND summary IS NOT NULL",
        list(run_ids),
    ):
        defs.setdefault(r["run_id"], {})[r["name"]] = r["summary"]
    if not defs:
        return {}

    ruled = list(defs)
    holes = ",".join("?" * len(ruled))
    out: dict[str, dict[str, float | None]] = {}
    for r in db.read_columns(
        f"""SELECT s.run_id AS run_id, s.name AS name,
                   MIN(s.scalar_value) AS min, MAX(s.scalar_value) AS max,
                   AVG(s.scalar_value) AS mean,
                   (SELECT l.scalar_value FROM sequences l
                     WHERE l.run_id = s.run_id AND l.name = s.name
                       AND l.scalar_value IS NOT NULL
                     ORDER BY l.step DESC LIMIT 1) AS last
              FROM sequences s
             WHERE s.run_id IN ({holes}) AND s.scalar_value IS NOT NULL
             GROUP BY s.run_id, s.name""",
        ruled,
    ):
        kind = rule_for(r["name"], defs[r["run_id"]])
        if kind is not None:
            out.setdefault(r["run_id"], {})[r["name"]] = r[kind]
    return out
