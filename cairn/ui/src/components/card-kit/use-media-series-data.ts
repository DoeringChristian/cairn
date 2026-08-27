import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import type { SequencePoint } from "../../api/types";
import type { SeriesRef } from "./use-card-series";

export interface MediaSeriesData {
  /** Artifact-bearing points per series, index-aligned with the input. */
  perSeriesPoints: SequencePoint[][];
  /** step -> point map per series, index-aligned with the input. */
  perSeriesStepMap: Map<number, SequencePoint>[];
  /** The union step axis (sorted), with a representative wall time per step. */
  globalStepPoints: Array<{ step: number; wall_time: string | null }>;
  anyLoading: boolean;
}

/**
 * The multi-series artifact-sequence fetch every per-kind media card shares
 * (image/mesh/pointcloud/boxes3d/volume): one polling react-query per series,
 * filtered to artifact-bearing points, plus the derived per-series step maps
 * and the union step axis. Extracted verbatim from the dissolved media shell.
 */
export function useMediaSeriesData(
  runId: string,
  effectiveMetrics: SeriesRef[],
): MediaSeriesData {
  const queries = useQueries({
    queries: effectiveMetrics.map((m) => ({
      queryKey: qk.sequence(m.runId ?? runId, m.name, m.context_hash),
      queryFn: () =>
        api.sequence(m.runId ?? runId, m.name, {
          context: m.context_hash || undefined,
        }),
      refetchInterval: 2000,
    })),
  });

  const { perSeriesPoints, perSeriesStepMap, globalStepPoints } = useMemo(() => {
    const psp = queries.map((q) =>
      (q.data?.points ?? []).filter((p: SequencePoint) => p.artifact_hash),
    );
    const maps = psp.map((pts) => {
      const m = new Map<number, SequencePoint>();
      for (const p of pts) m.set(p.step, p);
      return m;
    });
    const stepMap = new Map<number, string | undefined>();
    for (const pts of psp) for (const p of pts) {
      if (!stepMap.has(p.step)) stepMap.set(p.step, p.wall_time ?? undefined);
    }
    const steps = Array.from(stepMap.keys()).sort((a, b) => a - b);
    const stepPts = steps.map((s) => ({ step: s, wall_time: stepMap.get(s) ?? null }));
    return { perSeriesPoints: psp, perSeriesStepMap: maps, globalStepPoints: stepPts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join("|")]);

  return {
    perSeriesPoints,
    perSeriesStepMap,
    globalStepPoints,
    anyLoading: queries.some((q) => q.isLoading),
  };
}
