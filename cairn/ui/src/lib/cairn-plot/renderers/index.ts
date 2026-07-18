export { default as ScatterPlot, type ScatterPlotProps } from "./ScatterPlot";
export {
  default as BarChart,
  type BarChartProps,
  type BarDatum,
  type BarCompareMode,
} from "./BarChart";
export {
  default as ParallelCoords,
  type ParallelCoordsProps,
} from "./ParallelCoords";
export { default as ScalarPlot, type ScalarPlotProps } from "./ScalarPlot";
// The unified CPU image backend + the shared backend contract. `ImagePane`/
// `HdrImagePane` below are thin compatibility shims over `CpuImagePane`
// (`toolbar={false}` legacy chrome) — see `image-backend.ts`'s module doc.
export { default as CpuImagePane, type CpuImagePaneProps } from "./CpuImagePane";
export {
  isHdrProps,
  resolveRenderMode,
  type ImageBackend,
  type ImageBackendProps,
  type RenderMode,
} from "./image-backend";
export { default as ImagePane, type ImagePaneProps } from "./ImagePane";
export {
  default as HdrImagePane,
  tonemapToImageData,
  type HdrImagePaneProps,
  type HdrData,
} from "./HdrImagePane";
export { default as Heatmap, type HeatmapProps } from "./Heatmap";
export {
  default as HistogramPlot,
  type HistogramPlotProps,
} from "./HistogramPlot";
export {
  default as ImageOverlay,
  type ImageOverlayProps,
} from "./ImageOverlay";
export {
  default as PointCloudViewer,
  resolveColorMode,
  type PointCloudViewerProps,
  type PointCloudChannels,
  type PointColorMode,
  type PointSizeMode,
  type PointCloudBackground,
  type PointCloudBounds,
} from "./PointCloudViewer";
export {
  default as Table,
  type TableProps,
  type TableData,
  type TableColumn,
  type ColumnType,
} from "./Table";
// NOTE: `Figure` is intentionally NOT re-exported from this barrel — see the
// comment in `../index.ts`. Import it directly from "./Figure" (or
// "../lib/cairn-plot/renderers/Figure" from app code) so its Plotly
// dependency stays out of the eagerly-bundled reexport graph.
