import type { Series } from "../types";

/**
 * Merge multiple series into a single row-per-x dataset for Recharts.
 * Each row: `{ x, [seriesKey]: y, [seriesKey + "__raw"]: rawY, ... }`.
 * Missing series at a given x produce null (Recharts' connectNulls handles it).
 */
export function mergeToRows(
  series: Series[],
): Array<{ x: number } & Record<string, number | null | string>> {
  type Row = { x: number } & Record<string, number | null | string>;
  const byX = new Map<number, Row>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byX.get(p.x) ?? ({ x: p.x } as Row);
      row[s.key] = p.y;
      if (p.wallTime != null) row[`${s.key}__wall`] = p.wallTime;
      if (p.context != null) row[`${s.key}__ctx`] = p.context;
      byX.set(p.x, row);
    }
    if (s.rawPoints) {
      for (const p of s.rawPoints) {
        const row = byX.get(p.x) ?? ({ x: p.x } as Row);
        row[`${s.key}__raw`] = p.y;
        byX.set(p.x, row);
      }
    }
  }
  return Array.from(byX.values()).sort((a, b) => a.x - b.x);
}
