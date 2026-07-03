import { SERIES_COLORS, type PlotlyFigureLike } from "../types";

/**
 * Trace types that can't be usefully overlaid onto a single 2D cartesian
 * plot: 3D scenes, geo/mapbox, polar/ternary/carpet subplots, and "domain"
 * traces (pie, sankey, tables, ...) that don't use xaxis/yaxis at all.
 */
const BLOCKED_TRACE_TYPES = new Set([
  // 3D
  "scatter3d",
  "surface",
  "mesh3d",
  "cone",
  "streamtube",
  "volume",
  "isosurface",
  // geo / mapbox
  "scattergeo",
  "choropleth",
  "scattermapbox",
  "choroplethmapbox",
  "densitymapbox",
  // polar / ternary / carpet
  "scatterpolar",
  "scatterpolargl",
  "barpolar",
  "scatterternary",
  "carpet",
  "scattercarpet",
  "contourcarpet",
  // domain traces (no x/y position)
  "pie",
  "sunburst",
  "treemap",
  "icicle",
  "funnelarea",
  "indicator",
  "table",
  "parcoords",
  "parcats",
  "sankey",
]);

/** Trace types that draw a visible stroke via `line.color` (vs. marker-only types like `bar`). */
const LINE_TRACE_TYPES = new Set(["scatter", "scattergl"]);

/**
 * Above this many traces per run, per-run recoloring would erase meaningful
 * per-trace color distinctions (e.g. one line per class in an ROC/PR
 * figure) — see `mergeFigures`.
 */
const RECOLOR_MAX_TRACES_PER_RUN = 1;

export interface FigureMergeabilityResult {
  mergeable: boolean;
  /** Human-readable reason when `mergeable` is false — surfaced in the UI. */
  reason?: string;
}

/**
 * Pure mergeability check for the figure comparison "overlay" mode.
 *
 * Mergeable when every figure is a plain cartesian plot on a single
 * (xaxis, yaxis) pair — no subplot grids, no 3D/geo/polar/domain traces —
 * and, when explicitly set, axis types agree across figures. Figures that
 * fail this check should stay in "panes" (side-by-side) mode rather than
 * being forced into a merge that would misrender.
 */
export function checkFigureMergeable(
  figures: PlotlyFigureLike[],
): FigureMergeabilityResult {
  if (figures.length < 2) {
    return { mergeable: false, reason: "need at least 2 figures" };
  }

  let axisXType: unknown;
  let axisYType: unknown;
  let sawXType = false;
  let sawYType = false;

  for (const fig of figures) {
    const layout = fig.layout ?? {};

    const xAxisKeys = Object.keys(layout).filter((k) => /^xaxis\d*$/.test(k));
    const yAxisKeys = Object.keys(layout).filter((k) => /^yaxis\d*$/.test(k));
    if (xAxisKeys.length > 1 || yAxisKeys.length > 1 || layout.grid != null) {
      return { mergeable: false, reason: "figure has multiple subplots" };
    }
    if (layout.scene != null) {
      return { mergeable: false, reason: "figure has a 3D scene" };
    }
    if (layout.polar != null || layout.ternary != null) {
      return { mergeable: false, reason: "figure has a polar/ternary subplot" };
    }
    if (layout.geo != null) {
      return { mergeable: false, reason: "figure has a geo subplot" };
    }

    for (const traceUnknown of fig.data ?? []) {
      const trace = traceUnknown;
      const type = typeof trace.type === "string" ? trace.type : "scatter";
      if (BLOCKED_TRACE_TYPES.has(type)) {
        return { mergeable: false, reason: `unsupported trace type "${type}"` };
      }
      const xaxis = typeof trace.xaxis === "string" ? trace.xaxis : "x";
      const yaxis = typeof trace.yaxis === "string" ? trace.yaxis : "y";
      if (xaxis !== "x" || yaxis !== "y") {
        return { mergeable: false, reason: "figure has multiple subplots" };
      }
    }

    const xType = (layout.xaxis as Record<string, unknown> | undefined)?.type;
    const yType = (layout.yaxis as Record<string, unknown> | undefined)?.type;
    if (xType != null) {
      if (sawXType && axisXType !== xType) {
        return { mergeable: false, reason: "figures use different x-axis types" };
      }
      axisXType = xType;
      sawXType = true;
    }
    if (yType != null) {
      if (sawYType && axisYType !== yType) {
        return { mergeable: false, reason: "figures use different y-axis types" };
      }
      axisYType = yType;
      sawYType = true;
    }
  }

  return { mergeable: true };
}

