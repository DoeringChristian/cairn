/**
 * Shared run label formatting.
 *
 * Displays run name + timestamp instead of raw hash IDs.
 * Falls back to short hash when no metadata is available.
 *
 * The cache is a module-global Map. Components that depend on label output
 * should include `runMetadataVersion` (from `useRunMetadataVersion()`) in
 * their useMemo deps so they recompute when the cache is populated.
 */

import { useSyncExternalStore } from "react";
import type { Run } from "../api/types";

/** Map of runId → Run for label lookup. */
let runMetadataCache = new Map<string, Run>();

/** Monotonic version counter — bumped on every cache mutation. */
let _version = 0;
const _listeners = new Set<() => void>();

function _notify() {
  _version++;
  for (const l of _listeners) l();
}

/** Subscribe to cache changes (for useSyncExternalStore). */
function _subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

function _getVersion() { return _version; }

/**
 * React hook: returns a version number that increments whenever the run
 * metadata cache changes. Include this in useMemo deps to recompute labels.
 */
export function useRunMetadataVersion(): number {
  return useSyncExternalStore(_subscribe, _getVersion, _getVersion);
}

export function setRunMetadata(runs: Run[]): void {
  const next = new Map<string, Run>();
  for (const r of runs) next.set(r.id, r);
  runMetadataCache = next;
  _notify();
}

export function addRunMetadata(run: Run): void {
  runMetadataCache.set(run.id, run);
  _notify();
}

/**
 * Format a run label: "display_name · HH:MM:SS" or short hash fallback.
 */
export function formatRunLabel(runId: string): string {
  const run = runMetadataCache.get(runId);
  if (run) {
    const name = run.display_name ?? runId.slice(0, 6);
    try {
      const d = new Date(run.created_at);
      const ts = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `${name} · ${date} ${ts}`;
    } catch {
      return name;
    }
  }
  return runId.length > 6 ? runId.slice(0, 6) : runId;
}

/**
 * Generate minimal disambiguating labels for a set of runs.
 *
 * Returns a map of `runId → label` where each label is the shortest form
 * that uniquely identifies the run within the input set. The strategy
 * (per group of runs sharing a name):
 *
 *   1. Just the name        — when the name is unique across the input.
 *   2. `name HH:MM:SS`      — when ≥2 runs share a name, all on the same day.
 *   3. `name MMM dd HH:MM:SS` — when ≥2 runs share a name across days.
 *   4. `name HH:MM:SS (abc123)` — when even the timestamp collides.
 *   5. `abc123` (6-char hash) — when no metadata is available.
 *
 * Each name-group is independent: singleton groups always get the bare name,
 * even if other groups need timestamps.
 */
export function disambiguateRunLabels(runIds: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  if (runIds.length === 0) return result;

  // Resolve metadata for each run (use cached fallback for unknowns).
  type Resolved = {
    runId: string;
    name: string;
    date: Date | null;
  };
  const resolved: Resolved[] = runIds.map((runId) => {
    const run = runMetadataCache.get(runId);
    if (!run) {
      return { runId, name: runId.length > 6 ? runId.slice(0, 6) : runId, date: null };
    }
    let date: Date | null = null;
    try {
      const d = new Date(run.created_at);
      if (!Number.isNaN(d.getTime())) date = d;
    } catch { /* keep null */ }
    return { runId, name: run.display_name ?? runId.slice(0, 6), date };
  });

  // Group by name.
  const byName = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const arr = byName.get(r.name) ?? [];
    arr.push(r);
    byName.set(r.name, arr);
  }

  for (const [name, group] of byName) {
    if (group.length === 1) {
      result[group[0]!.runId] = name;
      continue;
    }

    // Determine if the group spans multiple days (need date prefix).
    const dayKeys = new Set(
      group.map((r) => (r.date ? r.date.toDateString() : "")),
    );
    const spansDays = dayKeys.size > 1;

    // First pass: name + (date?) + time
    const tentative: Record<string, string> = {};
    const seen = new Set<string>();
    let hasCollision = false;
    for (const r of group) {
      let label: string;
      if (r.date) {
        const ts = r.date.toLocaleTimeString(undefined, {
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        });
        if (spansDays) {
          const date = r.date.toLocaleDateString(undefined, {
            month: "short", day: "numeric",
          });
          label = `${name} ${date} ${ts}`;
        } else {
          label = `${name} ${ts}`;
        }
      } else {
        // No date metadata at all — fall back to hash suffix.
        label = `${name} (${r.runId.slice(0, 6)})`;
      }
      if (seen.has(label)) hasCollision = true;
      seen.add(label);
      tentative[r.runId] = label;
    }

    if (!hasCollision) {
      Object.assign(result, tentative);
      continue;
    }

    // Second pass: append a hash suffix to break ties.
    for (const r of group) {
      const base = tentative[r.runId]!;
      result[r.runId] = `${base} (${r.runId.slice(0, 6)})`;
    }
  }

  return result;
}

/**
 * Short format: name, with timestamp only when needed for disambiguation.
 *
 * Pass `siblingRunIds` (other run IDs shown alongside this one) to enable
 * smart disambiguation. Returns the shortest unique label per the rules
 * documented in :func:`disambiguateRunLabels`.
 */
export function shortRunLabel(runId: string, siblingRunIds?: string[]): string {
  if (!siblingRunIds || siblingRunIds.length === 0) {
    return runName(runId);
  }
  const ids = siblingRunIds.includes(runId) ? siblingRunIds : [...siblingRunIds, runId];
  const labels = disambiguateRunLabels(ids);
  return labels[runId] ?? runName(runId);
}

/**
 * Just the name, no timestamp.
 */
export function runName(runId: string): string {
  const run = runMetadataCache.get(runId);
  return run?.display_name ?? (runId.length > 6 ? runId.slice(0, 6) : runId);
}
