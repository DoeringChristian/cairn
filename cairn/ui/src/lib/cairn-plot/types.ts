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
// The old per-card "compare mode" enum (side-by-side | split | blend) was
// replaced by the unified media-compare/mode.ts MediaCompareModeKind
// (normal | side | split | blend | diff) — see spec-visual-compare.md.

export interface ImageProcessing {
  brightness: number;
  contrast: number;
  gamma: number;
  exposure: number;
  offset: number;
  flipSign: boolean;
}

// ── Image overlays (bounding boxes + segmentation masks) ──

export interface OverlayBox {
  position: { minX: number; minY: number; maxX: number; maxY: number };
  /** "fraction" (0..1 of image dims) or "pixel". Defaults to "fraction". */
  domain?: "pixel" | "fraction";
  class_id: number;
  label?: string | null;
  score?: number | null;
}

export interface OverlayMask {
  /** Mask name (used as a stable key). */
  name: string;
  /** base64-encoded grayscale PNG; pixel value == class id (0 = background). */
  png_b64: string;
  class_labels?: Record<string, string>;
}

/** Parsed overlay payload for a single image (from artifact metadata). */
export interface ImageOverlayData {
  boxes?: OverlayBox[];
  masks?: OverlayMask[];
  class_labels?: Record<string, string>;
}

/** Persisted overlay display settings (card-owned). */
export interface ImageOverlaySettings {
  enabled: boolean;
  showBoxes: boolean;
  showMasks: boolean;
  /** Boxes with a score below this threshold are hidden (0..1). */
  scoreThreshold: number;
  /** Mask alpha (0..1). */
  maskOpacity: number;
  /** Class ids explicitly hidden. */
  hiddenClasses: number[];
}

export const DEFAULT_OVERLAY_SETTINGS: ImageOverlaySettings = {
  enabled: true,
  showBoxes: true,
  showMasks: true,
  scoreThreshold: 0,
  maskOpacity: 0.5,
  hiddenClasses: [],
};

// ── Scalar plot config ──

export interface PromotedSeriesConfig {
  min: number;
  max: number;
}

// ── Plotly figure types ──

/**
 * Minimal shape of a Plotly figure JSON (`data` + `layout`), as returned by
 * the `figure` card's plotly-source artifact fetch. Kept structural/loose
 * (traces as `Record<string, unknown>`) since cairn-plot's figure transforms
 * only need to inspect a handful of well-known keys (type, xaxis/yaxis,
 * name, marker/line) — full Plotly typings live in `@types/react-plotly.js`
 * / `plotly.js-dist-min` and are only needed at the render boundary.
 */
export interface PlotlyFigureLike {
  data?: Array<Record<string, unknown>>;
  layout?: Record<string, unknown>;
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

/** Stable per-class color from the shared categorical palette. */
export function overlayClassColor(classId: number): string {
  const n = SERIES_COLORS.length;
  return SERIES_COLORS[((classId % n) + n) % n]!;
}
