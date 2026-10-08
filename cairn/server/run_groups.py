"""A project's run groups (``runs.run_group``) and the lineage among a
group's runs, for the group page and its picker.

Archived runs are left out everywhere here.
"""

from __future__ import annotations

from typing import Any

from .storage.db import Database

#: The newest of a run's timestamps (SQLite's multi-argument MAX is NULL when
#: any argument is, hence the COALESCEs).
_LAST_ACTIVITY = (
    "MAX(created_at, COALESCE(ended_at, created_at), COALESCE(last_heartbeat, created_at))"
)


def list_groups(db: Database, project_id: str) -> list[dict[str, Any]]:
    """``[{group, run_count, last_activity}]`` over the project's non-archived
    runs that have a group, most recently active first."""
    return db.read_columns(
        f"""SELECT run_group AS "group", COUNT(*) AS run_count,
                   MAX({_LAST_ACTIVITY}) AS last_activity
              FROM runs
             WHERE project_id = ? AND run_group IS NOT NULL AND archived_at IS NULL
             GROUP BY run_group
             ORDER BY last_activity DESC, run_group""",
        [project_id],
    )


def group_graph(db: Database, project_id: str, group: str) -> dict[str, Any]:
    """The runs of one group and the lineage edges among them.

    ``{group, runs, edges}``:

    * ``runs``: every non-archived run of the project in ``group``, oldest
      first, as ``{id, name, display_name, version, status, created_at,
      ended_at}`` (``name`` and ``display_name`` are both the run's display
      name; null for an unnamed run);
    * ``edges``: only between two of those runs, never a self-edge, upstream
      run -> downstream run:

      - ``{from, to, via: "artifact", artifacts: [{artifact_version_id,
        artifact ("name:vN"), role}]}``: ``to`` used (``use_artifact``)
        versions that ``from`` logged; one edge per (from, to) pair listing
        every such version in the order ``to`` used them;
      - ``{from, to, via: "run", role}``: ``to`` used ``from`` directly
        (``use_run``).

      Artifact edges come first (in first-use order), then run edges (in
      link order).
    """
    runs = db.read_columns(
        """SELECT id, display_name AS name, display_name, version, status, created_at, ended_at
             FROM runs
            WHERE project_id = ? AND run_group = ? AND archived_at IS NULL
            ORDER BY created_at, id""",
        [project_id, group],
    )
    in_group = """SELECT id FROM runs
                   WHERE project_id = ? AND run_group = ? AND archived_at IS NULL"""
    edges: list[dict[str, Any]] = []
    by_pair: dict[tuple[str, str], dict[str, Any]] = {}
    for r in db.read_columns(
        f"""SELECT av.created_by_run AS src, ri.run_id AS dst, av.id AS vid,
                   af.name AS name, av.version AS version, ri.role AS role
              FROM run_inputs ri
              JOIN artifact_versions av ON av.id = ri.artifact_version_id
              JOIN artifact_families af ON af.id = av.family_id
             WHERE ri.run_id IN ({in_group}) AND av.created_by_run IN ({in_group})
               AND av.created_by_run != ri.run_id
             ORDER BY ri.created_at, av.id""",
        [project_id, group, project_id, group],
    ):
        edge = by_pair.get((r["src"], r["dst"]))
        if edge is None:
            edge = {"from": r["src"], "to": r["dst"], "via": "artifact", "artifacts": []}
            by_pair[(r["src"], r["dst"])] = edge
            edges.append(edge)
        edge["artifacts"].append({
            "artifact_version_id": r["vid"], "artifact": f"{r['name']}:v{r['version']}",
            "role": r["role"],
        })
    for r in db.read_columns(
        f"""SELECT used_run_id AS src, run_id AS dst, role FROM run_links
             WHERE run_id IN ({in_group}) AND used_run_id IN ({in_group})
               AND used_run_id != run_id
             ORDER BY created_at, run_id, used_run_id""",
        [project_id, group, project_id, group],
    ):
        edges.append({"from": r["src"], "to": r["dst"], "via": "run", "role": r["role"]})
    return {"group": group, "runs": runs, "edges": edges}
