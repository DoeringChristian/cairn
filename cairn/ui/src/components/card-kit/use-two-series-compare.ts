import { useMemo } from "react";
import { resolveArtifactAtStep, type StepArtifactPoint } from "../../lib/cairn-plot/media-compare";

export interface TwoSeriesCompareArgs<T extends StepArtifactPoint> {
  /** series[0] — the "primary" pane, always tracks `currentStep` (the
   *  card's own step slider) like every other 3D card rendering today. */
  primaryPoints: T[];
  /** series[1] — the "reference" pane. Per-iteration by default (same step
   *  as the primary); pin it to one step via `refFixedStep` for a
   *  global/fixed reference (mirrors the image card's baseline modes). */
  referencePoints: T[];
  currentStep: number;
  refFixedStep?: number;
}

export interface TwoSeriesCompareResult {
  primaryHash: string | undefined;
  referenceHash: string | undefined;
  /** The step actually resolved for the reference pane (for a "ref @ step
   *  N" label — differs from `currentStep` whenever `refFixedStep` is set,
   *  or from `refFixedStep` itself when that exact step has no artifact and
   *  a fallback was used). */
  referenceStep: number | null;
}

function stepMap<T extends StepArtifactPoint>(points: T[]): Map<number, T> {
  const m = new Map<number, T>();
  for (const p of points) m.set(p.step, p);
  return m;
}

/**
 * Per-iteration / fixed-step reference resolution for a 3D card's 2-series
 * compare feature, built directly on the media-compare module's extracted
 * pure function (`resolveArtifactAtStep` — see `reference.ts`) rather than
 * reimplementing step-matching (spec-visual-compare.md quality bar #4: one
 * reference-resolution implementation, actually called, not a private
 * copy). Shared by all four 3D card types' compare mode.
 */
export function useTwoSeriesCompare<T extends StepArtifactPoint>({
  primaryPoints,
  referencePoints,
  currentStep,
  refFixedStep,
}: TwoSeriesCompareArgs<T>): TwoSeriesCompareResult {
  const primaryStepMap = useMemo(() => stepMap(primaryPoints), [primaryPoints]);
  const referenceStepMap = useMemo(() => stepMap(referencePoints), [referencePoints]);
  const primarySteps = useMemo(() => primaryPoints.map((p) => p.step), [primaryPoints]);
  const referenceSteps = useMemo(() => referencePoints.map((p) => p.step), [referencePoints]);

  const primary = resolveArtifactAtStep(primaryStepMap, currentStep, primarySteps);
  const targetRefStep = refFixedStep ?? currentStep;
  const reference = resolveArtifactAtStep(referenceStepMap, targetRefStep, referenceSteps);

  return {
    primaryHash: primary.hash,
    referenceHash: reference.hash,
    referenceStep: reference.fallbackStep ?? targetRefStep,
  };
}
