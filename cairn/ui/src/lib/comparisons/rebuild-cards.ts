// ---------------------------------------------------------------------------
// Rebuild a full card set from a run set's current sequences.
//
// Extracted from ComparePage's smart-filters "Refresh" handler so the same
// rebuild logic can also drive a dynamic `RunSelector`-bound comparison or
// report cards block (see lib/run-selector.ts) — one mechanism for "regrow
// this comparison/block's cards from whatever runs currently match",
// regardless of whether the run set was computed by param filters or a
// RunSelector query.
// ---------------------------------------------------------------------------

import { api } from "../../api/client";
import { newId } from "./store";
import type { ComparisonCard, ComparisonSeriesRef } from "./types";

/**
 * Fetch each run's current sequences and group same-named series (across
 * runs) into one card per (name, object_type) — a full replace, not a
 * merge. Runs with no matching series simply contribute nothing.
 */
export async function rebuildCardsFromRuns(runIds: string[]): Promise<ComparisonCard[]> {
  if (runIds.length === 0) return [];
  const seqResults = await Promise.all(runIds.map((rid) => api.sequences(rid)));

  const cardMap = new Map<
    string,
    { name: string; object_type: string; series: ComparisonSeriesRef[] }
  >();
  seqResults.forEach((result, idx) => {
    const runId = runIds[idx]!;
    for (const seq of result.sequences) {
      const key = `${seq.name}::${seq.object_type}`;
      const existing = cardMap.get(key);
      if (existing) {
        if (!existing.series.some((s) => s.runId === runId && s.name === seq.name)) {
          existing.series.push({ runId, name: seq.name, context_hash: seq.context_hash });
        }
      } else {
        cardMap.set(key, {
          name: seq.name,
          object_type: seq.object_type,
          series: [{ runId, name: seq.name, context_hash: seq.context_hash }],
        });
      }
    }
  });

  return Array.from(cardMap.values()).map((c) => ({
    id: newId(),
    type: c.object_type as ComparisonCard["type"],
    series: c.series,
  }));
}
