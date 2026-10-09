"""Run sets: the runs of a report's cards cell, resolved on the server.

A Python port of cairn-ui ``src/lib/run-sets.ts`` (``resolveRunSet``) and
the pieces of the runs table it builds on: the filter tree
(``lib/run-filter.ts``: chips over the server's operators, expression
leaves), Latest only (``lib/runs-table/model.ts``), the sort
(``lib/runs-table/sort.ts``), the group-by (``lib/runs-table/group.ts``) and
the eyes (``lib/workspace-runs/visibility.ts``). Both run the vectors in
cairn-ui ``docs/schemas/run-set-vectors.json``. A share link's scope
(``report_scope``) is the runs its report's sets resolve to.

Runs are API rows (``id, display_name, status, tags (JSON text), group,
job_type, version, created_at, archived, params, values, stats``).

Which runs a set shows never depends on its sort, only their order does.
Text sorts like the UI's ``localeCompare(..., {numeric: true, sensitivity:
"base"})`` for letters and digits (case-insensitive, digit runs by value);
punctuation may order differently.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Callable, Iterable, Mapping

from .. import expr as E
from ._operators import OPERATORS
from .query_resolver import _coerce
from .run_series import run_series_key

#: The project's newest runs a set resolves against (cairn-ui ``RUN_SET_POOL``).
RUN_SET_POOL = 1000
#: How many of the newest groups (runs) are visible by default.
DEFAULT_VISIBLE = 10
DEFAULT_SORT = [{"column": "created_at", "direction": "desc"}]

Run = Mapping[str, Any]


# ---------------------------------------------------------------------------
# Parsing (parseRunSet, parseFilter, isGroupBy)
# ---------------------------------------------------------------------------

_OPS = set(OPERATORS)


def _parse_node(v: Any, depth: int) -> dict[str, Any] | None:
    if not isinstance(v, dict) or depth > 16:
        return None
    kind = v.get("kind")
    if kind == "chip":
        ok = isinstance(v.get("field"), str) and v.get("op") in _OPS and isinstance(v.get("arg"), str)
        return {"kind": "chip", "field": v["field"], "op": v["op"], "arg": v["arg"]} if ok else None
    if kind == "expr":
        return {"kind": "expr", "expr": v["expr"]} if isinstance(v.get("expr"), str) else None
    if kind == "group" and v.get("op") in ("and", "or") and isinstance(v.get("children"), list):
        children = [c for c in (_parse_node(c, depth + 1) for c in v["children"]) if c is not None]
        return {"kind": "group", "op": v["op"], "children": children}
    return None


def parse_filter(raw: Any) -> dict[str, Any]:
    n = _parse_node(raw, 0)
    return n if n is not None and n["kind"] == "group" else {"kind": "group", "op": "and", "children": []}


def _is_group_by(v: Any) -> bool:
    if not isinstance(v, dict):
        return False
    src = v.get("source")
    if src in ("group", "job_type", "tag"):
        return True
    if src == "param":
        return isinstance(v.get("key"), str)
    if src == "expr":
        return isinstance(v.get("expr"), str)
    return False


def parse_run_set(raw: Any, index: int = 0) -> dict[str, Any] | None:
    """A stored run set (what does not parse takes its default); None when
    ``raw`` is not a mapping."""
    if not isinstance(raw, dict):
        return None
    eyes = raw.get("eyes")
    sort = [
        {"column": k["column"], "direction": k["direction"]}
        for k in (raw.get("sort") if isinstance(raw.get("sort"), list) else [])
        if isinstance(k, dict) and isinstance(k.get("column"), str) and k["column"]
        and k.get("direction") in ("asc", "desc")
    ]
    name = raw.get("name")
    return {
        "name": name if isinstance(name, str) and name else f"Run set {index + 1}",
        "filter": parse_filter(raw.get("filter")),
        "groupBy": [g for g in raw.get("groupBy") or [] if _is_group_by(g)]
        if isinstance(raw.get("groupBy"), list) else [],
        "latestOnly": raw.get("latestOnly") is True,
        "sort": sort or list(DEFAULT_SORT),
        "eyes": {k: v for k, v in eyes.items() if isinstance(v, bool)} if isinstance(eyes, dict) else {},
    }


# ---------------------------------------------------------------------------
# Filter (lib/run-filter.ts)
# ---------------------------------------------------------------------------


def parse_tags(tags: Any) -> list[str]:
    if not tags:
        return []
    try:
        parsed = json.loads(tags) if isinstance(tags, str) else tags
    except ValueError:
        return []
    return [t for t in parsed if isinstance(t, str)] if isinstance(parsed, list) else []


def field_value(run: Run, field: str) -> Any:
    if field == "display_name":
        return run.get("display_name")
    if field == "status":
        return run.get("status")
    if field == "tags":
        return parse_tags(run.get("tags"))
    if field in ("group", "job_type"):
        return run.get(field)
    if field.startswith("values."):
        return (run.get("values") or {}).get(field[len("values."):])
    if field.startswith("params."):
        return (run.get("params") or {}).get(field[len("params."):])
    return None


def _coerce_arg(op: str, text: str) -> Any:
    return [_coerce(p) for p in text.split(",")] if op == "in" else _coerce(text)


def matches_chip(run: Run, chip: Mapping[str, Any]) -> bool:
    try:
        return bool(OPERATORS[chip["op"]](field_value(run, chip["field"]), _coerce_arg(chip["op"], chip["arg"])))
    except (TypeError, ValueError):
        return False


_COMPILED: dict[str, E.Node | None] = {}


def compile_scalar_expr(src: str) -> E.Node | None:
    """``compileScalarExpr``: the parsed expression when it is a valid
    scalar, else None (an error, or a series)."""
    if src in _COMPILED:
        return _COMPILED[src]
    try:
        node = E.parse(src)
        out: E.Node | None = node if E.check(node).shape == "scalar" else None
    except E.ExprError:
        out = None
    if len(_COMPILED) > 500:
        _COMPILED.clear()
    _COMPILED[src] = out
    return out


class RunContext:
    """``runContextOf``: an expression context over one runs-table row (no
    series; reducers answer from ``stats``)."""

    def __init__(self, run: Run) -> None:
        self._run = run

    def series(self, name: str) -> None:
        return None

    def stat(self, name: str, reducer: str) -> Any:
        stats = self._run.get("stats")
        if stats is None:
            return E.MISSING
        s = stats.get(name)
        if not s:
            return None
        v = s.get(reducer)
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def config(self, key: str) -> Any:
        return (self._run.get("params") or {}).get(key)

    def summary(self, key: str) -> Any:
        return (self._run.get("values") or {}).get(key)

    def run(self, field: str) -> Any:
        r = self._run
        if field == "name":
            return r.get("display_name") or r["id"]
        if field == "id":
            return r["id"]
        if field == "tags":
            return parse_tags(r.get("tags"))
        if field in ("status", "group", "job_type", "created_at"):
            return r.get(field)
        return None


def eval_scalar(node: E.Node, run: Run) -> Any:
    try:
        v = E.evaluate(node, RunContext(run)).value
    except Exception:  # noqa: BLE001 - the UI's catch-all: an error is "no value"
        return None
    return None if isinstance(v, E.Series) else v


def matches_filter(run: Run, node: Mapping[str, Any]) -> bool:
    kind = node["kind"]
    if kind == "chip":
        return matches_chip(run, node)
    if kind == "expr":
        ast = compile_scalar_expr(node["expr"])
        if ast is None:
            return True
        try:
            return E.matches(E.evaluate(ast, RunContext(run)))
        except Exception:  # noqa: BLE001
            return False
    children = node["children"]
    if not children:
        return True
    if node["op"] == "and":
        return all(matches_filter(run, c) for c in children)
    return any(matches_filter(run, c) for c in children)


# ---------------------------------------------------------------------------
# Latest only (lib/runs-table/model.ts, lib/run-series.ts)
# ---------------------------------------------------------------------------


def _newer_in_series(a: Run, b: Run) -> bool:
    va, vb = a.get("version"), b.get("version")
    if va is not None and vb is not None and va != vb:
        return va > vb
    return a["created_at"] > b["created_at"]


def latest_ids(runs: Iterable[Run]) -> set[str]:
    best: dict[Any, Run] = {}
    for r in runs:
        k = run_series_key(r)
        if k not in best or _newer_in_series(r, best[k]):
            best[k] = r
    return {r["id"] for r in best.values()}


# ---------------------------------------------------------------------------
# Sort (lib/runs-table/sort.ts, columns.ts cellValue)
# ---------------------------------------------------------------------------


def _ms(iso: Any) -> float | None:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return None


def cell_value(run: Run, col: str) -> Any:
    for kind, src in (("value", "values"), ("param", "params")):
        if col.startswith(kind + ":"):
            return (run.get(src) or {}).get(col[len(kind) + 1:])
    if col.startswith("computed:"):
        return None
    if col == "name":
        return run.get("display_name") or run["id"]
    if col in ("group", "job_type"):
        return run.get(col)
    if col == "status":
        return run.get("status")
    if col == "created_at":
        return _ms(run.get("created_at"))
    if col == "duration":
        start, end = _ms(run.get("created_at")), _ms(run.get("ended_at")) if run.get("ended_at") else None
        if start is None:
            return None
        if end is None:
            end = datetime.now().timestamp() * 1000
        return max(0.0, end - start)
    if col == "tags":
        return parse_tags(run.get("tags"))
    return None


def _missing(v: Any) -> bool:
    return v is None or (isinstance(v, float) and v != v)


_CHUNK = re.compile(r"(\d+)")


def _text_key(s: str) -> list[tuple[int, Any]]:
    """``localeCompare(..., {numeric: true, sensitivity: "base"})``, roughly:
    punctuation < digit runs (by value) < letters, case-insensitive."""
    out: list[tuple[int, Any]] = []
    for i, part in enumerate(_CHUNK.split(s)):
        if i % 2:
            out.append((1, int(part)))
        else:
            out.extend((2 if ch.isalpha() else 0, ch.lower()) for ch in part)
    return out


def _js_string(v: Any) -> str:
    return v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def compare_values(a: Any, b: Any) -> int:
    na = float(a) if isinstance(a, bool) else a
    nb = float(b) if isinstance(b, bool) else b
    num_a = isinstance(na, (int, float))
    num_b = isinstance(nb, (int, float))
    if num_a and num_b:
        return -1 if na < nb else 1 if na > nb else 0
    if num_a:
        return -1
    if num_b:
        return 1
    ka, kb = _text_key(_js_string(na)), _text_key(_js_string(nb))
    return -1 if ka < kb else 1 if ka > kb else 0


def sort_runs(runs: list[Run], sort: list[Mapping[str, Any]]) -> list[Run]:
    import functools

    rows = [(r, [cell_value(r, k["column"]) for k in sort]) for r in runs]

    def cmp(x: tuple[Run, list[Any]], y: tuple[Run, list[Any]]) -> int:
        for i, k in enumerate(sort):
            a, b = x[1][i], y[1][i]
            am, bm = _missing(a), _missing(b)
            if am or bm:
                if am and bm:
                    continue
                return 1 if am else -1
            c = compare_values(a, b)
            if c:
                return c if k["direction"] == "asc" else -c
        xi, yi = x[0]["id"], y[0]["id"]
        return -1 if xi < yi else 1 if xi > yi else 0

    return [r for r, _ in sorted(rows, key=functools.cmp_to_key(cmp))]


# ---------------------------------------------------------------------------
# Group by (lib/runs-table/group.ts)
# ---------------------------------------------------------------------------


def group_by_label(by: Mapping[str, Any]) -> str:
    if by["source"] == "param":
        return f"param: {by['key']}"
    if by["source"] == "expr":
        return by["expr"]
    return by["source"]


def _label_of(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return E.format_value(v)
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def _values_of(run: Run, by: Mapping[str, Any]) -> list[Any]:
    src = by["source"]
    if src in ("group", "job_type"):
        return [run.get(src)]
    if src == "param":
        return [(run.get("params") or {}).get(by["key"])]
    if src == "tag":
        tags = list(dict.fromkeys(parse_tags(run.get("tags"))))
        return tags or [None]
    node = compile_scalar_expr(by["expr"])
    return [eval_scalar(node, run) if node is not None else None]


def group_runs(runs: list[Run], levels: list[Mapping[str, Any]]) -> list[dict[str, Any]] | None:
    """``groupRunsNested``: ``[{label, depth, by, runs, children}]``, None
    without levels."""
    if not levels:
        return None

    def build(rs: list[Run], depth: int) -> list[dict[str, Any]]:
        by = levels[depth]
        groups: dict[str | None, list[Run]] = {}
        for r in rs:
            for raw in _values_of(r, by):
                groups.setdefault(_label_of(raw), []).append(r)
        ordered = [k for k in groups if k is not None] + [k for k in groups if k is None]
        return [
            {
                "label": k, "depth": depth, "by": by, "runs": groups[k],
                "children": build(groups[k], depth + 1) if depth + 1 < len(levels) else None,
            }
            for k in ordered
        ]

    return build(list(runs), 0)


# ---------------------------------------------------------------------------
# Eyes (lib/workspace-runs/visibility.ts)
# ---------------------------------------------------------------------------


def _group_key(node: Mapping[str, Any]) -> str:
    label = node["label"] if node["label"] is not None else "∅"
    return f"g:{group_by_label(node['by'])}:{label}"


def _visible_keys(entries: list[tuple[str, str]], eyes: Mapping[str, bool]) -> set[str]:
    """``visibleKeys``: entries are ``(key, newest created_at)``."""
    import functools

    def cmp(a: tuple[str, str], b: tuple[str, str]) -> int:
        if a[1] != b[1]:
            return -1 if a[1] > b[1] else 1
        return -1 if a[0] < b[0] else 1

    ranked = sorted(entries, key=functools.cmp_to_key(cmp))
    return {k for rank, (k, _) in enumerate(ranked) if eyes.get(k, rank < DEFAULT_VISIBLE)}


def _newest(runs: list[Run]) -> str:
    return max((r["created_at"] for r in runs), default="")


def visible_runs(sorted_runs: list[Run], groups: list[dict[str, Any]] | None, eyes: Mapping[str, bool]) -> set[str]:
    if groups is None:
        vis = _visible_keys([(f"r:{r['id']}", r["created_at"]) for r in sorted_runs], eyes)
        return {r["id"] for r in sorted_runs if f"r:{r['id']}" in vis}
    top = _visible_keys([(_group_key(g), _newest(g["runs"])) for g in groups], eyes)
    by_default = {r["id"] for g in groups if _group_key(g) in top for r in g["runs"]}
    return {r["id"] for r in sorted_runs if eyes.get(f"r:{r['id']}", r["id"] in by_default)}


def _legend_key(by: Mapping[str, Any]) -> str:
    """``groupLegendKey``: group, jobType, tag, a param key, an expression."""
    if by["source"] == "job_type":
        return "jobType"
    if by["source"] == "param":
        return by["key"]
    if by["source"] == "expr":
        return by["expr"]
    return by["source"]


def _group_line(path: list[dict[str, Any]]) -> str | None:
    """``groupLineLabel`` of an innermost group that ``aggregates`` (no
    ``(none)`` level), else None: its runs stay their own lines."""
    if any(step["label"] is None for step in path):
        return None
    return ", ".join(f"{_legend_key(step['by'])}: {step['label']}" for step in path)


def card_runs_lines(
    sorted_runs: list[Run], groups: list[dict[str, Any]] | None, visible: set[str],
) -> tuple[list[str], dict[str, str]]:
    """``cardRuns``: the visible runs in table order and each grouped run's
    innermost group line (a run in several groups takes its first)."""
    if groups is None:
        return [r["id"] for r in sorted_runs if r["id"] in visible], {}
    out: list[str] = []
    lines: dict[str, str] = {}
    seen: set[str] = set()

    def walk(ns: list[dict[str, Any]], parent: list[dict[str, Any]]) -> None:
        for n in ns:
            path = [*parent, n]
            if n["children"] is not None:
                walk(n["children"], path)
                continue
            line = _group_line(path)
            for r in n["runs"]:
                if r["id"] in visible and r["id"] not in seen:
                    seen.add(r["id"])
                    out.append(r["id"])
                    if line is not None:
                        lines[r["id"]] = line

    walk(groups, [])
    return out, lines


def card_runs(sorted_runs: list[Run], groups: list[dict[str, Any]] | None, visible: set[str]) -> list[str]:
    return card_runs_lines(sorted_runs, groups, visible)[0]


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------


def resolve_run_set(run_set: Mapping[str, Any], pool: list[Run]) -> list[str]:
    """The runs ``run_set`` shows, in table order; ``pool`` is the project's
    newest runs, archived ones included."""
    return resolve_run_set_lines(run_set, pool)[0]


def resolve_run_set_lines(run_set: Mapping[str, Any], pool: list[Run]) -> tuple[list[str], dict[str, str]]:
    """``resolveRunSetLines``: :func:`resolve_run_set` and each grouped run's
    innermost group line (``group: exp-44, jobType: train``)."""
    latest = latest_ids(pool)
    listed = [
        r for r in pool
        if not r.get("archived")
        and (not run_set["latestOnly"] or r["id"] in latest)
        and matches_filter(r, run_set["filter"])
    ]
    ordered = sort_runs(listed, run_set["sort"])
    groups = group_runs(ordered, run_set["groupBy"])
    return card_runs_lines(ordered, groups, visible_runs(ordered, groups, run_set["eyes"]))


def run_set_pool(db: Any, project_id: str) -> list[dict[str, Any]]:
    """The project's newest ``RUN_SET_POOL`` runs as the UI loads them for a
    report (archived included, with params, values and stats)."""
    from .run_query import select_runs
    from .routes.runs import _metric_stats, _params_by_run

    rows, _ = select_runs(db, {
        "project": project_id, "archived": None,
        "sort": {"key": "created_at", "desc": True}, "limit": RUN_SET_POOL,
    })
    ids = [r["id"] for r in rows]
    params, stats = _params_by_run(db, ids), _metric_stats(db, ids)
    for r in rows:
        r["params"] = params.get(r["id"], {})
        r["stats"] = stats.get(r["id"], {})
    return rows


def resolve_with(
    pool_of: Callable[[], list[Run]],
) -> Callable[[Mapping[str, Any]], tuple[list[str], dict[str, str]]]:
    """A resolver (:func:`resolve_run_set_lines`) that loads the pool once, on first use."""
    cache: list[list[Run]] = []

    def resolve(run_set: Mapping[str, Any]) -> tuple[list[str], dict[str, str]]:
        if not cache:
            cache.append(pool_of())
        return resolve_run_set_lines(run_set, cache[0])

    return resolve


def run_set_of_ids(ids: Iterable[str], name: str = "Run set 1") -> dict[str, Any]:
    """A run set of exactly these runs (cairn-ui ``runSetOfIds``): the filter
    ``run.id in [...]``, every run's eye on."""
    unique = list(dict.fromkeys(ids))
    return {
        "name": name,
        "filter": {"kind": "group", "op": "and", "children": [
            {"kind": "expr", "expr": f"run.id in [{', '.join(json.dumps(i) for i in unique)}]"},
        ]},
        "groupBy": [],
        "latestOnly": False,
        "sort": list(DEFAULT_SORT),
        "eyes": {f"r:{i}": True for i in unique},
    }


def run_sets_yaml(*sets: Iterable[str]) -> str:
    """``runSets: [...]`` for a ```cairn fence, one set of exactly these runs
    per argument (JSON is YAML)."""
    return "runSets: " + json.dumps([run_set_of_ids(ids, f"Run set {i + 1}") for i, ids in enumerate(sets)])
