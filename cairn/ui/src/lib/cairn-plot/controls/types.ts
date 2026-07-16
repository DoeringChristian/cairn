/**
 * `controls/types.ts` — the renderer-agnostic control surface for cairn-plot's
 * 2D charts (Plotly-modebar parity, see the design plan
 * `docs/superpowers/specs/2026-07-16-cairn-plot-2d-plotly-parity.md`, §B.1).
 *
 * `PlotController` is the single imperative facade a `<PlotToolbar>` (S1) talks
 * to. Every renderer publishes one via an adapter hook
 * (`renderers/use-chart-controller.ts` for the SVG charts, plus Scalar/PC
 * variants). It is a superset of `useChartViewport`'s `ChartViewportActions`
 * and speaks the PUBLIC drag vocabulary (`"zoom"` — the toolbar's name for the
 * hook-internal `"box"`), so slices can layer on hover/spikelines/axis-scale/
 * selection without reworking the viewport hook.
 *
 * S0 introduces the TYPES only; behavior lands in later slices.
 */

/** Public drag vocabulary (Plotly's `dragmode`). The viewport hook's internal
 *  token for box-zoom is `"box"`; adapters translate `"zoom"` ↔ `"box"`. */
export type DragMode = "zoom" | "pan" | "select" | "lasso";

/** Hover behavior (Plotly's `hovermode`). `"closest"` = nearest point;
 *  `"x-unified"`/`"y-unified"` = shared crosshair tooltip across series. */
export type HoverMode = "closest" | "x-unified" | "y-unified";

/** Per-axis scale (Plotly's `type: "linear" | "log"`). */
export type AxisScale = "linear" | "log";

/** Which axis an axis-scoped control targets. */
export type ControllerAxis = "x" | "y";

/** Options for {@link PlotController.toPNG}. All optional; a renderer picks
 *  sensible defaults from its current size. */
export interface ToPNGOptions {
  /** Output width in px (defaults to the rendered width). */
  width?: number;
  /** Output height in px (defaults to the rendered height). */
  height?: number;
  /** Device-pixel scale factor for crisper exports (default 1). */
  scale?: number;
  /** Suggested filename (used when the caller triggers a download). */
  filename?: string;
}

/**
 * What a given renderer's controller can actually do. A superset of
 * `viewport/use-chart-viewport.ts`'s `ChartCapabilities`, so a toolbar can
 * capability-gate every group honestly. Not-yet-implemented features are simply
 * reported `false` by the adapter until their slice lands.
 */
export interface ControllerCapabilities {
  zoom: boolean;
  pan: boolean;
  boxZoom: boolean;
  select: boolean;
  lasso: boolean;
  autoscale: boolean;
  reset: boolean;
  screenshot: boolean;
  hover: boolean;
  spikelines: boolean;
  hoverModes: boolean;
  legend: boolean;
  axisScaleToggle: boolean;
  perAxisDrag: boolean;
  brush: boolean;
  reorder: boolean;
}

/**
 * The imperative facade a `<PlotToolbar>` drives. One per renderer instance,
 * produced by an adapter hook over that renderer's viewport state.
 */
export interface PlotController {
  /** Honest capability descriptor — toolbar groups gate on this. */
  capabilities: ControllerCapabilities;

  /** Current public drag mode. */
  dragMode: DragMode;
  /** Current hover mode. */
  hoverMode: HoverMode;
  /** Whether spikelines (crosshair guides) are shown. */
  spikelines: boolean;
  /** True when the view differs from its autoscaled "home". */
  isModified: boolean;

  setDragMode(m: DragMode): void;
  setHoverMode(m: HoverMode): void;
  toggleSpikelines(): void;

  zoomIn(): void;
  zoomOut(): void;
  autoscale(): void;
  reset(): void;

  /** Client-side PNG export of the current view. */
  toPNG(opts?: ToPNGOptions): Promise<Blob>;

  /** Present only when the renderer supports per-axis log/linear toggling. */
  setAxisScale?(axis: ControllerAxis, scale: AxisScale): void;
  getAxisScale?(axis: ControllerAxis): AxisScale;

  /** Present only when the renderer supports box/lasso selection. */
  selection?: {
    ids: ReadonlySet<string>;
    clear(): void;
  };
}
