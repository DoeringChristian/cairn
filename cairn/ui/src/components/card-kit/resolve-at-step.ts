// Constraint kept free of an index signature so plain interfaces (e.g.
// SequencePoint) satisfy it — TS does not give interfaces implicit string
// index signatures, so `{ step: number; [k: string]: unknown }` would reject them.
export interface SteppedPoint {
  step: number;
}

export interface ResolveAtStepOptions {
  /**
   * Fall back to the smallest point *above* `step` when the run has nothing at
   * or below it. Opt-in: it is what keeps a comparison pane on screen for a run
   * whose first artifact lands later than its neighbours', but cards that treat
   * "nothing logged yet at this step" as a real, displayable state
   * (VideoPlayerCard, FigureInteractiveCard) must keep seeing `null`.
   */
  nearest?: boolean;
}

/**
 * Largest point with `point.step <= step`; `null` when none qualifies.
 *
 * With `{ nearest: true }` a run that only starts logging above `step` resolves
 * to its first point instead, so `null` then means only "this run has no points
 * at all".
 *
 * Assumes `points` are sorted ascending by step (as returned by the sequence
 * API). The scan short-circuits once it passes `step`, so callers relying on
 * that ordering keep their previous behavior.
 */
export function resolveAtStep<T extends SteppedPoint>(
  points: T[],
  step: number,
  options?: ResolveAtStepOptions,
): T | null {
  let best: T | null = null;
  for (const p of points) {
    if (p.step <= step) {
      best = p;
      continue;
    }
    // First point above `step`; with ascending input it is the smallest one.
    if (best === null && options?.nearest) return p;
    break;
  }
  return best;
}
