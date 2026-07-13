export type {
  FrameSource,
  ViewState,
  NativeModeSpec,
  ViewportCapabilities,
  ViewportSeriesRef,
  ViewportDataArgs,
  ViewportDataResult,
  ViewportPaneProps,
  ViewportModule,
} from "./types";

export {
  ImageViewportPane,
  imageViewportCapabilities,
  type ImageViewportItem,
  type ImageViewState,
  type ImageViewportSettings,
} from "./image-viewport";

export { CROSS_TYPE_VISUAL_OBJECT_TYPES, canCrossTypeCompare } from "./cross-type";

// Unified Plotly-style chart viewport (zoom/pan) shared by the 2D SVG/canvas
// chart renderers. Pure React + pure math, no heavy deps — eager-safe.
export {
  useChartViewport,
  CHART_CAPABILITIES,
  type ChartDomain,
  type ChartDragMode,
  type ChartCapabilities,
  type ChartViewportActions,
  type ChartViewportResult,
  type PlotRect,
  type UseChartViewportArgs,
} from "./use-chart-viewport";
export {
  applyConstraints,
  boxToDomain,
  panByPixels,
  wheelZoom,
  zoomAboutAnchor,
  WHEEL_FACTOR,
  BOX_THRESHOLD_PX,
  type ConstrainAxis,
  type DomainClamp,
  type MinSpan,
} from "./chart-viewport-math";

// The DataSource seam (hash -> TData mapping cores) — no heavy dependencies
// (parseNpy/parseNpz/PropertyMap are already eager-safe, see their own
// barrels), safe to re-export from this eagerly-reached barrel.
export {
  createEndpointDataSource,
  resolveImageViewportItems,
  fetchPointCloudArrays,
  fetchMeshArrays,
  fetchVolumeArray,
  fetchBoxesArrays,
  type DataSource,
  type PointCloudArrays,
  type MeshArrays,
  type BoxesArrays,
} from "./data-sources";

// Overlay-metadata parser (shared by the app's viewport-registry and the
// standalone plot bundle's LOCAL image provider). Pure, no `api` dependency.
export { parseOverlay } from "./parse-overlay";

// LOCAL content-addressed blob store (design spec §5) — the DataSource the
// standalone plot bundle uses for baked/self-contained data. Eager-safe
// (only imports the `DataSource` type).
export {
  createLocalDataSource,
  registerPlotStore,
  loadPlotStoreFromDom,
  PLOT_STORE_SCRIPT_ID,
  type PlotStore,
  type PlotStoreEntry,
} from "./local-store";

// NOTE: pointcloud-viewport.tsx (WS-VC4) is DELIBERATELY not re-exported
// from this barrel (or cairn-plot/index.ts's, both of which are imported
// eagerly by non-lazy call sites such as VisualContentCard.tsx). It pulls
// in `three`/`PointCloudViewer`, and this repo's existing lazy-loading
// boundary keeps that dependency out of the main bundle (see
// CardRenderer.tsx's `lazy(() => import("./PointCloudVisualCard"))`).
// Import it directly: `lib/cairn-plot/viewport/pointcloud-viewport`. Rollup
// tree-shaking would likely elide an unused barrel re-export too, but this
// avoids depending on that guarantee for a dependency this heavy.
