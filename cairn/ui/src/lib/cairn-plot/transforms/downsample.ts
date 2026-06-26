import type { SeriesPoint } from "../types";

/**
 * Stride-sample an array of sorted points to at most `maxPoints`.
 * Keeps first and last points, evenly samples the rest.
 * Returns the input unchanged if already within the limit.
 */
export function strideDownsample(
  points: SeriesPoint[],
  maxPoints: number,
): SeriesPoint[] {
  if (points.length <= maxPoints) return points;
  const sampled: SeriesPoint[] = [points[0]!];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    sampled.push(points[Math.round(i * step)]!);
  }
  sampled.push(points[points.length - 1]!);
  return sampled;
}
