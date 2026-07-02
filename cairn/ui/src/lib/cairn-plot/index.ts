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
} from "./types";

// Palette
export { SERIES_COLORS } from "./types";

// Colormaps
export { viridis, DIVERGING_COLORMAPS, getColormapLUT } from "./colormaps";

// Image processing
export { getRenderMode, setRenderMode } from "./image";
export type { RenderMode } from "./image";

// Transforms
export {
  mapToXAxis,
  strideDownsample,
  emaSmooth,
  filterOutliers,
} from "./transforms";
export type { AxisSource, ParetoDirection } from "./transforms";

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
