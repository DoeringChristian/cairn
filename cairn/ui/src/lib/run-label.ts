/**
 * Shared run label formatting.
 *
 * Displays run name + timestamp instead of raw hash IDs.
 * Falls back to short hash when no metadata is available.
 */

import type { Run } from "../api/types";

/** Map of runId → Run for label lookup. */
let runMetadataCache = new Map<string, Run>();

export function setRunMetadata(runs: Run[]): void {
  const next = new Map<string, Run>();
  for (const r of runs) next.set(r.id, r);
  runMetadataCache = next;
}

export function addRunMetadata(run: Run): void {
  runMetadataCache.set(run.id, run);
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
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}

/**
 * Short format: just the name or short hash.
 */
export function shortRunLabel(runId: string): string {
  const run = runMetadataCache.get(runId);
  if (run?.display_name) return run.display_name;
  return runId.length > 6 ? runId.slice(0, 6) : runId;
}
