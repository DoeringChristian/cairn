import { useMemo, useState } from "react";

export interface StepSliderState {
  /** Sorted union of steps across all series' points. */
  globalSteps: number[];
  /** Clamped current index into `globalSteps`. */
  safeIdx: number;
  /**
   * Step number at `safeIdx`, defaulting to `0` when there are no steps yet.
   *
   * Note: the design spec listed this as `number | undefined`, but every card
   * consumed it as `globalSteps[safeIdx] ?? 0` and passes it to `targetStep:
   * number` props. Returning a plain `number` here preserves that behavior
   * exactly and avoids sprinkling `?? 0` across ~15 call sites.
   */
  currentStep: number;
  /** Slider onChange handler: persists the index via `updateSettings({ sliderStep })`. */
  onSliderChange: (idx: number) => void;
}

/**
 * Owns the step-slider machinery shared by the artifact cards: it builds the
 * global step union from each series' points, tracks the live slider index
 * (seeded from the persisted `sliderStep` setting), clamps it as series grow or
 * shrink, and persists changes back under the same `sliderStep` key.
 */
export function useStepSlider(args: {
  /** Points per series, from the card's sequence queries (pre-filtered as needed). */
  seriesPoints: Array<Array<{ step: number }>>;
  /** Persisted slider index (settings.sliderStep). */
  persistedIdx: number | undefined;
  updateSettings: (patch: { sliderStep?: number }) => void;
}): StepSliderState {
  const { seriesPoints, persistedIdx, updateSettings } = args;

  const globalSteps = useMemo(() => {
    const stepSet = new Set<number>();
    for (const pts of seriesPoints) for (const p of pts) stepSet.add(p.step);
    return Array.from(stepSet).sort((a, b) => a - b);
  }, [seriesPoints]);

  const [idx, setIdx] = useState(persistedIdx ?? 0);
  const onSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, globalSteps.length - 1));
  const currentStep = globalSteps[safeIdx] ?? 0;

  return { globalSteps, safeIdx, currentStep, onSliderChange };
}
