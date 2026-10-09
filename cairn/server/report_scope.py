"""What a share link of a report may read: the report's own runs.

A report's runs are named in its ```cairn fences: the runs each cell's run
sets (``runSets``) resolve to right now (``run_sets.resolve_run_set``, the
Python port of cairn-ui's ``resolveRunSet``, over the project's newest runs
exactly as the UI resolves them), each card's explicit ``series[].runId``,
the cell's run view (``view``) and run ids in card settings (a code-diff
card's ``leftRunId``/``rightRunId``). Source files are in scope only for the
runs a code-diff card can show. A card's custom viewer (``settings.viewer``,
pinned by ``settings.viewer_version`` or else ``latest``) puts that viewer
version's files in scope. A card that lets the UI pick its viewer (a
``custom`` card without ``settings.viewer``, or a ``volume`` card, which a
viewer accepting ``volume`` takes over) puts the ``latest`` of every viewer
that could be picked in scope: those accepting some custom kind, or
``volume``. Scope is live: it is recomputed from the report's current
source, cached for ``SCOPE_TTL_S`` per share.

A fence the UI would reject as a whole (not a mapping, the old ``runs:``
format, ``runSets`` or ``view`` malformed) contributes nothing. Past that, a
fence's card entries are read leniently: a run id the author wrote into the
report is in scope even if the UI would refuse to compile that card.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import yaml

from . import run_sets
from .artifact_refs import reachable_hashes
from .custom_viewers import published_viewers, resolve_viewer_version
from .viewer_defaults import BUILTIN_TYPES, default_for_subject, list_defaults
from .storage.blobs import BlobStore
from .storage.db import Database

#: Scope is recomputed at most this often per share.
SCOPE_TTL_S = 30.0
CAIRN_FENCE_LANG = "cairn"
CODE_DIFF_CARD = "code-diff"


def _str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def fence_run_sets(doc: Any) -> list[dict[str, Any]] | None:
    """A fence's run sets as the UI reads them (``parseRunSet`` per entry),
    or None where cairn-ui rejects the fence (not a mapping, the old
    ``runs:`` format, a malformed ``runSets`` or ``view``)."""
    if doc is None:
        return []
    if not isinstance(doc, dict) or "runs" in doc:
        return None
    raw = doc.get("runSets", [])
    if not isinstance(raw, list):
        return None
    view = doc.get("view")
    if "view" in doc and not isinstance(view, dict):
        return None
    sets = [run_sets.parse_run_set(r, i) for i, r in enumerate(raw)]
    return None if any(s is None for s in sets) else sets  # type: ignore[misc]


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
    #: The custom viewer versions the report's cards use (``settings.viewer``
    #: + optional ``settings.viewer_version``; default ``latest``).
    viewer_versions: frozenset[str] = frozenset()
    #: Each ```cairn fence's run sets, resolved: ``[fence][set] -> run ids``
    #: (a fence the UI rejects has none).
    run_sets: tuple[tuple[tuple[str, ...], ...], ...] = ()
    #: Each set's group lines, as ``run_sets``: ``[fence][set] -> {run id:
    #: innermost group line}`` (``run_sets.resolve_run_set_lines``).
    run_set_groups: tuple[tuple[dict[str, str], ...], ...] = ()
    _artifacts: frozenset[str] | None = field(default=None, repr=False)

    def artifacts(self, db: Database, blobs: BlobStore) -> frozenset[str]:
        """Artifact hashes reachable from the scope's runs (computed once)."""
        if self._artifacts is None:
            self._artifacts = frozenset(reachable_hashes(db, blobs, sorted(self.run_ids)))
        return self._artifacts


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
    resolve = run_sets.resolve_with(lambda: run_sets.run_set_pool(db, project_id))
    fences: list[tuple[tuple[str, ...], ...]] = []
    fence_groups: list[tuple[dict[str, str], ...]] = []
    viewer_refs: set[tuple[str, Any]] = set()
    #: Types of the cards whose viewer the UI picks (no ``settings.viewer``).
    auto_viewers: set[str] = set()

    for body in cairn_fence_bodies(source if isinstance(source, str) else ""):
        try:
            doc = yaml.safe_load(body)
        except yaml.YAMLError:
            doc = "not yaml"
        sets = fence_run_sets(doc)
        if sets is None:
            fences.append(())
            fence_groups.append(())
            continue
        lines = [resolve(s) for s in sets]
        resolved = tuple(tuple(ids) for ids, _ in lines)
        fences.append(resolved)
        fence_groups.append(tuple(groups for _, groups in lines))
        if not isinstance(doc, dict):
            continue

        block_runs: list[str] = [rid for ids in resolved for rid in ids]
        view = doc.get("view")
        if isinstance(view, dict):
            for key in ("hidden", "pinned"):
                if _str_list(view.get(key)):
                    block_runs += view[key]
            if isinstance(view.get("baseline"), str) and view["baseline"]:
                block_runs.append(view["baseline"])

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
            settings = card.get("settings")
            if isinstance(settings, dict) and isinstance(settings.get("viewer"), str):
                version = settings.get("viewer_version")
                viewer_refs.add((settings["viewer"], version if isinstance(version, (int, str)) else None))
            elif card.get("type") == "custom" or card.get("type") in BUILTIN_TYPES:
                auto_viewers.add(card["type"])
            run_ids.update(named)
            if card.get("type") == CODE_DIFF_CARD:
                # A viewer may point the diff at any run of its cell.
                source_run_ids.update(block_runs)
                source_run_ids.update(named)

    viewer_versions = {
        vid for name, version in sorted(viewer_refs, key=repr)
        if (vid := resolve_viewer_version(db, project_id, name, version)) is not None
    }
    if auto_viewers:
        # The default viewers of the report's kinds: a built-in type's project
        # default (none: its built-in renderer), and for custom data every
        # default of a custom kind plus, for kinds without one, the viewers
        # accepting custom data (the UI's fallback).
        defaults = list_defaults(db, project_id)
        names = {
            viewer for t in auto_viewers if t in BUILTIN_TYPES
            if (viewer := default_for_subject(defaults, t)) is not None
        }
        if "custom" in auto_viewers:
            names |= {viewer for key, viewer in defaults.items() if key.startswith("custom:")}
        for v in published_viewers(db, project_id):
            accepts = v.get("accepts") or []
            if v.get("error") or not isinstance(accepts, list):
                continue
            if v["name"] in names or (
                "custom" in auto_viewers and any(str(p).startswith("custom:") for p in accepts)
            ):
                viewer_versions.add(v["version_id"])
    return ShareScope(
        report_id=report["id"],
        project_id=project_id,
        run_ids=frozenset(run_ids),
        source_run_ids=frozenset(source_run_ids),
        viewer_versions=frozenset(viewer_versions),
        run_sets=tuple(fences),
        run_set_groups=tuple(fence_groups),
    )


class ScopeCache:
    """Per-share scopes, each recomputed after ``SCOPE_TTL_S``."""

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
