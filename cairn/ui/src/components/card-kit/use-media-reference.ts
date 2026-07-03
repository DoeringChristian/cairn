import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { useSequence } from "../../api/hooks";
import type { SequencePoint } from "../../api/types";
import {
  resolveArtifactAtStep,
  resolveGlobalPositionalReference,
  type MissingArtifactMode,
} from "../../lib/cairn-plot/media-compare";

export interface MediaReferenceTag {
  runId?: string;
  name: string;
  context_hash: string;
}

export interface UseMediaReferenceArgs {
  /** Fallback run id (used when a tag doesn't carry its own runId). */
  runId: string;
  /** The card's own series data — the "series-same-step" source resolves
   *  against one of these, picked by `seriesBaselineIndex`. */
  perSeriesStepMap: Map<number, SequencePoint>[];
  perSeriesPoints: SequencePoint[][];
  /** source: "series-same-step" — index into the card's own series list. */
  seriesBaselineIndex?: number;
  /** source: "external" — a tag not among the card's own series (e.g. a
   *  dragged-in reference image/series). Undefined = no external reference. */
  external?: MediaReferenceTag;
  /** "global": one shared reference tracked positionally by `safeIdx`.
   *  "per-run": each pane's own run resolves its own copy of `external`,
   *  step-matched against `currentStep` (like "series-same-step"). */
  externalScope: "global" | "per-run";
  /** Panes to resolve a per-run external reference for — index-aligned with
   *  perSeriesStepMap/perSeriesPoints/the card's rendered panes. */
  panes: MediaReferenceTag[];
  currentStep: number;
  safeIdx: number;
  missingImageMode?: MissingArtifactMode;
}

export interface UseMediaReferenceResult {
  /** Single shared reference hash: "external"+"global" (positional) takes
   *  priority when an external tag is set with global scope, else falls
   *  back to the "series-same-step" (seriesBaselineIndex) resolution. */
  globalHash: string | undefined;
  /** Per-pane reference hash. Mirrors the pre-refactor
   *  `referenceMode === "per-run" ? perPaneBaselineHash[i] : baselineHash`
   *  dispatch exactly: per-run scope resolves per pane; every other case
   *  (including "series-same-step") broadcasts `globalHash` to all panes. */
  perPaneHash: (paneIdx: number) => string | undefined;
  /** The external reference series' own points, keyed off its own step
   *  axis (used to render an explicit REF pane in "global" scope). */
  externalPoints: SequencePoint[];
}

/**
 * Reference resolution — the react-query half. Composes the pure functions
 * in `lib/cairn-plot/media-compare/reference.ts` (resolveArtifactAtStep,
 * resolveGlobalPositionalReference) with the data fetching that only makes
 * sense at the app layer (react-query, api client). This + those pure
 * functions are the "one hook/function family" spec-visual-compare.md calls
 * for — moved verbatim in behavior from ImageGalleryCard's baseline
 * machinery (extBaseQuery / perRunRefQueries / baselineHash /
 * perPaneBaselineHash).
 */
export function useMediaReference(args: UseMediaReferenceArgs): UseMediaReferenceResult {
  const {
    runId,
    perSeriesStepMap,
    perSeriesPoints,
    seriesBaselineIndex,
    external,
    externalScope,
    panes,
    currentStep,
    safeIdx,
    missingImageMode,
  } = args;

  const extQuery = useSequence(external?.runId ?? runId, external?.name ?? "", {
    context: external?.context_hash || undefined,
    maxPoints: 500,
  });
  const externalPoints = useMemo(() => {
    if (!external || !extQuery.data) return [];
    return (extQuery.data.points ?? []).filter((p: SequencePoint) => p.artifact_hash);
  }, [external, extQuery.data]);

  const perRunRefQueries = useQueries({
    queries:
      external && externalScope === "per-run"
        ? panes.map((m) => ({
            queryKey: qk.refSeries(m.runId ?? runId, external.name, external.context_hash),
            queryFn: () =>
              api.sequence(m.runId ?? runId, external.name, {
                context: external.context_hash || undefined,
                maxPoints: 500,
              }),
            refetchInterval: 2000,
          }))
        : [],
  });

  const globalHash = useMemo(() => {
    if (external && externalScope === "global") {
      return resolveGlobalPositionalReference(externalPoints, safeIdx);
    }
    if (seriesBaselineIndex != null) {
      return resolveArtifactAtStep(
        perSeriesStepMap[seriesBaselineIndex] ?? new Map(),
        currentStep,
        perSeriesPoints[seriesBaselineIndex]?.map((p) => p.step) ?? [],
        missingImageMode,
      ).hash;
    }
    return undefined;
  }, [
    external,
    externalScope,
    externalPoints,
    safeIdx,
    seriesBaselineIndex,
    perSeriesStepMap,
    perSeriesPoints,
    currentStep,
    missingImageMode,
  ]);

  const perPaneHashes = useMemo(() => {
    if (!external || externalScope !== "per-run") return null;
    return panes.map((_, paneIdx) => {
      const points: SequencePoint[] = (perRunRefQueries[paneIdx]?.data?.points ?? []).filter(
        (p: SequencePoint) => p.artifact_hash,
      );
      if (points.length === 0) return undefined;
      const stepMap = new Map<number, SequencePoint>();
      for (const p of points) stepMap.set(p.step, p);
      const seriesSteps = points.map((p) => p.step);
      return resolveArtifactAtStep(stepMap, currentStep, seriesSteps, missingImageMode).hash;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external, externalScope, panes, perRunRefQueries.map((q) => q.dataUpdatedAt).join("|"), currentStep, missingImageMode]);

  const perPaneHash = (paneIdx: number): string | undefined =>
    externalScope === "per-run" ? perPaneHashes?.[paneIdx] : globalHash;

  return { globalHash, perPaneHash, externalPoints };
}
