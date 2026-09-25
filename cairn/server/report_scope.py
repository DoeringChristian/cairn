"""What a share link of a report may read: the report's own runs.

A report's runs are named in its ```cairn fences: ``runs.ids``, the runs a
``runs.selector`` resolves to (against the project's newest runs, exactly as
the UI resolves it), each card's explicit ``series[].runId``, the cell's run
view, and run ids in card settings (a code-diff card's ``leftRunId``/
``rightRunId``). Source files are in scope only for the runs a code-diff card
can show. Scope is live: it is recomputed from the report's current source,
cached for :data:`SCOPE_TTL_S` per share.

:func:`resolve_run_selector_from_runs` is a port of cairn-ui's
``resolveRunSelectorFromRuns`` (``src/lib/run-selector.ts``); both run the
vectors in cairn-ui ``docs/schemas/run-selector-vectors.json``.

A fence the UI would reject as a whole (its ``runs`` malformed) contributes
nothing. Past that, a fence's card entries are read leniently: a run id the
author wrote into the report is in scope even if the UI would refuse to
compile that card.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import yaml

from .artifact_refs import reachable_hashes
from .storage.blobs import BlobStore
from .storage.db import Database

#: Scope is recomputed at most this often per share.
SCOPE_TTL_S = 30.0
#: The run pool a selector resolves against — ``RUN_SELECTOR_FETCH_LIMIT`` in
#: cairn-ui ``api/hooks.ts`` (the project's newest runs).
RUN_SELECTOR_POOL = 500
DEFAULT_RUN_SELECTOR_N = 5
CAIRN_FENCE_LANG = "cairn"
CODE_DIFF_CARD = "code-diff"


# ---------------------------------------------------------------------------
# Selector resolution (mirror of lib/run-selector.ts)
# ---------------------------------------------------------------------------

# The characters the TS glob escapes before turning ``*`` into ``.*``. ``?`` is
# NOT among them, so it keeps its regex meaning on both sides.
_GLOB_ESCAPE_RE = re.compile(r"[.+^${}()|\[\]\\]")


def _parse_run_tags(tags: Any) -> list[str]:
    if not tags:
        return []
    try:
        parsed = json.loads(tags)
    except (TypeError, ValueError):
        return []
    return [t for t in parsed if isinstance(t, str)] if isinstance(parsed, list) else []


def _matches_name_pattern(display_name: str | None, pattern: str | None) -> bool:
    if not pattern:
        return True
    name = (display_name or "").lower()
    p = pattern.lower()
    if "*" in p:
        escaped = _GLOB_ESCAPE_RE.sub(lambda m: "\\" + m.group(0), p).replace("*", ".*")
        try:
            # fullmatch == JS ``^...$`` without the multiline flag.
            return re.fullmatch(escaped, name) is not None
        except re.error:
            return False
    return p in name


def _matches_tags(run_tags: Any, want: list[str] | None) -> bool:
    if not want:
        return True
    have = set(_parse_run_tags(run_tags))
    return all(t in have for t in want)


def resolve_run_selector_from_runs(sel: dict[str, Any], runs: list[dict[str, Any]]) -> list[str]:
    """The run ids ``sel`` selects from ``runs`` (any order)."""
    if sel.get("kind") == "static":
        return list(sel.get("runIds") or [])

    # Stable, newest first — equal timestamps keep their input order, as in JS.
    ordered = sorted(runs, key=lambda r: r["created_at"], reverse=True)
    candidates = [
        r for r in ordered
        if _matches_name_pattern(r.get("display_name"), sel.get("namePattern"))
        and _matches_tags(r.get("tags"), sel.get("tags"))
    ]

    n = sel.get("n")
    if sel.get("mode") == "latest-n":
        limit = DEFAULT_RUN_SELECTOR_N if n is None else int(n)  # JS slice truncates
        return [r["id"] for r in candidates[:limit]]

    seen: set[str] = set()
    out: list[str] = []
    for r in candidates:
        key = r.get("display_name") or r["id"]
        if key in seen:
            continue
        seen.add(key)
        out.append(r["id"])
        if n is not None and len(out) >= n:
            break
    return out


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (
        float("inf"), float("-inf"),
    )


def _str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def validate_run_selector(sel: Any) -> dict[str, Any] | None:
    """A ``runs.selector`` mapping as a query selector, or None where
    cairn-ui's ``validateRunSelector`` would throw."""
    if not isinstance(sel, dict):
        return None
    mode = sel.get("mode")
    if mode not in ("latest-n", "newest-per-name"):
        return None
    out: dict[str, Any] = {"kind": "query", "mode": mode}
    if "namePattern" in sel:
        if not isinstance(sel["namePattern"], str):
            return None
        out["namePattern"] = sel["namePattern"]
    if "tags" in sel:
        if not _str_list(sel["tags"]):
            return None
        out["tags"] = sel["tags"]
    if "n" in sel:
        if not _is_number(sel["n"]):
            return None
        out["n"] = sel["n"]
    return out


# ---------------------------------------------------------------------------
# Fences (mirror of splitFences in lib/reports/markdown-source.ts)
# ---------------------------------------------------------------------------

_FENCE_OPEN_RE = re.compile(r"^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$")


