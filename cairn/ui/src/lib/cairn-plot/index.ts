// Types
export type {
  Series,
  ScatterPoint,
  ParallelColumn,
  ParallelRow,
  AxisScale,
  DiffMode,
  Colormap,
  Interpolation,
  ImageProcessing,
  PromotedSeriesConfig,
  ColormapName,
  OverlayBox,
  OverlayMask,
  ImageOverlayData,
  ImageOverlaySettings,
  PlotlyFigureLike,
} from "./types";

// Palette
export { SERIES_COLORS, overlayClassColor } from "./types";

// Image overlays
export { DEFAULT_OVERLAY_SETTINGS } from "./types";

// Colormaps
export { viridis, DIVERGING_COLORMAPS, getColormapLUT } from "./colormaps";

// npy/npz parsing + histogram transforms
export {
  parseNpy,
  parseNpz,
  computeHistogram,
  rebinHistograms,
} from "./transforms";
export type { NpyArray, HistogramData } from "./transforms";

// Image processing
export { getRenderMode, setRenderMode } from "./image";
export type { RenderMode } from "./image";

// Transforms
export {
  mapToXAxis,
  strideDownsample,
  emaSmooth,
  filterOutliers,
  checkFigureMergeable,
  mergeFigures,
} from "./transforms";
export type {
  AxisSource,
  ParetoDirection,
  FigureMergeabilityResult,
  FigureMergeEntry,
} from "./transforms";

// Formatting
export { formatNum } from "./format";

// Hooks
export { useContainerSize } from "./hooks";

// Primitives
export { Colorbar } from "./primitives";
export { ColormapSwatch } from "./primitives";
export { LabelChip } from "./primitives";

// Renderers
export { ScatterPlot } from "./renderers";
export {
  BarChart,
  type BarChartProps,
  type BarDatum,
  type BarCompareMode,
} from "./renderers";
export { ParallelCoords } from "./renderers";
export { ScalarPlot } from "./renderers";
export { ImagePane } from "./renderers";
export { Heatmap } from "./renderers";
export { HistogramPlot } from "./renderers";
export { ImageOverlay } from "./renderers";
export { PointCloudViewer, resolveColorMode } from "./renderers";
export type {
  PointCloudViewerProps,
  PointCloudChannels,
  PointColorMode,
  PointCloudBackground,
  PointCloudBounds,
} from "./renderers";
export { Table } from "./renderers";
export type { TableProps, TableData, TableColumn, ColumnType } from "./renderers";
// NOTE: `Figure` (and its Plotly dependency) is intentionally NOT re-exported
// from this barrel, or from "./renderers" — many eagerly-bundled cards
// (ScalarPlotCard, HistogramCard, TensorCard, VisualContentCard,
// viewport-registry) statically import from "../lib/cairn-plot" /
// "../lib/cairn-plot/renderers", and plotly.js-dist-min is a large
// non-tree-shakeable (UMD-style) bundle: merely being *reachable* through a
// re-export chain pulls its full ~5MB into the eager main chunk even when
// unused. Import Figure directly from "../lib/cairn-plot/renderers/Figure"
// (only reached by the lazy FigureInteractiveCard) to keep it in its own
// async chunk.

// media-compare — unified visual-media comparison core (see media-compare/index.ts)
export {
  MEDIA_COMPARE_MODE_KINDS,
  isCoreCompareMode,
  resolveArtifactAtStep,
  resolveGlobalPositionalReference,
  CompositeMediaPane,
  CrossTypeCompositeMediaPane,
  migrateLegacyMode,
  LEGACY_MODE_MIGRATION_TABLE,
  alignFrameSourcesForDiff,
} from "./media-compare";
export type {
  MediaCompareModeKind,
  MediaCompareMode,
  SplitConfig,
  BlendConfig,
  DiffConfig,
  StepArtifactPoint,
  MissingArtifactMode,
  ReferenceSource,
  ReferenceSelection,
  CompositeMediaPaneProps,
  LegacyModeInputs,
  RasterAlignmentResult,
} from "./media-compare";

// Viewport — the pluggable-rendering contract behind VisualContentCard
// (see viewport/types.ts).
export {
  ImageViewportPane,
  imageViewportCapabilities,
  CROSS_TYPE_VISUAL_OBJECT_TYPES,
  canCrossTypeCompare,
  createEndpointDataSource,
  resolveImageViewportItems,
  fetchPointCloudArrays,
} from "./viewport";
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
  ImageViewportItem,
  ImageViewState,
  ImageViewportSettings,
  DataSource,
  PointCloudArrays,
} from "./viewport";
