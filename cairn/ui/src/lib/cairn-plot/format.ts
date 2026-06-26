import type { AxisSource } from "./transforms/x-axis";

export function formatNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000 || abs < 1e-3) return n.toExponential(3);
  return Number(n.toPrecision(5)).toString();
}

export function formatXTick(v: number, axis: AxisSource): string {
  if (!Number.isFinite(v)) return String(v);
  if (axis === "step") {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  if (axis === "relative_time") {
    if (v < 60) return `${v.toFixed(1)}s`;
    if (v < 3600) return `${(v / 60).toFixed(1)}m`;
    return `${(v / 3600).toFixed(2)}h`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString();
}
