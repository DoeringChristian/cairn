/**
 * Shared color palette used across all multi-series card components.
 * Re-exported from cairn-plot so this stays the single source of truth.
 */
// `viridis(t)` was retired upstream in favour of `colormapColor(name, t)`
// (colormaps/sample.ts); no app code called the function form.
export { SERIES_COLORS } from "@cairn-plot/lib/cairn-plot";
