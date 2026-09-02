import { PlotHost, type PlotSpec } from "@cairn-plot";

import { cairnPlotDataSource } from "./cairn-plot";

export type ColormapName = "turbo" | "magma" | "plasma" | "viridis" | "gray" | string;
export type BarCompareMode = "grouped" | "stacked" | "overlay";
export interface BarDatum { id: string; label: string; value: number; color?: string; runId?: string }
export interface ScatterPoint { id: string; x: number; y: number; color: number | null; label?: string }
export type ParetoDirection = "min-min" | "min-max" | "max-min" | "max-max";
export interface ParallelColumn { key: string; source: "param" | "metric"; log?: boolean; invert?: boolean; label?: string }
export interface ParallelRow { id: string; label?: string; values: Array<number | null>; raw: Array<string | null>; color?: number }
export interface HistogramData { counts: number[]; edges: number[] }
export interface TableData { columns: Array<{ name: string; type: "number" | "string" | "bool" | "other" }>; data: unknown[][] }

export const SERIES_COLORS = ["#60a5fa", "#f59e0b", "#34d399", "#f472b6", "#a78bfa", "#fb7185"];
export const COLORMAP_OPTIONS = ["turbo", "magma", "plasma", "gray"].map((id) => ({ id, label: id[0]!.toUpperCase() + id.slice(1) }));

export function InlinePlot({ type, className, ...props }: { type: string; className?: string; [key: string]: unknown }) {
  const spec = {
    root: { kind: "plot", type, data: { kind: "inline", props } },
  } as PlotSpec;
  return <PlotHost spec={spec} dataSource={cairnPlotDataSource} className={className ?? ""} />;
}

export function HistogramPlot(props: Record<string, unknown>) {
  return <InlinePlot type="histogram" {...props} />;
}

export function Heatmap(props: Record<string, unknown>) {
  return <InlinePlot type="heatmap" {...props} />;
}

export function BarChart(props: Record<string, unknown>) {
  return <InlinePlot type="bar" {...props} />;
}

export function ScatterPlot(props: Record<string, unknown>) {
  return <InlinePlot type="scatter" {...props} />;
}

export function ParallelCoords(props: Record<string, unknown>) {
  return <InlinePlot type="parallel" {...props} />;
}

export function TablePlot(props: Record<string, unknown>) {
  return <InlinePlot type="table" {...props} />;
}

export function formatNum(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return Number(value.toPrecision(4)).toString();
}

export function computeHistogram(values: ArrayLike<number>, bins = 64): HistogramData {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min)) [min, max] = [0, 1];
  if (min === max) [min, max] = [min - 0.5, max + 0.5];
  const width = (max - min) / bins;
  const counts = new Array<number>(bins).fill(0);
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!Number.isFinite(value)) continue;
    const bin = Math.max(0, Math.min(bins - 1, Math.floor((value - min) / width)));
    counts[bin]!++;
  }
  return { counts, edges: Array.from({ length: bins + 1 }, (_, index) => min + index * width) };
}
