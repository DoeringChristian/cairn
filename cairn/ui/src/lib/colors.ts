/**
 * Shared color palette used across all multi-series card components.
 */
export const SERIES_COLORS = [
  "#0969da",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

/**
 * Approximate viridis colormap: dark purple -> teal -> yellow.
 * `t` is clamped to [0, 1].
 */
export function viridis(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(68 + t * (253 - 68));
  const g = Math.round(1 + t * (231 - 1));
  const b = Math.round(84 + (t < 0.5 ? t * 2 * (158 - 84) : (158 + (t - 0.5) * 2 * (37 - 158))));
  return `rgb(${r},${g},${b})`;
}
