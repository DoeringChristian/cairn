"""Server-side run/artifact selector resolver for ``GET /api/query``.

This is the first Python/server home for the run-selection semantics that,
until now, existed only in the client (``ui/src/lib/run-selector.ts``) and the
Python reader (``cairn/sdk/reader.py``). It ports three things into one pure,
HTTP-free module so they can be unit-tested directly against a ``Database``:

* the ``QueryRunSelector`` schema (``mode: latest-n | newest-per-name``,
  ``namePattern`` glob, all-of ``tags``, ``n``) — see :func:`resolve_run_ids`,
  a faithful mirror of ``resolveRunSelectorFromRuns``;
* ``RunQuery``'s Django-style ``field__op=value`` filter semantics
  (``reader.py``) — the operator table is imported verbatim from the reader so
  the two can never drift;
* ``_find_artifact``'s highest-step ("latest checkpoint") logic (``reader.py``).

The public entry point is :func:`resolve`, which turns a parsed
:class:`QuerySpec` (see :func:`parse_query_params`) into a
:class:`ResolvedArtifact` (run id + content digest + object metadata). The
route layer (``routes/query.py``) is a thin wrapper: parse → resolve → 302 or
JSON envelope.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable, Literal, Mapping

# Reuse the reader's operator table verbatim so URL predicates share exactly
# the same comparison semantics as ``RunQuery.filter(...)``.
from ..sdk.reader import _OPERATORS
from .storage.db import Database


class QueryError(ValueError):
    """A malformed query (bad grammar / unsupported feature) → HTTP 400."""


class QueryNotFound(LookupError):
    """A well-formed query that resolves to no run/artifact → HTTP 404."""


# ---------------------------------------------------------------------------
# Grammar dataclasses
# ---------------------------------------------------------------------------

# Top-level run columns filterable directly (everything else is a param key).
# Mirrors ``reader._RUN_FIELDS`` but maps to DB column names where they differ.
_RUN_FIELDS = {"name", "status", "project", "tags", "id", "hostname", "user", "notes"}
_FIELD_TO_COLUMN = {"name": "display_name", "project": "project_id"}


@dataclass(frozen=True)
class RunSelection:
    """How to pick a single run out of the ordered candidate list.

    * ``latest`` — the newest matching run.
    * ``latest-n`` — the ``n``-th newest (1-based), i.e. ``run=latest:2``.
    * ``newest-per-name`` — dedup candidates by display name (keeping the
      newest per name), then take the newest overall.
    * ``id`` — pin an explicit ``run_id`` (the hardest pin; ignores filters).
    """

    mode: Literal["latest", "latest-n", "newest-per-name", "id"] = "latest"
    n: int = 1
    run_id: str | None = None


@dataclass(frozen=True)
class Predicate:
    """One Django-style filter, e.g. ``lr__gt=1e-4`` / ``metrics.loss__lt=0.1``."""

    field: str
    op: str
    sub_field: str | None
    value: Any


@dataclass(frozen=True)
class QuerySpec:
    """A fully-parsed ``/api/query`` request."""

    tag: str
    run: RunSelection = field(default_factory=RunSelection)
    project: str | None = None
    name: str | None = None
    status: str | None = None
    predicates: tuple[Predicate, ...] = ()
    step: Literal["latest"] | int = "latest"
    kind: str | None = None
    at: str | None = None  # normalized UTC ISO-8601 (created_at <= at)
    fmt: Literal["raw", "json"] = "raw"


@dataclass(frozen=True)
class ResolvedArtifact:
    run_id: str
    digest: str
    step: int | None
    mime_type: str
    size: int


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

_RESERVED = {"run", "project", "name", "status", "tag", "step", "format", "at", "kind"}


def _coerce(s: str) -> Any:
    """Best-effort coerce a URL string into int / float / bool, else str."""
    low = s.lower()
    if low in ("true", "false"):
        return low == "true"
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    return s


def _parse_run(value: str) -> RunSelection:
    if value == "latest":
        return RunSelection("latest")
    if value == "newest-per-name":
        return RunSelection("newest-per-name")
    if value.startswith("latest:"):
        rest = value[len("latest:"):]
        try:
            n = int(rest)
        except ValueError as exc:
            raise QueryError(f"run=latest:N needs an integer N, got {rest!r}") from exc
        if n < 1:
            raise QueryError("run=latest:N requires N >= 1")
        return RunSelection("latest-n", n=n)
    if value.startswith("id:"):
        rid = value[len("id:"):]
        if not rid:
            raise QueryError("run=id: requires a run id")
        return RunSelection("id", run_id=rid)
    raise QueryError(
        f"unknown run selector {value!r}; expected "
        "latest | latest:N | newest-per-name | id:<run_id>"
    )


def _parse_predicate(key: str, value: str) -> Predicate:
    """Parse ``field[.sub][__op]=value`` into a :class:`Predicate`.

    Nesting uses ``.`` (``metrics.loss``); the operator is a trailing
    ``__<op>`` suffix. ``status__in=a,b`` splits the value on commas.
    """
    op = "exact"
    path = key
    if "__" in key:
        head, _, tail = key.rpartition("__")
        if tail in _OPERATORS and head:
            op, path = tail, head
    fld, _, sub = path.partition(".")
    if op == "in":
        coerced: Any = [_coerce(v) for v in value.split(",")]
    else:
        coerced = _coerce(value)
    return Predicate(field=fld, op=op, sub_field=(sub or None), value=coerced)


def _normalize_at(value: str) -> str:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise QueryError(f"at= must be ISO-8601, got {value!r}") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def parse_query_params(params: Mapping[str, str] | Iterable[tuple[str, str]]) -> QuerySpec:
    """Parse raw query params (a mapping or an iterable of pairs) into a
    :class:`QuerySpec`. Repeated predicate keys accumulate (all-of).

    Raises :class:`QueryError` on malformed / unsupported input.
    """
    items = list(params.items()) if isinstance(params, Mapping) else list(params)

    run = RunSelection("latest")
    tag: str | None = None
    project = name = status = kind = at = None
    step: Literal["latest"] | int = "latest"
    fmt: Literal["raw", "json"] = "raw"
    predicates: list[Predicate] = []

    for key, value in items:
        if key == "run":
            run = _parse_run(value)
        elif key == "tag":
            tag = value
        elif key == "project":
            project = value
        elif key == "name":
            name = value
        elif key == "status":
            status = value
        elif key == "kind":
            kind = value
        elif key == "at":
            at = _normalize_at(value)
        elif key == "step":
            if value == "latest":
                step = "latest"
            elif value.startswith("best"):
                raise QueryError("step=best is not supported yet (deferred)")
            else:
                try:
                    step = int(value)
                except ValueError as exc:
                    raise QueryError(
                        f"step must be 'latest' or an integer, got {value!r}"
                    ) from exc
        elif key == "format":
            if value not in ("raw", "json"):
                raise QueryError(f"format must be raw|json, got {value!r}")
            fmt = value  # type: ignore[assignment]
        elif key in _RESERVED:
            continue
        else:
            predicates.append(_parse_predicate(key, value))

    if not tag:
        raise QueryError("tag= is required (the artifact/sequence name to resolve)")

    return QuerySpec(
        tag=tag, run=run, project=project, name=name, status=status,
        predicates=tuple(predicates), step=step, kind=kind, at=at, fmt=fmt,
    )


# ---------------------------------------------------------------------------
# Name / tag matching (mirror of ui/src/lib/run-selector.ts)
# ---------------------------------------------------------------------------

def _matches_name(display_name: str | None, pattern: str | None) -> bool:
    """Substring match (case-insensitive), or a glob when ``pattern`` has ``*``.

    Faithful port of ``matchesNamePattern`` in run-selector.ts.
    """
    if not pattern:
        return True
    name = (display_name or "").lower()
    p = pattern.lower()
    if "*" in p:
        import re
        escaped = re.sub(r"[.+^${}()|\[\]\\]", lambda m: "\\" + m.group(0), p)
        escaped = escaped.replace("*", ".*")
        try:
            return re.fullmatch(escaped, name) is not None
        except re.error:
            return False
    return p in name


def _parse_tags(tags_json: str | None) -> list[str]:
    if not tags_json:
        return []
    try:
        parsed = json.loads(tags_json)
    except (json.JSONDecodeError, TypeError):
        return []
    return [t for t in parsed if isinstance(t, str)] if isinstance(parsed, list) else []


def _matches_tags(tags_json: str | None, want: list[str] | None) -> bool:
    if not want:
        return True
    have = set(_parse_tags(tags_json))
    return all(t in have for t in want)


# ---------------------------------------------------------------------------
# Field resolution + predicate evaluation (mirror of reader._get_field_value)
# ---------------------------------------------------------------------------

def _param_value(db: Database, run_id: str, key: str) -> Any:
    rows = db.read_columns(
        "SELECT value FROM params WHERE run_id = ? AND key = ?", [run_id, key]
    )
    if not rows:
        return None
    raw = rows[0]["value"]
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


def _final_metric(db: Database, run_id: str, name: str) -> Any:
    rows = db.read_columns(
        "SELECT scalar_value FROM sequences WHERE run_id = ? AND name = ? "
        "ORDER BY step DESC LIMIT 1",
        [run_id, name],
    )
    return rows[0]["scalar_value"] if rows else None


def _field_value(db: Database, run_row: dict[str, Any], pred: Predicate) -> Any:
    fld, sub = pred.field, pred.sub_field
    if fld in _RUN_FIELDS:
        if fld == "tags":
            return _parse_tags(run_row.get("tags"))
        return run_row.get(_FIELD_TO_COLUMN.get(fld, fld))
    if fld == "metrics":
        return _final_metric(db, run_row["id"], sub) if sub else None
    if fld == "params":
        return _param_value(db, run_row["id"], sub) if sub else None
    # Default: treat the field as a (possibly dotted) param key.
    full = f"{fld}.{sub}" if sub else fld
    return _param_value(db, run_row["id"], full)


def _run_matches(db: Database, run_row: dict[str, Any], spec: QuerySpec) -> bool:
    if not _matches_name(run_row.get("display_name"), spec.name):
        return False
    for pred in spec.predicates:
        actual = _field_value(db, run_row, pred)
        comparator = _OPERATORS[pred.op]
        try:
            if not comparator(actual, pred.value):
                return False
        except (TypeError, ValueError):
            return False
    return True


# ---------------------------------------------------------------------------
# Run loading + selection
# ---------------------------------------------------------------------------

def _load_candidates(db: Database, spec: QuerySpec) -> list[dict[str, Any]]:
    """Return matching runs ordered newest-first (created_at DESC)."""
    if spec.run.mode == "id":
        rows = db.read_columns("SELECT * FROM runs WHERE id = ?", [spec.run.run_id])
        return rows

    clauses: list[str] = []
    params: list[Any] = []
    if spec.project:
        clauses.append("project_id = ?")
        params.append(spec.project)
    if spec.status:
        clauses.append("status = ?")
        params.append(spec.status)
    if spec.at:
        clauses.append("created_at <= ?")
        params.append(spec.at)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.read_columns(
        f"SELECT * FROM runs {where} ORDER BY created_at DESC", params
    )
    return [r for r in rows if _run_matches(db, r, spec)]


def _select_run(candidates: list[dict[str, Any]], sel: RunSelection) -> dict[str, Any] | None:
    if not candidates:
        return None
    if sel.mode in ("latest", "id"):
        return candidates[0]
    if sel.mode == "latest-n":
        return candidates[sel.n - 1] if len(candidates) >= sel.n else None
    if sel.mode == "newest-per-name":
        seen: set[str] = set()
        for r in candidates:  # already newest-first
            key = r.get("display_name") or r["id"]
            if key not in seen:
                return r  # first (newest) of the newest-per-name set
            seen.add(key)
        return candidates[0]
    return None


# ---------------------------------------------------------------------------
# Artifact resolution (mirror of reader._find_artifact)
# ---------------------------------------------------------------------------

def _resolve_artifact(
    db: Database, run_id: str, tag: str,
    step: Literal["latest"] | int, kind: str | None,
) -> ResolvedArtifact | None:
    named = db.read_columns(
        """SELECT ra.hash AS hash,
                  CASE WHEN ra.step = -1 THEN NULL ELSE ra.step END AS step,
                  a.mime_type, a.size_bytes, a.object_type
           FROM run_artifacts ra JOIN artifacts a ON a.hash = ra.hash
           WHERE ra.run_id = ? AND ra.name = ?""",
        [run_id, tag],
    )
    seq = db.read_columns(
        """SELECT DISTINCT s.artifact_hash AS hash, s.step,
                  a.mime_type, a.size_bytes, s.object_type
           FROM sequences s JOIN artifacts a ON a.hash = s.artifact_hash
           WHERE s.run_id = ? AND s.name = ? AND s.artifact_hash IS NOT NULL""",
        [run_id, tag],
    )
    matches = [*named, *seq]
    if kind:
        matches = [m for m in matches if m.get("object_type") == kind]
    if step != "latest":
        matches = [m for m in matches if m.get("step") == step]
    if not matches:
        return None
    if step == "latest":
        chosen = max(
            matches,
            key=lambda m: m["step"] if m.get("step") is not None else -1,
        )
    else:
        chosen = matches[0]
    return ResolvedArtifact(
        run_id=run_id,
        digest=chosen["hash"],
        step=chosen.get("step"),
        mime_type=chosen.get("mime_type") or "application/octet-stream",
        size=chosen.get("size_bytes") or 0,
    )


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def resolve(db: Database, spec: QuerySpec) -> ResolvedArtifact:
    """Resolve a :class:`QuerySpec` to a concrete content-addressed artifact.

    Raises :class:`QueryNotFound` when no run or no matching artifact exists.
    """
    candidates = _load_candidates(db, spec)
    run = _select_run(candidates, spec.run)
    if run is None:
        raise QueryNotFound("no run matched the query")
    art = _resolve_artifact(db, run["id"], spec.tag, spec.step, spec.kind)
    if art is None:
        detail = f"no artifact named {spec.tag!r} on run {run['id']}"
        if spec.step != "latest":
            detail += f" at step {spec.step}"
        raise QueryNotFound(detail)
    return art


@dataclass(frozen=True)
class QueryRunSelectorSpec:
    """Pure port of the ``QueryRunSelector`` schema (card_spec.py / TS).

    Resolves to a *list* of run ids (multi-run cards), unlike :func:`resolve`
    which addresses a single artifact.
    """

    mode: Literal["latest-n", "newest-per-name"]
    name_pattern: str | None = None
    tags: list[str] | None = None
    n: int | None = None


DEFAULT_RUN_SELECTOR_N = 5


def resolve_run_ids(
    db: Database, selector: QueryRunSelectorSpec, *, project: str | None = None,
) -> list[str]:
    """Server-side twin of ``resolveRunSelectorFromRuns`` (run-selector.ts).

    Returns the run ids the selector picks, newest-first.
    """
    clauses: list[str] = []
    params: list[Any] = []
    if project:
        clauses.append("project_id = ?")
        params.append(project)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    rows = db.read_columns(
        f"SELECT id, display_name, tags, created_at FROM runs {where} "
        "ORDER BY created_at DESC",
        params,
    )
    candidates = [
        r for r in rows
        if _matches_name(r.get("display_name"), selector.name_pattern)
        and _matches_tags(r.get("tags"), selector.tags)
    ]

    if selector.mode == "latest-n":
        n = selector.n if selector.n is not None else DEFAULT_RUN_SELECTOR_N
        return [r["id"] for r in candidates[: int(n)]]

    # newest-per-name: first occurrence per display name (newest-first order).
    seen: set[str] = set()
    out: list[str] = []
    for r in candidates:
        key = r.get("display_name") or r["id"]
        if key in seen:
            continue
        seen.add(key)
        out.append(r["id"])
        if selector.n is not None and len(out) >= int(selector.n):
            break
    return out