/** One run's figure to fold into a merged overlay. */
export interface FigureMergeEntry {
  runId: string;
  /** Short display label for the run (e.g. "run-a"), used to prefix trace names. */
  runLabel: string;
  figure: PlotlyFigureLike;
}

/**
 * Drop fixed axis ranges from a layout (shallow clone) so the merged figure
 * autoranges over every run's data instead of clipping to whichever run's
 * range was copied.
 */
function stripFixedRanges(layout: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...layout };
  for (const key of Object.keys(next)) {
    if (!/^[xy]axis\d*$/.test(key)) continue;
    const axis = next[key];
    if (!axis || typeof axis !== "object") continue;
    const axisObj = axis as Record<string, unknown>;
    if (!("range" in axisObj)) continue; // nothing fixed to strip on this axis
    const nextAxis: Record<string, unknown> = { ...axisObj };
    delete nextAxis.range;
    // Only default to `true` when the source figure didn't already have an
    // explicit autorange value — e.g. confusion_matrix sets
    // `yaxis.autorange: "reversed"` to keep the top-to-bottom class order;
    // that's not a "fixed range" and shouldn't be clobbered.
    if (nextAxis.autorange == null) nextAxis.autorange = true;
    next[key] = nextAxis;
  }
  return next;
}

/** Recolor a trace to `color`, on whichever of marker/line the trace type draws. */
function recolorTrace(trace: Record<string, unknown>, color: string): Record<string, unknown> {
  const type = typeof trace.type === "string" ? trace.type : "scatter";
  const next: Record<string, unknown> = {
    ...trace,
    marker: { ...((trace.marker as object) ?? {}), color },
  };
  if (LINE_TRACE_TYPES.has(type)) {
    next.line = { ...((trace.line as object) ?? {}), color };
  }
  return next;
}

/**
 * Merge each run's figure `data` traces into a single figure: layout comes
 * from the first run (fixed ranges stripped so every run's data autoranges
 * into view), and every trace's name is prefixed with its run label
 * (`"run-a · precision"`).
 *
 * Callers should only pass entries that pass `checkFigureMergeable` — this
 * function does not itself validate mergeability.
 *
 * When every run contributes at most `RECOLOR_MAX_TRACES_PER_RUN` trace(s),
 * each run's trace(s) are recolored to a distinct palette color (from
 * `SERIES_COLORS`, cycled by run index) so runs read at a glance. With more
 * traces per run (e.g. one line per class in an ROC/PR figure), original
 * per-trace colors are kept instead and traces are grouped per run via
 * `legendgroup`/`legendgrouptitle` — recoloring would collapse meaningful
 * per-trace distinctions into a single run color.
 */
export function mergeFigures(entries: FigureMergeEntry[]): PlotlyFigureLike {
  if (entries.length === 0) return { data: [], layout: {} };

  const layout = stripFixedRanges(entries[0]!.figure.layout ?? {});
  const maxTracesPerRun = Math.max(
    ...entries.map((e) => (e.figure.data ?? []).length),
    0,
  );
  const recolor = maxTracesPerRun <= RECOLOR_MAX_TRACES_PER_RUN;

  const data: Record<string, unknown>[] = [];
  entries.forEach((entry, runIdx) => {
    const color = SERIES_COLORS[runIdx % SERIES_COLORS.length]!;
    for (const trace of entry.figure.data ?? []) {
      const origName = typeof trace.name === "string" && trace.name ? trace.name : undefined;
      let next: Record<string, unknown> = {
        ...trace,
        name: origName ? `${entry.runLabel} · ${origName}` : entry.runLabel,
        legendgroup: entry.runId,
        legendgrouptitle: { text: entry.runLabel },
      };
      if (recolor) next = recolorTrace(next, color);
      data.push(next);
    }
  });

  return { data, layout };
}
