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
 * Short format: name, with timestamp only when needed for disambiguation.
 *
 * Pass `siblingRunIds` (other run IDs shown alongside this one) to enable
 * smart disambiguation. Timestamp is appended only when multiple siblings
 * share the same display name.
 */
export function shortRunLabel(runId: string, siblingRunIds?: string[]): string {
  const run = runMetadataCache.get(runId);
  if (!run) return runId.length > 6 ? runId.slice(0, 6) : runId;

  const name = run.display_name ?? runId.slice(0, 6);

  // Check if disambiguation is needed
  let needsTimestamp = false;
  if (siblingRunIds && siblingRunIds.length > 1) {
    for (const sid of siblingRunIds) {
      if (sid === runId) continue;
      const other = runMetadataCache.get(sid);
      const otherName = other?.display_name ?? sid.slice(0, 6);
      if (otherName === name) {
        needsTimestamp = true;
        break;
      }
    }
  }

  if (needsTimestamp) {
    try {
      const d = new Date(run.created_at);
      const ts = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `${name} ${ts}`;
    } catch {
      return name;
    }
  }
  return name;
}

/**
 * Just the name, no timestamp.
 */
export function runName(runId: string): string {
  const run = runMetadataCache.get(runId);
  return run?.display_name ?? (runId.length > 6 ? runId.slice(0, 6) : runId);
}
