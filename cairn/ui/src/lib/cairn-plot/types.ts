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

export interface ImageViewportState {
  zoom: number;
  pan: { x: number; y: number };
}

// ── Events (library → card) ──

export interface HoverEvent {
  point: { x: number; y: number };
  screen: { x: number; y: number };
  seriesKey: string;
}

export interface ClickEvent {
  seriesKey?: string;
  pointId?: string;
  point: { x: number; y: number };
}
