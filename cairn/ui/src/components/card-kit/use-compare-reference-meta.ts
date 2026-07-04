import { useMemo } from "react";
import type { SequenceResponse } from "../../api/types";
import { safeJsonParse } from "../../lib/format";
import { resolveAtStep } from "./resolve-at-step";

/**
 * Resolves the parsed artifact metadata of the REFERENCE series (series[1])
 * at the compare step — the shared half of every 3D card's compare-mode
 * topology check. Each card previously repeated this
 * `referenceRawPoints → resolveAtStep → safeJsonParse` block (~15 lines);
 * they now call this hook and apply their own one-line type-specific
 * equality predicate (`n_vertices`+`n_faces` / `n_points` / `n_boxes` /
 * `shape`) to the returned meta.
 *
 * `referenceData` is series[1]'s raw sequence response (e.g.
 * `multiQueries[1]?.data`); `undefined` (single-series or not-yet-loaded)
 * yields `null`.
 */
export function useCompareReferenceMeta<T>(
  referenceData: SequenceResponse | undefined,
  refFixedStep: number | undefined,
  currentStep: number,
): T | null {
  return useMemo(() => {
    const points = (referenceData?.points ?? []).filter((p) => p.artifact_hash);
    if (points.length === 0) return null;
    const targetStep = refFixedStep ?? currentStep;
    const current = resolveAtStep(points, targetStep) ?? points[0];
    return safeJsonParse<T>(current?.artifact_metadata) ?? null;
  }, [referenceData, refFixedStep, currentStep]);
}