def cairn_fence_bodies(source: str) -> list[str]:
    """The bodies of a report's top-level ```cairn fences, in order."""
    lines = source.split("\n")
    bodies: list[str] = []
    i = 0
    while i < len(lines):
        m = _FENCE_OPEN_RE.match(lines[i])
        if not m:
            i += 1
            continue
        run, info = m.group(2), m.group(3).strip()
        close_re = re.compile(rf"^ {{0,3}}({re.escape(run[0])}{{{len(run)},}})[ \t]*$")
        close_idx = next((j for j in range(i + 1, len(lines)) if close_re.match(lines[j])), -1)
        lang = info.split()[0] if info else ""
        if lang == CAIRN_FENCE_LANG:
            end = close_idx if close_idx != -1 else len(lines)
            bodies.append("\n".join(lines[i + 1:end]))
        i = close_idx + 1 if close_idx != -1 else len(lines)
    return bodies


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------


@dataclass
class ShareScope:
    report_id: str
    project_id: str
    #: Every run the report shows.
    run_ids: frozenset[str]
    #: The runs a code-diff card may show source files of.
    source_run_ids: frozenset[str]
    _artifacts: frozenset[str] | None = field(default=None, repr=False)

    def artifacts(self, db: Database, blobs: BlobStore) -> frozenset[str]:
        """Artifact hashes reachable from the scope's runs (computed once)."""
        if self._artifacts is None:
            self._artifacts = frozenset(reachable_hashes(db, blobs, sorted(self.run_ids)))
        return self._artifacts


def _selector_pool(db: Database, project_id: str) -> list[dict[str, Any]]:
    return db.read_columns(
        """SELECT id, display_name, tags, created_at FROM runs
           WHERE project_id = ? ORDER BY created_at DESC LIMIT ?""",
        [project_id, RUN_SELECTOR_POOL],
    )


def _settings_run_ids(settings: Any) -> list[str]:
    """Run ids a card's settings name: ``runId``/``*RunId`` strings and
    ``runIds``/``*RunIds`` lists (a code-diff card's ``leftRunId``/``rightRunId``)."""
    if not isinstance(settings, dict):
        return []
    out: list[str] = []
    for k, v in settings.items():
        if not isinstance(k, str):
            continue
        if (k == "runId" or k.endswith("RunId")) and isinstance(v, str) and v:
            out.append(v)
        elif (k == "runIds" or k.endswith("RunIds")) and isinstance(v, list):
            out += [x for x in v if isinstance(x, str) and x]
    return out


def compute_scope(db: Database, report: dict[str, Any]) -> ShareScope:
    """The runs ``report`` (a ``reports`` row) shows, resolved now."""
    try:
        payload = json.loads(report.get("payload") or "{}")
    except (TypeError, ValueError):
        payload = {}
    source = payload.get("source") if isinstance(payload, dict) else None
    project_id = report["project_id"]
    run_ids: set[str] = set()
    source_run_ids: set[str] = set()
    pool: list[dict[str, Any]] | None = None

    for body in cairn_fence_bodies(source if isinstance(source, str) else ""):
        try:
            doc = yaml.safe_load(body)
        except yaml.YAMLError:
            continue
        if not isinstance(doc, dict):
            continue

        block_runs: list[str] = []
        runs = doc.get("runs")
        if "runs" in doc and not isinstance(runs, dict):
            continue
        if isinstance(runs, dict):
            if "ids" in runs and "selector" in runs:
                continue
            if "ids" in runs:
                if not _str_list(runs["ids"]):
                    continue
                block_runs = list(runs["ids"])
            elif "selector" in runs:
                sel = validate_run_selector(runs["selector"])
                if sel is None:
                    continue
                if pool is None:
                    pool = _selector_pool(db, project_id)
                block_runs = resolve_run_selector_from_runs(sel, pool)
            for key in ("hidden", "pinned"):
                if _str_list(runs.get(key)):
                    block_runs += runs[key]
            if isinstance(runs.get("baseline"), str) and runs["baseline"]:
                block_runs.append(runs["baseline"])

        run_ids.update(block_runs)
        cards = doc.get("cards")
        for card in cards if isinstance(cards, list) else []:
            if not isinstance(card, dict):
                continue
            named: list[str] = []
            series = card.get("series")
            for s in series if isinstance(series, list) else []:
                if isinstance(s, dict) and isinstance(s.get("runId"), str) and s["runId"]:
                    named.append(s["runId"])
            named += _settings_run_ids(card.get("settings"))
            run_ids.update(named)
            if card.get("type") == CODE_DIFF_CARD:
                # A viewer may point the diff at any run of its cell.
                source_run_ids.update(block_runs)
                source_run_ids.update(named)

    return ShareScope(
        report_id=report["id"],
        project_id=project_id,
        run_ids=frozenset(run_ids),
        source_run_ids=frozenset(source_run_ids),
    )


class ScopeCache:
    """Per-share scopes, each recomputed after :data:`SCOPE_TTL_S`."""

    def __init__(self, ttl_s: float = SCOPE_TTL_S) -> None:
        self._ttl = ttl_s
        self._lock = threading.Lock()
        self._entries: dict[str, tuple[float, ShareScope]] = {}

    def get(self, db: Database, share_id: str, report_id: str) -> ShareScope:
        now = time.monotonic()
        with self._lock:
            hit = self._entries.get(share_id)
            if hit is not None and hit[0] > now:
                return hit[1]
        rows = db.read_columns(
            "SELECT id, project_id, payload FROM reports WHERE id = ?", [report_id],
        )
        scope = (
            compute_scope(db, rows[0]) if rows
            else ShareScope(report_id, "", frozenset(), frozenset())
        )
        with self._lock:
            self._entries[share_id] = (now + self._ttl, scope)
        return scope

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
