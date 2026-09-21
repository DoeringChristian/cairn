/**
 * Dynamic run selectors — a run-set binding that re-resolves against
 * `/api/runs` instead of pinning explicit run ids, so a comparison or report
 * cards block can "always track the N latest runs of this name" (or the
 * newest run per distinct name) without manual upkeep.
 *
 * Shared by both comparisons (`Comparison.runSelector`, see
 * lib/comparisons/types.ts) and reports (`CardsBlock.runSelector`, see
 * lib/reports/types.ts) — one mechanism, two consumers. See
 * `useRunSelectorResolution` in api/hooks.ts for the React Query wrapper
 * that keeps a resolved run-id list live (short staleTime + refetch on
 * window focus) and `components/RunSelectorBadge.tsx` for the shared
 * "auto" badge + manual refresh affordance.
 *
 * Deliberately NOT a replacement for `SmartFilters` (lib/comparisons/types.ts)
 * — smart filters match on run parameters (key/value/regex) and drive a
 * full param-based comparison-builder wizard; RunSelector matches on run
 * name and tags and is a much lighter, embeddable binding. A comparison
 * uses at most one of the two; see ComparePage.tsx's `runSelector`/
 * `smartFilters` handling for how the UI keeps that mutually exclusive and
 * visible.
 */

import type { Run } from "../api/types";

export interface StaticRunSelector {
  kind: "static";
  runIds: string[];
}

export interface QueryRunSelector {
  kind: "query";
  /** Substring match (case-insensitive), or a glob if it contains `*`. */
  namePattern?: string;
  /** Run must carry every one of these tags. */
  tags?: string[];
  /** "latest-n": the N most recently created matching runs.
   *  "newest-per-name": the single newest matching run per distinct display name. */
  mode: "latest-n" | "newest-per-name";
  /** Cap on the result count. Default 5. Applies to both modes. */
  n?: number;
}

export type RunSelector = StaticRunSelector | QueryRunSelector;

export const DEFAULT_RUN_SELECTOR_N = 5;

export function isRunSelector(x: unknown): x is RunSelector {
  if (!x || typeof x !== "object") return false;
  const s = x as Partial<RunSelector>;
  if (s.kind === "static") {
    return Array.isArray((s as StaticRunSelector).runIds);
  }
  if (s.kind === "query") {
    const q = s as QueryRunSelector;
    return q.mode === "latest-n" || q.mode === "newest-per-name";
  }
  return false;
}

export function isQueryRunSelector(x: RunSelector | undefined | null): x is QueryRunSelector {
  return !!x && x.kind === "query";
}

/** Parse a run's `tags` JSON-string column into a string array (empty on any parse failure). */
export function parseRunTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function matchesNamePattern(displayName: string | null, pattern?: string): boolean {
  if (!pattern) return true;
  const name = (displayName ?? "").toLowerCase();
  const p = pattern.toLowerCase();
  if (p.includes("*")) {
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    try {
      return new RegExp(`^${escaped}$`).test(name);
    } catch {
      return false;
    }
  }
  return name.includes(p);
}

function matchesTags(runTags: string | null, want?: string[]): boolean {
  if (!want || want.length === 0) return true;
  const have = new Set(parseRunTags(runTags));
  return want.every((t) => have.has(t));
}

/**
 * Pure resolution: given a pool of runs (already fetched, any order), return
 * the run ids `sel` selects. `runs` should be sorted `created_at` DESC for
 * "latest"/"newest" semantics to be meaningful — callers fetch from
 * `/api/runs`, which is already ordered that way, but this re-sorts
 * defensively so it's correct regardless of input order.
 */
export function resolveRunSelectorFromRuns(sel: RunSelector, runs: Run[]): string[] {
  if (sel.kind === "static") return sel.runIds;

  const sorted = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const candidates = sorted.filter(
    (r) => matchesNamePattern(r.display_name, sel.namePattern) && matchesTags(r.tags, sel.tags),
  );

  if (sel.mode === "latest-n") {
    const n = sel.n ?? DEFAULT_RUN_SELECTOR_N;
    return candidates.slice(0, n).map((r) => r.id);
  }

  // newest-per-name: first occurrence per display name (sorted desc, so the
  // first occurrence is the newest). Runs without a display name are each
  // treated as their own "name" (keyed by id) rather than collapsed together.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of candidates) {
    const key = r.display_name || r.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.id);
    if (sel.n != null && out.length >= sel.n) break;
  }
  return out;
}

/** Short human-readable description for a badge tooltip. */
export function describeRunSelector(sel: RunSelector): string {
  if (sel.kind === "static") return `${sel.runIds.length} fixed run(s)`;
  const parts: string[] = [];
  if (sel.namePattern) parts.push(`name matches "${sel.namePattern}"`);
  if (sel.tags && sel.tags.length > 0) parts.push(`tags: ${sel.tags.join(", ")}`);
  const n = sel.n ?? DEFAULT_RUN_SELECTOR_N;
  parts.push(sel.mode === "latest-n" ? `latest ${n}` : `newest per name${sel.n != null ? ` (max ${n})` : ""}`);
  return parts.join(" · ");
}
