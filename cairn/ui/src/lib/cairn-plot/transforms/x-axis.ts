import type { SeriesPoint } from "../types";

export type AxisSource = "step" | "relative_time" | "wall_time";

/**
 * Map raw sequence points to (x, y) pairs based on the chosen x-axis source.
 *
 * Each raw point must have at least { step, scalar_value, wall_time }.
 * `runCreatedAt` is the epoch-ms creation time of the run — required for
 * relative_time mode where x = (wall_time - runCreatedAt) in seconds.
 */
export function mapToXAxis(
  raw: ReadonlyArray<{
    step: number;
    scalar_value: number | null;
    wall_time: string;
    context?: string | null;
  }>,
  source: AxisSource,
  runCreatedAt?: number | null,
): SeriesPoint[] {
  const mapped: SeriesPoint[] = [];
  for (const p of raw) {
    if (p.scalar_value == null) continue;
    let x: number;
    if (source === "step") {
      x = p.step;
    } else if (source === "wall_time") {
      const t = new Date(p.wall_time).getTime();
      if (!Number.isFinite(t)) continue;
      x = t;
    } else {
      const anchor = runCreatedAt ?? null;
      if (anchor == null) continue;
      const t = new Date(p.wall_time).getTime();
      if (!Number.isFinite(t)) continue;
      x = (t - anchor) / 1000;
    }
    mapped.push({
      x,
      y: p.scalar_value,
      wallTime: p.wall_time,
      context: p.context ?? null,
    });
  }
  mapped.sort((a, b) => a.x - b.x);
  return mapped;
}
