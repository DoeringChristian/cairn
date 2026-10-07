"""The ONE run-selection evaluator.

``select_runs(db, spec)`` filters, orders and pages a project's runs. It
backs ``POST /api/runs/query`` and ``GET /api/runs``, the local
``cairn.Reader`` (called in-process), and ``/api/query?run=latest``, so a
query means the same thing on a local repo and on a server.

Semantics (the reader's ``RunQuery`` documents them for users):

* **Candidates**: the project, archived mode (``False`` excludes archived
  runs, ``True`` keeps only them, ``None`` both), exact ``status``, and the
  plain column filters (``group``, ``job_type``, ``sweep_id``, ``ids``).
* **Predicates** ``(field, op, sub, value)``: ``field`` is a run field
  (``name``, ``status``, ``tags``, ...), ``metrics`` (the final value,
  exactly ``Run.final``), ``config`` / ``summary`` (``sub`` a dotted path; a
  non-leaf path compares the sub-document), or any other root, which is a
  config key (``sub`` appended). A comparison that raises does not match.
* **where**: ``cairn.expr`` expressions; a run matches when the scalar result
  is truthy and not None.
* **Order**: ``sort.key`` (default ``created_at``) ascending, or descending
  with ``sort.desc``. Ties break by ``created_at`` then ``id`` in the same
  direction. A run whose value is missing (no such key, a running run's
  ``ended_at``, NaN, or a value whose type differs from the majority type of
  the present values) sorts after every present value in BOTH directions.
  ``reverse`` reverses the whole final order (``RunQuery.last``).
* **Paging**: ``offset`` / ``limit`` after everything above; ``total`` counts
  the matching runs.
"""

from __future__ import annotations

import json
import math
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from .. import expr as _expr
from . import config_doc
from ._operators import OPERATORS
from .routes._common import api_run_row
from .storage.db import Database
from .summary_rules import resolved_values

#: A run row as run lists return it: every column but ``env_snapshot`` (large,
#: only shown on the run page) and the two documents (served decoded on request).
RUN_LIST_COLUMNS = """id, project_id, display_name, created_at, ended_at, status,
                   exit_code, git_sha, git_dirty, git_branch, git_remote, cli_args,
                   hostname, "user", tags, notes, last_heartbeat,
                   parent_run_id, fork_step, data_epoch, run_group, job_type,
                   sweep_id, stop_requested, archived_at, total_steps, max_step,
                   step_samples, progress_value, progress_total, progress_samples,
                   version"""

#: Filterable run fields and their column.
RUN_FIELDS = {
    "name": "display_name", "status": "status", "project": "project_id",
    "tags": "tags", "id": "id", "hostname": "hostname", "user": "user",
    "notes": "notes", "group": "run_group", "job_type": "job_type",
}

#: Sort keys that are run columns (``duration`` is derived).
SORT_COLUMNS = ("created_at", "ended_at", "duration", "name", "version", "status", "id")
SORT_PREFIXES = ("config.", "summary.", "metrics.")


class RunQueryError(ValueError):
    """A malformed query (unknown operator or sort key) -> HTTP 400."""


def validate_sort_key(key: str) -> str:
    if key in SORT_COLUMNS:
        return key
    for prefix in SORT_PREFIXES:
        if key.startswith(prefix) and len(key) > len(prefix):
            return key
    raise RunQueryError(
        f"unknown sort key {key!r}; expected one of {', '.join(SORT_COLUMNS)}, "
        "or config.<path>, summary.<path>, metrics.<name>"
    )


def _parse_tags(tags_json: str | None) -> list[str]:
    if not tags_json:
        return []
    try:
        parsed = json.loads(tags_json)
    except (json.JSONDecodeError, TypeError):
        return []
    return [t for t in parsed if isinstance(t, str)] if isinstance(parsed, list) else []


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class _Run:
    """One candidate with lazily loaded docs / metrics (batched by ``_Batch``)."""

    __slots__ = ("row", "batch")

    def __init__(self, row: dict[str, Any], batch: "_Batch") -> None:
        self.row = row
        self.batch = batch

    @property
    def id(self) -> str:
        return self.row["id"]

    def field(self, name: str) -> Any:
        if name == "tags":
            return _parse_tags(self.row.get("tags"))
        return self.row.get(RUN_FIELDS.get(name, name))

    def doc_value(self, kind: str, key: str) -> Any:
        return self.batch.doc_nodes(kind, self.id).get(key)

    def metric(self, name: str) -> Any:
        return self.batch.values().get(self.id, {}).get(name)


