import type { SeriesPoint } from "../types";

/**
 * Exponential moving average smoothing.
 * `alpha` is the weight on the previous smoothed value:
 *   y[i] = alpha * prev + (1 - alpha) * raw[i]
 *
 * Returns both the smoothed data and a copy of the raw data.
 * If alpha is 0, returns { smoothed: points, raw: null } (no-op).
 */
export function emaSmooth(
  points: SeriesPoint[],
  alpha: number,
): { smoothed: SeriesPoint[]; raw: SeriesPoint[] | null } {
  if (alpha <= 0 || points.length === 0) {
    return { smoothed: points, raw: null };
  }
  let prev = points[0]!.y;
  const smoothed = new Array<SeriesPoint>(points.length);
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]!.y;
    const sm = alpha * prev + (1 - alpha) * cur;
    smoothed[i] = { ...points[i]!, y: sm };
    prev = sm;
  }
  return { smoothed, raw: points };
}
