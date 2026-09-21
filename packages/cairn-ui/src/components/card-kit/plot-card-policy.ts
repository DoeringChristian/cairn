export interface PlotCardPolicy {
  colSpan: 3 | 4;
  defaultHeight: number;
}

const LARGE_INTERACTIVE = new Set(["figure", "pointcloud", "mesh", "boxes3d", "volume"]);

/** One dashboard default policy for every cairn-plot-backed card. */
export function plotCardPolicy(kind: string): PlotCardPolicy {
  if (LARGE_INTERACTIVE.has(kind)) return { colSpan: 4, defaultHeight: 400 };
  if (kind === "scalar") return { colSpan: 3, defaultHeight: 300 };
  return { colSpan: 3, defaultHeight: 360 };
}
