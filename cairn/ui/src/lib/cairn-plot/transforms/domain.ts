import type { AxisScale } from "../types";

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
