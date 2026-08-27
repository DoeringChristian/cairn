import { useMemo } from "react";
import type { SequencePoint } from "../../api/types";
import type { SeriesRef } from "./use-card-series";

export interface PaneReferenceMeta {
  /** Per-pane resolved reference hash (null when no reference applies). A
   *  resolved reference is ALWAYS honored, even when the content-addressed
   *  store deduped a byte-identical prediction and reference to the same
   *  hash — suppressing on hash equality used to silently collapse every
   *  mode to "normal" instead of letting diff render its natural all-zero
   *  result. */
  paneRefHashArr: Array<string | null>;
  /** The resolved reference's OWN `artifact_metadata` per pane — a 3D
   *  module's reference blob needs its own point-count/channels/bounds to
   *  render or diff against the foreground (image ignores this). */
  paneReferenceMetadata: Array<string | null>;
  /** Reference-side mime per pane — lets the async resolver decode an
   *  EXR/float reference so an EXR-vs-EXR compare runs true-HDR. */
  paneReferenceMimes: Array<string | null>;
}

/**
 * Reference-side per-pane resolution, looked up from whichever source
 * `useMediaReference` actually resolved each hash from: the external
 * reference's own points (global scope), its per-run points, or — the
 * series-same-step baseline — the card's own `perSeriesPoints`. Extracted
 * verbatim from the dissolved media shell.
 */
export function usePaneReferenceMeta(args: {
  effectiveMetrics: SeriesRef[];
  paneResolvedHashes: Array<string | null>;
  perPaneHash: (i: number) => string | null | undefined;
  externalBaseline: SeriesRef | undefined;
  referenceMode: "global" | "per-run";
  externalPoints: SequencePoint[];
  perRunPoints: (i: number) => SequencePoint[];
  perSeriesPoints: SequencePoint[][];
  baselineIndex: number | undefined;
}): PaneReferenceMeta {
  const {
    effectiveMetrics, paneResolvedHashes, perPaneHash, externalBaseline,
    referenceMode, externalPoints, perRunPoints, perSeriesPoints, baselineIndex,
  } = args;

  const paneRefHashArr = effectiveMetrics.map((_, i) => {
    const hash = paneResolvedHashes[i];
    const paneBaseline = perPaneHash(i);
    const hasRef = !!(paneBaseline && hash);
    return hasRef ? paneBaseline! : null;
  });

  const paneReferenceMetadata = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const refHash = paneRefHashArr[i];
      if (!refHash) return null;
      if (externalBaseline) {
        const pts = referenceMode === "per-run" ? perRunPoints(i) : externalPoints;
        return pts.find((p) => p.artifact_hash === refHash)?.artifact_metadata ?? null;
      }
      if (baselineIndex != null) {
        const pts = perSeriesPoints[baselineIndex] ?? [];
        return pts.find((p) => p.artifact_hash === refHash)?.artifact_metadata ?? null;
      }
      return null;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, paneRefHashArr.join("|"), externalBaseline, referenceMode, externalPoints, perRunPoints, perSeriesPoints, baselineIndex],
  );

  const paneReferenceMimes = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const refHash = paneRefHashArr[i];
      if (!refHash) return null;
      if (externalBaseline) {
        const pts = referenceMode === "per-run" ? perRunPoints(i) : externalPoints;
        return pts.find((p) => p.artifact_hash === refHash)?.artifact_mime ?? null;
      }
      if (baselineIndex != null) {
        const pts = perSeriesPoints[baselineIndex] ?? [];
        return pts.find((p) => p.artifact_hash === refHash)?.artifact_mime ?? null;
      }
      return null;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, paneRefHashArr.join("|"), externalBaseline, referenceMode, externalPoints, perRunPoints, perSeriesPoints, baselineIndex],
  );

  return { paneRefHashArr, paneReferenceMetadata, paneReferenceMimes };
}
