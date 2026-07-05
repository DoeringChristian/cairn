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
import { buildMetricIndex, type MetricIndex } from "../reports/metric-index";
import { newId } from "./store";
import { isMultiRunCardType } from "./types";
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

/**
 * Re-resolve an existing card set against a (possibly changed) run set —
 * unlike `rebuildCardsFromRuns`, this does NOT discard/regrow cards. Each
 * existing card keeps its identity (`id`, `type`, curated series order) and
 * only has its `series` re-derived against `runIds`:
 *   - series entries whose `runId` fell out of the set are dropped;
 *   - for "simple" per-metric cards (every series entry shares one
 *     `name`/`object_type` — i.e. not a curated overlay of differing
 *     metrics), entries are added back for any newly-included run that
 *     carries that same metric;
 *   - kept entries have their `context_hash` refreshed from the run's
 *     current sequences.
 * Multi-run card types (parallel/scatter/bar/tile) don't key off `name`
 * (see `ReportCardRenderer`/`ComparisonCardRenderer` — they consume the
 * distinct `runId` set only), so their series is simply re-pointed at
 * `runIds` while preserving the card's label.
 *
 * This is the "re-resolve, don't regrow" fix for the #44 cluster: a
 * `RunSelector`-bound cards block whose resolved runs changed should rebind
 * curated cards to the new runs, not replace the whole card set.
 */
export async function rebindCardsToRuns(
  cards: ComparisonCard[],
  runIds: string[],
): Promise<ComparisonCard[]> {
  if (cards.length === 0) return cards;
  const seqResults = await Promise.all(runIds.map((rid) => api.sequences(rid)));
  const metricIndex = buildMetricIndex(
    runIds.map((runId, idx) => ({ runId, sequences: seqResults[idx]!.sequences })),
  );
  return rebindCardsToMetricIndex(cards, runIds, metricIndex);
}

/** Pure (no fetch) core of `rebindCardsToRuns` — reused where a metric index is already on hand. */
export function rebindCardsToMetricIndex(
  cards: ComparisonCard[],
  runIds: string[],
  metricIndex: MetricIndex,
): ComparisonCard[] {
  const runIdSet = new Set(runIds);
  return cards.map((card) => {
    if (isMultiRunCardType(card.type)) {
      const label = card.series[0]?.name ?? "";
      return { ...card, series: runIds.map((runId) => ({ runId, name: label, context_hash: "" })) };
    }

    const kept = card.series.filter((s) => runIdSet.has(s.runId));
    const keptRunIds = new Set(kept.map((s) => s.runId));
    const refreshed = kept.map((s) => {
      const entry = metricIndex.get(`${s.name}::${card.type}`);
      const match = entry?.runs.find((r) => r.runId === s.runId);
      return match ? { ...s, context_hash: match.context_hash } : s;
    });

    // Only "simple" per-metric cards (single shared name across all series —
    // i.e. not a manual/curated overlay of differing metrics) grow into
    // newly-included runs automatically.
    const names = new Set(card.series.map((s) => s.name));
    const added: ComparisonSeriesRef[] = [];
    if (names.size === 1) {
      const [name] = names;
      const entry = metricIndex.get(`${name}::${card.type}`);
      if (entry) {
        for (const r of entry.runs) {
          if (runIdSet.has(r.runId) && !keptRunIds.has(r.runId)) {
            added.push({ runId: r.runId, name: name!, context_hash: r.context_hash });
          }
        }
      }
    }

    return { ...card, series: [...refreshed, ...added] };
  });
}
