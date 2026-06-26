import type { SeriesPoint } from "../types";

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (p <= 0) return sorted[0]!;
  if (p >= 100) return sorted[sorted.length - 1]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/**
 * Filter points by y-value percentile range [pLo, pHi].
 * pLo=0, pHi=100 is a no-op. Values are in percent (0–100).
 */
export function filterOutliers(
  points: SeriesPoint[],
  pLo: number,
  pHi: number,
): SeriesPoint[] {
  if ((pLo <= 0 && pHi >= 100) || points.length <= 1) return points;
  const ys = points.map((p) => p.y).slice().sort((a, b) => a - b);
  const yLo = percentile(ys, pLo);
  const yHi = percentile(ys, pHi);
  return points.filter((p) => p.y >= yLo && p.y <= yHi);
}