class _Batch:
    """Per-query caches: one query per page of candidates for each source."""

    def __init__(self, db: Database, run_ids: list[str]) -> None:
        self._db = db
        self._ids = run_ids
        self._docs: dict[str, dict[str, dict[str, Any]]] = {}
        self._values: dict[str, dict[str, Any]] | None = None
        self._series: dict[tuple[str, str], dict[str, list] | None] = {}
        self._nodes: dict[tuple[str, str], dict[str, Any]] = {}

    def doc_nodes(self, kind: str, run_id: str) -> dict[str, Any]:
        """Every node of the run's document by flat key (cached)."""
        key = (kind, run_id)
        if key not in self._nodes:
            try:
                self._nodes[key] = config_doc.nodes(self.doc(kind, run_id))
            except ValueError:
                self._nodes[key] = {}
        return self._nodes[key]

    def doc(self, kind: str, run_id: str) -> dict[str, Any]:
        if kind not in self._docs:
            column = "config" if kind == "config" else "summary"
            out: dict[str, dict[str, Any]] = {}
            for i in range(0, len(self._ids), 500):
                chunk = self._ids[i:i + 500]
                for r in self._db.read_columns(
                    f"SELECT id, {column} AS doc FROM runs WHERE id IN ({','.join('?' * len(chunk))})",
                    chunk,
                ):
                    out[r["id"]] = config_doc.loads(r["doc"])
            self._docs[kind] = out
        return self._docs[kind].get(run_id, {})

    def values(self) -> dict[str, dict[str, Any]]:
        if self._values is None:
            self._values = {}
            for i in range(0, len(self._ids), 500):
                self._values.update(resolved_values(self._db, self._ids[i:i + 500]))
        return self._values

    def series(self, run_id: str, name: str) -> dict[str, list] | None:
        key = (run_id, name)
        if key not in self._series:
            rows = self._db.read_columns(
                "SELECT step, wall_time, scalar_value FROM sequences "
                "WHERE run_id = ? AND name = ? ORDER BY step",
                [run_id, name],
            )
            self._series[key] = {
                "steps": [r["step"] for r in rows],
                "values": [r["scalar_value"] for r in rows],
                "wall": [_expr.parse_time(r["wall_time"]) for r in rows],
            } if rows else None
        return self._series[key]


def resolve_field(run: _Run, field: str, sub: str | None) -> Any:
    """A predicate's left-hand value (see the module doc)."""
    if field in RUN_FIELDS:
        return run.field(field)
    if field == "metrics":
        return run.metric(sub) if sub else None
    if field in ("config", "summary"):
        return run.doc_value(field, sub) if sub else None
    # Any other root is a config key.
    return run.doc_value("config", f"{field}.{sub}" if sub else field)


class _ExprContext:
    def __init__(self, run: _Run) -> None:
        self._run = run

    def series(self, name: str) -> dict[str, list] | None:
        return self._run.batch.series(self._run.id, name)

    def config(self, key: str) -> Any:
        return self._run.doc_value("config", key)

    def summary(self, key: str) -> Any:
        return self._run.doc_value("summary", key)

    def run(self, field: str) -> Any:
        r = self._run
        if field == "created_at":
            v = r.row.get("created_at")
            return v.isoformat() if isinstance(v, datetime) else v
        if field in ("name", "id", "status", "tags", "group", "job_type"):
            return r.field(field)
        return None


def _sort_value(run: _Run, key: str) -> Any:
    if key == "created_at":
        return _parse_dt(run.row.get("created_at"))
    if key == "ended_at":
        return _parse_dt(run.row.get("ended_at"))
    if key == "duration":
        start, end = _parse_dt(run.row.get("created_at")), _parse_dt(run.row.get("ended_at"))
        return (end - start).total_seconds() if start and end else None
    if key == "name":
        return run.row.get("display_name")
    if key in ("status", "id", "version"):
        return run.row.get(key)
    root, _, rest = key.partition(".")
    if root == "metrics":
        return run.metric(rest)
    return run.doc_value(root, rest)


def _kind(v: Any) -> str | None:
    """The comparable family of a sort value; None means missing."""
    if v is None:
        return None
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return None if isinstance(v, float) and math.isnan(v) else "num"
    if isinstance(v, str):
        return "str"
    if isinstance(v, datetime):
        return "time"
    if isinstance(v, list):
        return "list"
    return None  # dicts and anything else are not orderable


def _order(runs: list[_Run], key: str, desc: bool) -> list[_Run]:
    vals = {r.id: _sort_value(r, key) for r in runs}
    kinds = Counter(k for k in (_kind(v) for v in vals.values()) if k is not None)
    # The majority type wins; ties between types go to the first in this order.
    rank = ["num", "str", "time", "bool", "list"]
    major = max(kinds, key=lambda k: (kinds[k], -rank.index(k))) if kinds else None
    present: list[_Run] = []
    missing: list[_Run] = []
    for r in runs:
        (present if major is not None and _kind(vals[r.id]) == major else missing).append(r)
    epoch = datetime.min.replace(tzinfo=timezone.utc)

    def tie(r: _Run) -> tuple[datetime, str]:
        return (_parse_dt(r.row.get("created_at")) or epoch, r.id)

    if major == "list":
        present.sort(key=lambda r: (_list_key(vals[r.id]), tie(r)), reverse=desc)
    else:
        present.sort(key=lambda r: (vals[r.id], tie(r)), reverse=desc)
    missing.sort(key=tie, reverse=desc)
    return present + missing


