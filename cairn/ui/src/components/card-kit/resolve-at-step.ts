// Constraint kept free of an index signature so plain interfaces (e.g.
// SequencePoint) satisfy it — TS does not give interfaces implicit string
// index signatures, so `{ step: number; [k: string]: unknown }` would reject them.
export interface SteppedPoint {
  step: number;
}

/**
 * Nearest point to `step`: the largest point with `point.step <= step`, and —
 * when the run only starts logging after `step` — the smallest point above it.
 * `null` only when the run has no points at all.
 *
 * Nearest (rather than "largest ≤ step, else null") is what keeps a pane on
 * screen for a run whose first artifact lands later than another run's. Callers
 * used to paper over the null with `?? points[0]`, which is exactly the point
 * this now returns for a below-first step; the callers that did not paper over
 * it dropped the pane out of the grid instead.
 *
 * Assumes `points` are sorted ascending by step (as returned by the sequence
 * API). The scan short-circuits once it passes `step`.
 */
export function resolveAtStep<T extends SteppedPoint>(points: T[], step: number): T | null {
  let best: T | null = null;
  for (const p of points) {
    if (p.step <= step) {
      best = p;
      continue;
    }
    // First point above `step`; with ascending input it is the smallest one.
    if (best === null) return p;
    break;
  }
  return best;
}
