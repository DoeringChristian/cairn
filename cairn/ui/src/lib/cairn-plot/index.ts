// Types
export type {
  SeriesPoint,
  Series,
  ScatterPoint,
  ParallelColumn,
  ParallelRow,
  AxisScale,
  Viewport,
  DiffMode,
  Colormap,
  ColormapName,
  Interpolation,
  CompareMode,
  ImageProcessing,
} from "./types";

// Colormaps
export {
  viridis,
  buildLUT,
  COLORMAP_STOPS,
  DIVERGING_COLORMAPS,
  getColormapLUT,
  applyColormap,
} from "./colormaps";

// Image processing
export {
  computeDiff,
  loadImageData,
  DIFF_MODE_LABELS,
  webglRenderDiffToCanvas,
  isWebGL2Available,
  getRenderMode,
  setRenderMode,
  getCachedImageData,
  setCachedImageData,
} from "./image";
export type { WebGLDiffOptions, RenderMode } from "./image";

// Transforms
export {
  mapToXAxis,
  strideDownsample,
  emaSmooth,
  filterOutliers,
  mergeToRows,
  computeParetoFront,
  normalizeValue,
  resolveAxisDomain,
} from "./transforms";
export type { AxisSource, ParetoDirection } from "./transforms";

// Format
export { formatNum, formatXTick } from "./format";

// Hooks
export { useContainerSize, type ContainerSize } from "./hooks";
export { useModifierKey } from "./hooks";

// Primitives
export { Tooltip } from "./primitives";
export { PixelAxes } from "./primitives";
export { Colorbar } from "./primitives";
export { ColormapSwatch } from "./primitives";

// Renderers
export { ScatterPlot, type ScatterPlotProps } from "./renderers";
export { ParallelCoords, type ParallelCoordsProps } from "./renderers";
export { ScalarPlot, type ScalarPlotProps } from "./renderers";
export { ImagePane, type ImagePaneProps, type ImageProcessingProps } from "./renderers";
export { CompareImagePane, type CompareImagePaneProps } from "./renderers";
