// Constraint kept free of an index signature so plain interfaces (e.g.
// SequencePoint) satisfy it — TS does not give interfaces implicit string
// index signatures, so `{ step: number; [k: string]: unknown }` would reject them.
export interface SteppedPoint {
  step: number;
}

/**
 * Largest point with `point.step <= step`; `null` when none qualifies.
 *
 * Assumes `points` are sorted ascending by step (as returned by the sequence
 * API). The scan short-circuits once it passes `step`, so callers relying on
 * that ordering keep their previous behavior.
 */
export function resolveAtStep<T extends SteppedPoint>(points: T[], step: number): T | null {
  let best: T | null = null;
  for (const p of points) {
    if (p.step <= step) best = p;
    else break;
  }
  return best;
}
