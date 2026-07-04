/**
 * Build the union of metrics available across a set of runs — extracted
 * from AddCardModal's "grouped/allTypes" scan (components/AddCardModal.tsx)
 * so the ```cairn dialect interpreter (lib/reports/cairn-block.ts) can
 * resolve a bare `metric:` field to an `object_type` and a set of
 * (runId, context_hash) pairs the same way the Add Card modal does — one
 * scan, two consumers.
 *
 * Pure data shaping only; fetching (useQueries over api.sequences) stays at
 * the call site (AddCardModal already owns its fetch; the interpreter's
 * rendering component owns its own, see components/reports/CairnBlock.tsx).
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { SequenceMeta } from "../../api/types";

export interface MetricIndexEntry {
  name: string;
  object_type: string;
  runs: Array<{ runId: string; context_hash: string }>;
}

/** Keyed by `${name}::${object_type}` — the same grouping key AddCardModal uses. */
export type MetricIndex = Map<string, MetricIndexEntry>;

/**
 * Build the union of metrics across a set of runs' sequences. A metric name
 * may (rarely) appear with more than one `object_type` across runs — each
 * (name, object_type) pair gets its own entry, matching AddCardModal's
 * existing grouping semantics.
 */
export function buildMetricIndex(perRun: Array<{ runId: string; sequences: SequenceMeta[] }>): MetricIndex {
  const map: MetricIndex = new Map();
  for (const { runId, sequences } of perRun) {
    for (const seq of sequences) {
      const key = `${seq.name}::${seq.object_type}`;
      const existing = map.get(key);
      if (existing) {
        if (!existing.runs.some((r) => r.runId === runId)) {
          existing.runs.push({ runId, context_hash: seq.context_hash });
        }
      } else {
        map.set(key, {
          name: seq.name,
          object_type: seq.object_type,
          runs: [{ runId, context_hash: seq.context_hash }],
        });
      }
    }
  }
  return map;
}

/** All entries for a given metric `name`, across every `object_type` it appears as. */
export function metricEntriesByName(index: MetricIndex, name: string): MetricIndexEntry[] {
  return Array.from(index.values()).filter((e) => e.name === name);
}

/**
 * Fetch + build a `MetricIndex` for a run set — the same fetch AddCardModal
 * performs, extracted so the ```cairn render component
 * (components/reports/CairnFenceCard.tsx) can resolve a bare `metric:` field
 * without re-implementing the scan.
 */
export function useMetricIndex(runIds: string[]): { index: MetricIndex; isLoading: boolean } {
  const seqQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.sequences(rid),
      queryFn: () => api.sequences(rid),
      staleTime: 10_000,
    })),
  });

  const index = useMemo(
    () =>
      buildMetricIndex(
        seqQueries
          .map((q, idx) => ({ runId: runIds[idx], sequences: q.data?.sequences }))
          .filter((r): r is { runId: string; sequences: SequenceMeta[] } => !!r.runId && !!r.sequences),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("|"), seqQueries.map((q) => q.dataUpdatedAt).join("|")],
  );
  const isLoading = seqQueries.some((q) => q.isLoading);
  return { index, isLoading };
}
