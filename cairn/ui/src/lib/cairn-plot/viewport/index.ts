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

// NOTE: pointcloud-viewport.tsx (WS-VC4) is DELIBERATELY not re-exported
// from this barrel (or cairn-plot/index.ts's, both of which are imported
// eagerly by non-lazy call sites such as VisualContentCard.tsx). It pulls
// in `three`/`PointCloudViewer`, and this repo's existing lazy-loading
// boundary keeps that dependency out of the main bundle (see
// CardRenderer.tsx's `lazy(() => import("./PointCloudVisualCard"))`).
// Import it directly: `lib/cairn-plot/viewport/pointcloud-viewport`. Rollup
// tree-shaking would likely elide an unused barrel re-export too, but this
// avoids depending on that guarantee for a dependency this heavy.
