import { useMemo } from "react";
import type { SequencePoint } from "../../api/types";
import type { SeriesRef } from "./use-card-series";
import { resolveArtifactAtStep } from "@cairn-plot/lib/cairn-plot";

type MissingMode = "nothing" | "last_available" | undefined;

export interface PaneResolution {
  /** Per-pane resolved foreground `{hash, fallbackStep}` at the current step. */
  paneResolved: Array<{ hash: string | undefined; fallbackStep: number | null }>;
  /** Per-pane resolved foreground artifact hash (or null). */
  paneHashArr: Array<string | null>;
  /** Per-pane resolved foreground `artifact_metadata` string (or null). */
  paneMetadata: Array<string | null>;
  /** Per-pane resolved foreground `artifact_mime` (or null). */
  paneMimes: Array<string | null>;
  /** Pane 0's resolution (drives the header download button). */
  firstResolved: { hash: string | undefined; fallbackStep: number | null };
  /** Pane 0's resolved point (its mime names the download extension). */
  firstPoint: SequencePoint | null;
  /** The download filename's mime — pane 0's real artifact mime, defaulting
   *  to image/png only when nothing is known (pre-refactor behavior). */
  downloadMime: string;
}

/**
 * Per-pane foreground resolution (hash + metadata + mime at the current
 * step), index-aligned with `effectiveMetrics`. Extracted verbatim from the
 * dissolved media shell; every per-kind media card composes this with
 * `useMediaSeriesData` + `useStepSlider`.
 */
export function usePaneResolution(
  effectiveMetrics: SeriesRef[],
  perSeriesStepMap: Map<number, SequencePoint>[],
  perSeriesPoints: SequencePoint[][],
  currentStep: number,
  missingImageMode: MissingMode,
): PaneResolution {
  const paneResolved = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const stepMap = perSeriesStepMap[i] ?? new Map();
      const steps = perSeriesPoints[i]?.map((p) => p.step) ?? [];
      return resolveArtifactAtStep(stepMap, currentStep, steps, missingImageMode);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, perSeriesStepMap, perSeriesPoints, currentStep, missingImageMode],
  );

  const paneMetadata = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const { hash, fallbackStep } = paneResolved[i] ?? { hash: undefined, fallbackStep: null };
      if (!hash) return null;
      const stepMap = perSeriesStepMap[i] ?? new Map();
      const step = fallbackStep ?? currentStep;
      return stepMap.get(step)?.artifact_metadata ?? null;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, perSeriesStepMap, paneResolved, currentStep],
  );

  const paneMimes = useMemo(
    () => effectiveMetrics.map((_, i) => {
      const { hash, fallbackStep } = paneResolved[i] ?? { hash: undefined, fallbackStep: null };
      if (!hash) return null;
      const stepMap = perSeriesStepMap[i] ?? new Map();
      const step = fallbackStep ?? currentStep;
      return stepMap.get(step)?.artifact_mime ?? null;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveMetrics, perSeriesStepMap, paneResolved, currentStep],
  );

  const firstResolved = paneResolved[0] ?? { hash: undefined, fallbackStep: null };

  const firstPoint = useMemo(() => {
    const step = firstResolved.fallbackStep ?? currentStep;
    return perSeriesStepMap[0]?.get(step) ?? null;
  }, [perSeriesStepMap, firstResolved.fallbackStep, currentStep]);

  return {
    paneResolved,
    paneHashArr: paneResolved.map((r) => r?.hash ?? null),
    paneMetadata,
    paneMimes,
    firstResolved,
    firstPoint,
    downloadMime: firstPoint?.artifact_mime ?? "image/png",
  };
}
