"""report_scope: the run scope of a report share link.

A cell's runs are its run sets resolved by ``cairn.server.run_sets`` (the
port of cairn-ui ``resolveRunSet``, pinned by ``tests/unit/test_run_sets.py``);
here: which fences count and what else of a fence is in scope.
"""

import json

import pytest

from cairn.server import ingest_ops
from cairn.server import report_scope as rs


def test_cairn_fence_bodies_only_top_level_cairn_fences():
    src = "\n".join([
        "# Title",
        "```python",
        "```cairn",  # inside a python fence: not a fence of its own
        "```",
        "```cairn",
        "runs: {ids: [a]}",
        "```",
        "~~~~ cairn extra",
        "runs: {ids: [b]}",
        "~~~",  # too short to close
        "~~~~",
        "```cairn",
        "runs: {ids: [c]}",  # unterminated: runs to the end
    ])
    assert rs.cairn_fence_bodies(src) == [
        "runs: {ids: [a]}",
        "runs: {ids: [b]}\n~~~",
        "runs: {ids: [c]}",
    ]


def _report(source: str, project_id: str = "p") -> dict:
    return {"id": "rep", "project_id": project_id, "payload": json.dumps({"source": source})}


def _fence(body: str) -> str:
    return f"```cairn\n{body}\n```"


@pytest.fixture
def pool(monkeypatch):
    """The project's runs every run set resolves against; counts the loads."""
    runs = [
        {"id": "a", "display_name": "train", "group": "g1", "job_type": "train", "version": 1,
         "status": "completed", "tags": None, "archived": False, "created_at": "2026-01-01T00:00:01",
         "params": {}, "values": {}, "stats": {}},
        {"id": "b", "display_name": "train", "group": "g1", "job_type": "train", "version": 2,
         "status": "completed", "tags": None, "archived": False, "created_at": "2026-01-01T00:00:02",
         "params": {}, "values": {}, "stats": {}},
        {"id": "h", "display_name": "eval", "group": "g2", "job_type": "eval", "version": 1,
         "status": "completed", "tags": None, "archived": False, "created_at": "2026-01-01T00:00:03",
         "params": {}, "values": {}, "stats": {}},
    ]
    calls = []

    def load(db, project_id):
        calls.append(project_id)
        return runs

    monkeypatch.setattr(rs.run_sets, "run_set_pool", load)
    return calls


G1 = "{kind: group, op: and, children: [{kind: chip, field: group, op: exact, arg: g1}]}"
G2 = "{kind: group, op: and, children: [{kind: chip, field: group, op: exact, arg: g2}]}"


def test_scope_collects_run_sets_series_views_and_settings(pool):
    src = "\n\n".join([
        "prose mentioning run zz is not scope",
        _fence(f"runSets: [{{name: A, filter: {G1}, latestOnly: true}}]\n"
               "view: {hidden: [b], baseline: c}\ncards:\n  - {metric: loss, type: scalar}"),
        _fence("cards:\n  - type: scalar\n    series: [{runId: d, name: loss}]\n"
               "  - type: run-compare\n    settings: {baselineRunId: e, runIds: [f], other: g}"),
        _fence(f"runSets: [{{filter: {G2}}}, {{filter: {G1}}}]\n"
               "cards:\n  - type: code-diff\n    settings: {leftRunId: i, rightRunId: h}"),
    ])
    scope = rs.compute_scope(object(), _report(src, project_id="proj"))
    assert scope.run_ids == {"a", "b", "c", "d", "e", "f", "h", "i"}
    assert scope.source_run_ids == {"a", "b", "h", "i"}
    assert scope.run_sets == ((("b",),), (), (("h",), ("b", "a")))
    assert pool == ["proj"]  # one pool load per scope


@pytest.mark.parametrize("body", [
    "runs: {ids: [a]}",  # the old format: not read
    "runs: {selector: {mode: latest-n}}",
    "runSets: {name: x}",
    "runSets: [3]",
    "runSets: []\nview: [a]",
    "{{{ not yaml",
    "- a list",
])
def test_scope_skips_fences_the_ui_rejects(body, pool):
    scope = rs.compute_scope(object(), _report(_fence(body)))
    assert scope.run_ids == frozenset()
    assert scope.run_sets == ((),)


def test_empty_fence_and_no_run_sets(pool):
    scope = rs.compute_scope(object(), _report(_fence("") + "\n" + _fence("title: t")))
    assert scope.run_ids == frozenset()
    assert scope.run_sets == ((), ())
    assert pool == []  # nothing to resolve, no pool load


def test_scope_against_a_real_project(fresh_db):
    db = fresh_db
    a = ingest_ops.create_run(db, project="p", name="train", group="g")["run_id"]
    b = ingest_ops.create_run(db, project="p", name="train", group="g")["run_id"]  # v2
    ingest_ops.create_run(db, project="q", name="train", group="g")
    src = _fence("runSets: [{latestOnly: true}, {filter: {kind: group, op: and, children: "
                 "[{kind: expr, expr: \"run.name == 'train'\"}]}}]")
    scope = rs.compute_scope(db, _report(src))
    assert scope.run_sets == (((b,), (b, a)),)
    assert scope.run_ids == {a, b}