def _list_key(v: list[Any]) -> str:
    return json.dumps(v, sort_keys=True, default=str)


def _candidates(db: Database, spec: dict[str, Any]) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    for column, value in (
        ("project_id", spec.get("project")),
        ("status", spec.get("status")),
        ("run_group", spec.get("group")),
        ("job_type", spec.get("job_type")),
        ("sweep_id", spec.get("sweep_id")),
    ):
        if value:
            clauses.append(f"{column} = ?")
            params.append(value)
    archived = spec.get("archived", False)
    if archived is False:
        clauses.append("archived_at IS NULL")
    elif archived is True:
        clauses.append("archived_at IS NOT NULL")
    if spec.get("created_before"):
        clauses.append("created_at <= ?")
        params.append(spec["created_before"])
    ids = spec.get("ids")
    if ids is not None:
        clauses.append(f"id IN ({','.join('?' * len(ids))})" if ids else "0")
        params.extend(ids)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return db.read_columns(f"SELECT {RUN_LIST_COLUMNS} FROM runs {where}", params)


def _compile_predicates(spec: dict[str, Any]) -> list[tuple[str, str, str | None, Any]]:
    out = []
    for p in spec.get("predicates") or []:
        if len(p) != 4:
            raise RunQueryError(f"a predicate is [field, op, sub, value], got {p!r}")
        field, op, sub, value = p
        if op not in OPERATORS:
            raise RunQueryError(f"unknown operator {op!r}")
        out.append((field, op, sub, value))
    return out


def _compile_wheres(spec: dict[str, Any]) -> list[_expr.Node]:
    nodes = []
    for src in spec.get("where") or []:
        try:
            node = _expr.parse(src)
            if _expr.check(node).shape == "series":
                raise _expr.ExprError(
                    "where() needs a scalar expression; reduce the series, e.g. last(loss) < 0.1",
                    node.span,
                )
        except _expr.ExprError as exc:
            raise RunQueryError(f"bad where expression {src!r}: {exc}") from None
        nodes.append(node)
    return nodes


def select_runs(db: Database, spec: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """Evaluate ``spec`` (see the module doc); returns ``(rows, total)``.

    ``spec`` keys: ``project``, ``archived`` (False | True | None), ``status``,
    ``group``, ``job_type``, ``sweep_id``, ``ids``, ``created_before``,
    ``predicates`` ([[field, op, sub, value]]), ``where`` ([expr]),
    ``sort`` ({key, desc}), ``reverse``, ``limit``, ``offset``.

    Rows are in API shape (``api_run_row``) with ``values`` (``Run.final``).
    """
    predicates = _compile_predicates(spec)
    wheres = _compile_wheres(spec)
    sort = spec.get("sort") or {}
    key = validate_sort_key(sort.get("key") or "created_at")
    desc = bool(sort.get("desc", False))

    rows = _candidates(db, spec)
    batch = _Batch(db, [r["id"] for r in rows])
    runs = [_Run(r, batch) for r in rows]

    for field, op, sub, value in predicates:
        comparator = OPERATORS[op]
        kept = []
        for run in runs:
            try:
                if comparator(resolve_field(run, field, sub), value):
                    kept.append(run)
            except (TypeError, ValueError):
                pass
        runs = kept

    for node in wheres:
        runs = [r for r in runs if _expr.matches(_expr.evaluate(node, _ExprContext(r)))]

    runs = _order(runs, key, desc)
    if spec.get("reverse"):
        runs.reverse()
    total = len(runs)
    offset = int(spec.get("offset") or 0)
    limit = spec.get("limit")
    page = runs[offset:] if limit is None else runs[offset:offset + int(limit)]

    values = batch.values() if page else {}
    out = []
    for run in page:
        row = api_run_row(dict(run.row))
        row["values"] = values.get(run.id, {})
        out.append(row)
    return out, total


def docs_by_run(db: Database, run_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Each run's ``{"config": doc, "summary": doc}`` (``include=config``)."""
    out: dict[str, dict[str, Any]] = {}
    for i in range(0, len(run_ids), 500):
        chunk = run_ids[i:i + 500]
        for r in db.read_columns(
            f"SELECT id, config, summary FROM runs WHERE id IN ({','.join('?' * len(chunk))})",
            chunk,
        ):
            out[r["id"]] = {
                "config": config_doc.loads(r["config"]),
                "summary": config_doc.loads(r["summary"]),
            }
    return out
