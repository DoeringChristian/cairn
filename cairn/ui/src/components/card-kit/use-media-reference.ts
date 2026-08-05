import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../../api/client";
import { qk } from "../../api/query-keys";
import { useSequence } from "../../api/hooks";
import type { SequencePoint } from "../../api/types";
import { resolveReferenceHashes, type MissingArtifactMode } from "@cairn-plot/lib/cairn-plot/media-compare";

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
  /** source: "fixed-step" (reference.ts's `ReferenceSelection` third source)
   *  — pins the `seriesBaselineIndex` series to this explicit step instead
   *  of tracking `currentStep` 1:1. Undefined = plain "series-same-step"
   *  (per-iteration). Used by 3D cards' "pin reference to a fixed step"
   *  toggle — the general-N-panes form of the pre-unification
   *  `useTwoSeriesCompare`'s `refFixedStep`. */
  seriesBaselineFixedStep?: number;
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
  /** The external reference's own points for ONE pane in "per-run" scope
   *  (mirrors `perPaneHash`'s per-run branch) — added in WS-VC4 so a caller
   *  that needs the reference's own metadata (not just its resolved hash;
   *  e.g. pointcloud's point-count/channels for a per-pane reference blob)
   *  can look up the matching `SequencePoint` itself. Empty array when scope
   *  isn't "per-run" or no external reference is set. */
  perRunPoints: (paneIdx: number) => SequencePoint[];
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
    seriesBaselineFixedStep,
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

  // Per-pane external-reference points, index-aligned with `panes` (empty
  // unless external + "per-run" scope). This is the app data-model glue the
  // lib dispatch consumes; both `perRunPoints` (a public result) and the
  // dispatch's per-pane branch read it.
  const perPaneExternalPoints = useMemo(
    () => perRunRefQueries.map((q) => (q.data?.points ?? []).filter((p: SequencePoint) => p.artifact_hash)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perRunRefQueries.map((q) => q.dataUpdatedAt).join("|")],
  );

  // Pure reference-resolution dispatch lives in the lib
  // (`media-compare/reference.ts`); this hook only assembles the already-
  // fetched candidate data + persisted policy + live context and hands them
  // over. The `external`-vs-`externalScope` gating that keeps a stale
  // persisted scope from hiding a valid series baseline is encoded in the
  // lib `policy.hasExternal` gate.
  const { globalHash, perPaneHash } = useMemo(
    () =>
      resolveReferenceHashes<SequencePoint>(
        {
          hasExternal: !!external,
          externalScope,
          seriesBaselineIndex,
          seriesBaselineFixedStep,
        },
        {
          externalPoints,
          perPaneExternalPoints,
          seriesStepMap: (seriesBaselineIndex != null ? perSeriesStepMap[seriesBaselineIndex] : undefined) ?? new Map(),
          seriesSteps:
            (seriesBaselineIndex != null ? perSeriesPoints[seriesBaselineIndex]?.map((p) => p.step) : undefined) ?? [],
        },
        { currentStep, safeIdx, missingMode: missingImageMode },
      ),
    [
      external,
      externalScope,
      seriesBaselineIndex,
      seriesBaselineFixedStep,
      externalPoints,
      perPaneExternalPoints,
      perSeriesStepMap,
      perSeriesPoints,
      currentStep,
      safeIdx,
      missingImageMode,
    ],
  );

  const perRunPoints = (paneIdx: number): SequencePoint[] =>
    external && externalScope === "per-run" ? perPaneExternalPoints[paneIdx] ?? [] : [];

  return { globalHash, perPaneHash, externalPoints, perRunPoints };
}
