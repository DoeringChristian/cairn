// ── Data types ──

export interface SeriesPoint {
  x: number;
  y: number;
  wallTime?: string;
  context?: string | null;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  points: SeriesPoint[];
  rawPoints?: SeriesPoint[] | null;
}

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  color: number | null;
  label?: string;
}

export interface ParallelColumn {
  key: string;
  source: "param" | "metric";
  log?: boolean;
  invert?: boolean;
}

export interface ParallelRow {
  id: string;
  values: (number | null)[];
  raw: (string | null)[];
  label?: string;
}

// ── Axis config ──

export type AxisScale = "linear" | "log";

export interface Viewport {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

// ── Image types ──

export type DiffMode =
  | "signed"
  | "absolute"
  | "squared"
  | "relative_signed"
  | "relative_absolute"
  | "relative_squared";

export type Colormap = "none" | "viridis" | "red-green" | "red-blue";
export type ColormapName = Exclude<Colormap, "none">;
export type Interpolation = "auto" | "pixelated" | "crisp-edges";
export type CompareMode = "side-by-side" | "split" | "blend";

export interface ImageProcessing {
  brightness: number;
  contrast: number;
  gamma: number;
  exposure: number;
  offset: number;
  flipSign: boolean;
}

// ── Scalar plot config ──

export interface PromotedSeriesConfig {
  min: number;
  max: number;
}

// ── Palette ──

/** Shared categorical color palette used across all multi-series card components. */
export const SERIES_COLORS = [
  "#0969da",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];
