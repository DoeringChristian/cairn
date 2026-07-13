/**
 * Shared, theme-aware style tokens for cairn-plot's 2D chart renderers.
 *
 * Before this module every renderer hand-rolled its own tick font-sizes,
 * axis/frame colors, gridline dash patterns, margins and number formatting —
 * so the charts looked "wildly different" side by side (7/8/9/10/11px ticks,
 * three different frame colors, gridlines on some plots but not others). These
 * constants are the SINGLE source of truth: every 2D renderer (and the shared
 * `<Axis>` primitive) reads from here so the axes render identically.
 *
 * Colors are expressed as `var(--color-*, #fallback)` — the same pattern the
 * app already uses in ScalarPlot / scalar-tooltip. The fallback matches the
 * Tailwind palette (tailwind.config.ts) so today's light theme is unchanged,
 * while a future dark theme that injects `--color-*` overrides is picked up
 * automatically (a hardcoded `#d0d7de` frame is invisible/wrong on dark).
 */

/** Axis line, ticks, tick labels and axis title. */
export const AXIS = {
  /** Tick-label font size (px). One value for every renderer. */
  tickFontSize: 10,
  /** Monospace stack for numeric tick labels (tabular figures via `.mono`). */
  tickFontFamily:
    "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
  /** Tick-label fill. Tailwind `fg.subtle`. */
  tickColor: "var(--color-fg-subtle, #8b949e)",
  /** Axis line / plot-frame stroke. Tailwind `border.DEFAULT`. */
  lineColor: "var(--color-border, #d0d7de)",
  lineWidth: 1,
  /** Axis-title (caption) font size (px). */
  titleFontSize: 11,
  /** Axis-title fill. Tailwind `fg.muted`. */
  titleColor: "var(--color-fg-muted, #656d76)",
  /** Length of a tick mark (px). */
  tickLength: 4,
  /** Default number of ticks per axis (subject to "nice" rounding). */
  tickCount: 5,
} as const;

/** Background gridlines. */
export const GRID = {
  color: "var(--color-border, #d0d7de)",
  dash: "2 4",
  opacity: 0.5,
} as const;

/**
 * Baseline plot margins (px). One canonical gutter for every renderer;
 * renderers with a colorbar extend `right` locally.
 */
export const PLOT_MARGIN = { top: 12, right: 16, bottom: 28, left: 48 } as const;

/**
 * Pad an AUTO-computed numeric domain so data marks don't touch the plot frame
 * in the home/default position. `frac` is the fraction of the data range added
 * on EACH side (5% by default). Never apply to an explicit, user-set domain —
 * only to the auto/home domain.
 *
 * Degenerate ranges (min === max, or non-finite) get a small symmetric pad so
 * the single value still sits inside the frame.
 */
export function paddedDomain(
  min: number,
  max: number,
  frac = 0.05,
): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [min, max];
  if (min === max) {
    const p = Math.abs(min) * frac || 0.5;
    return [min - p, max + p];
  }
  const pad = (max - min) * frac;
  return [min - pad, max + pad];
}

/**
 * "Nice" evenly-spaced tick values across [min, max], targeting ~`count`
 * ticks. Rounds the step to a 1/2/5 × 10ⁿ value (the classic axis heuristic)
 * so labels land on human-friendly numbers. Falls back to `count+1` evenly
 * spaced samples for degenerate inputs.
 */
export function niceTicks(
  min: number,
  max: number,
  count = AXIS.tickCount,
): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [min];
  }
  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let niceStep: number;
  if (norm < 1.5) niceStep = 1;
  else if (norm < 3) niceStep = 2;
  else if (norm < 7) niceStep = 5;
  else niceStep = 10;
  niceStep *= mag;
  const start = Math.ceil(min / niceStep) * niceStep;
  const out: number[] = [];
  // Guard against pathological loops from tiny steps.
  for (let v = start, i = 0; v <= max + niceStep * 1e-6 && i < 1000; v += niceStep, i++) {
    // Snap away tiny FP dust (e.g. 0.30000000000000004).
    out.push(Math.abs(v) < niceStep * 1e-6 ? 0 : v);
  }
  return out.length ? out : [min, max];
}
