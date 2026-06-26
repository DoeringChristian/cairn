import type { AxisScale, SeriesPoint } from "../types";

/**
 * Compute data extent (min, max) across multiple arrays of series points.
 * Returns [0, 1] if no finite data is found; pads by ±0.5 if min === max.
 */
export function computeDataExtent(
  pointArrays: ReadonlyArray<ReadonlyArray<SeriesPoint>>,
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const pts of pointArrays) {
    for (const p of pts) {
      if (p.y < lo) lo = p.y;
      if (p.y > hi) hi = p.y;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) return [lo - 0.5, hi + 0.5];
  return [lo, hi];
}

/**
 * Resolve axis domain from hard range, viewport, and scale.
 * Viewport (from zoom/pan) wins over hard range which wins over auto.
 */
export function resolveAxisDomain(
  rangeLo: number | null,
  rangeHi: number | null,
  vpLo: number | null,
  vpHi: number | null,
  scale: AxisScale,
): [number | string, number | string] {
  const lo = vpLo ?? rangeLo;
  const hi = vpHi ?? rangeHi;
  const autoLo: number | string = scale === "log" ? "auto" : "dataMin";
  const autoHi: number | string = scale === "log" ? "auto" : "dataMax";
  return [lo ?? autoLo, hi ?? autoHi];
}
