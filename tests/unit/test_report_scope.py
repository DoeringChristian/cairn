"""report_scope: the run scope of a report share link.

``resolve_run_selector_from_runs`` mirrors cairn-ui ``resolveRunSelectorFromRuns``;
both run the vectors committed in cairn-ui at
``docs/schemas/run-selector-vectors.json``.
"""

import json
from pathlib import Path

import pytest

from cairn.server import report_scope as rs
from cairn_ui.cards import spec as _cs

_VECTORS = Path(_cs.__file__).resolve().parents[2] / "docs" / "schemas" / "run-selector-vectors.json"
_DOC = json.loads(_VECTORS.read_text())


@pytest.mark.parametrize("case", _DOC["cases"], ids=[c["name"] for c in _DOC["cases"]])
def test_selector_vectors(case):
    assert rs.resolve_run_selector_from_runs(case["selector"], _DOC["runs"]) == case["expected"]


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


class _NoDB:
    def read_columns(self, *_a, **_k):  # pragma: no cover - selector-free reports
        raise AssertionError("no selector, no pool query")


def test_scope_collects_ids_series_views_and_settings():
    src = "\n\n".join([
        "prose mentioning run zz is not scope",
        _fence("runs: {ids: [a, b], hidden: [b], baseline: c}\ncards:\n  - {metric: loss, type: scalar}"),
        _fence("cards:\n  - type: scalar\n    series: [{runId: d, name: loss}]\n"
               "  - type: run-compare\n    settings: {baselineRunId: e, runIds: [f], other: g}"),
        _fence("runs: {ids: [h]}\ncards:\n  - type: code-diff\n    settings: {leftRunId: i, rightRunId: h}"),
    ])
    scope = rs.compute_scope(_NoDB(), _report(src))
    assert scope.run_ids == {"a", "b", "c", "d", "e", "f", "h", "i"}
    assert scope.source_run_ids == {"h", "i"}


@pytest.mark.parametrize("body", [
    "runs: {ids: [a], selector: {mode: latest-n}}",  # both
    "runs: {ids: [a, 3]}",  # non-string id
    "runs: {ids: ~}",
    "runs: [a]",
    "runs: {selector: {mode: nope}}",
    "runs: {selector: {mode: latest-n, n: true}}",
    "{{{ not yaml",
    "- a list",
])
def test_scope_skips_fences_the_ui_rejects(body):
    scope = rs.compute_scope(_NoDB(), _report(_fence(body)))
    assert scope.run_ids == frozenset()


class _PoolDB:
    def __init__(self, pool):
        self.pool = pool
        self.calls = []

    def read_columns(self, sql, params):
        self.calls.append(params)
        return self.pool


def test_scope_resolves_selectors_against_the_project_pool():
    pool = [
        {"id": "x1", "display_name": "train", "tags": None, "created_at": "2026-01-01T00:00:01"},
        {"id": "x2", "display_name": "train", "tags": None, "created_at": "2026-01-01T00:00:02"},
        {"id": "x3", "display_name": "eval", "tags": None, "created_at": "2026-01-01T00:00:03"},
    ]
    db = _PoolDB(pool)
    src = _fence("runs: {selector: {mode: newest-per-name, namePattern: 'tr*'}}\ncards: [{type: code-diff}]") \
        + "\n" + _fence("runs: {selector: {mode: latest-n, n: 1}}")
    scope = rs.compute_scope(db, _report(src, project_id="proj"))
    assert scope.run_ids == {"x2", "x3"}
    assert scope.source_run_ids == {"x2"}
    assert db.calls == [["proj", rs.RUN_SELECTOR_POOL]]  # one pool query per scope
