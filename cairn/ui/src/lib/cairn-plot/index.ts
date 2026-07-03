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

// Renderers
export { ScatterPlot } from "./renderers";
export { BarChart, type BarChartProps, type BarDatum } from "./renderers";
export { ParallelCoords } from "./renderers";
export { ScalarPlot } from "./renderers";
export { ImagePane } from "./renderers";
export { CompareImagePane } from "./renderers";
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
