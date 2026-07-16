import type {
  ImageOverlayData,
  ImageOverlaySettings,
  ImageProcessing,
  Interpolation,
  Colormap,
} from "../types";
import { CrossTypeCompositeMediaPane } from "../media-compare/compositor";
import type { ViewportCapabilities, ViewportPaneProps, ViewState } from "./types";

// ---------------------------------------------------------------------------
// ImageViewport — the image object_type's Viewport module pieces.
//
// Wraps the EXISTING image rendering (CompositeMediaPane, which itself
// delegates to ImagePane for normal/diff and to MediaComparePane for
// split/blend) as a `ViewportModule["Pane"]`. No image rendering is
// rewritten here — this file only adapts prop shapes.
//
// Exports the two pieces that are pure/app-agnostic (the Pane component and
// the capability descriptor). The full `ViewportModule` object — which also
// needs `useData` (calls `api.artifactUrl`, an app-layer concern) and
// `defaultSettings`/`defaultView` — is assembled in
// `components/viewport-registry.tsx`. See types.ts's header comment for why.
// ---------------------------------------------------------------------------

/** ImageViewport's `TData`: one pane's resolved renderable content. Bundles
 *  the overlay alongside the URL because both are parsed from the SAME
 *  artifact at the SAME step (see ImageGalleryCard's `parseOverlay`, moved to
 *  `viewport-registry.tsx`'s `useImageData`) — keeping them as one unit
 *  avoids a second parallel per-pane array in the card. */
export interface ImageViewportItem {
  url: string | null;
  overlay?: ImageOverlayData | null;
}

/** ImageViewport's `TView`: the "image2d" member of the shared `ViewState`
 *  union — zoom + pan, exactly as ImageGalleryCard's `settings.zoom`/`pan`
 *  today (view state stays persisted in settings, not a separate ephemeral
 *  value — see the design doc's D5 on the *pattern* being shared, not a
 *  concrete type). */
export type ImageViewState = Extract<ViewState, { kind: "image2d" }>;

/** ImageViewport's `TSettings` requirement — the subset of
 *  `VisualCompareSettings` (components/card-kit/visual-compare-settings.ts)
 *  this Pane actually reads. Declared narrowly here (rather than importing
 *  the app-layer settings type into cairn-plot) so this file stays
 *  app-agnostic; `VisualCompareSettings` structurally satisfies it. */
export interface ImageViewportSettings {
  brightness: number;
  contrast: number;
  gamma: number;
  exposure: number;
  offset: number;
  flipSign: boolean;
  interpolation?: Interpolation;
  colormap?: Colormap;
  showAxes?: boolean;
  overlay?: ImageOverlaySettings;
  pixelValueNotation?: "decimal" | "int";
}

function toProcessing(s: ImageViewportSettings): ImageProcessing {
  return {
    brightness: s.brightness,
    contrast: s.contrast,
    gamma: s.gamma,
    exposure: s.exposure,
    offset: s.offset,
    flipSign: s.flipSign,
  };
}

/**
 * ImageViewport's Pane — renders one image/compare pane. Thin adapter over
 * `CompositeMediaPane`: unpacks `data`/`reference` (the `{url, overlay}`
 * pair), builds the `ImageProcessing` object from settings (moved verbatim
 * from ImageGalleryCard's `processing` useMemo), and forwards everything
 * else 1:1. `onFrame`/`nativeMode`/`fill` are accepted for interface
 * conformance but unused (image has no native modes and does not yet feed
 * the FrameSource bridge — see types.ts).
 *
 * WS-VC6: `crossTypeReferenceUrl` (a foreign 3D type's offscreen-rendered
 * snapshot, when the resolved reference is cross-type) fills the same
 * `baselineUrl` slot `reference?.url` would otherwise fill -- from
 * `CompositeMediaPane`'s point of view a 3D snapshot data-URL and an image
 * artifact URL are both just an `<img src>` string.
 * `CrossTypeCompositeMediaPane` (a thin wrapper, not a second path)
 * additionally routes `diff` through the resample/letterbox alignment step
 * when `crossTypeAlignForDiff` is set.
 */
export function ImageViewportPane({
  data,
  reference,
  settings,
  view,
  onViewChange,
  mode,
  diffMode,
  splitPosition,
  onSplitPositionChange,
  blendAlpha,
  onNaturalSize,
  label,
  isBaseline,
  isDraggable,
  onDragStart,
  crossTypeReferenceUrl,
  crossTypeAlignForDiff,
}: ViewportPaneProps<ImageViewportItem, ImageViewState, ImageViewportSettings>) {
  const processing = toProcessing(settings);
  return (
    <CrossTypeCompositeMediaPane
      mode={mode}
      imageUrl={data?.url ?? null}
      baselineUrl={reference?.url ?? crossTypeReferenceUrl ?? null}
      alignForDiff={crossTypeAlignForDiff}
      isReferencePane={isBaseline}
      diffSubmode={diffMode}
      colormap={settings.colormap ?? "none"}
      interpolation={settings.interpolation ?? "auto"}
      showAxes={settings.showAxes ?? false}
      processing={processing}
      zoom={view.zoom}
      pan={view.pan}
      onViewportChange={(v) => onViewChange({ kind: "image2d", zoom: v.zoom, pan: v.pan })}
      splitPosition={splitPosition}
      blendAlpha={blendAlpha}
      onSplitPositionChange={onSplitPositionChange}
      label={label}
      isDraggable={isDraggable}
      onDragStart={onDragStart}
      onNaturalSize={onNaturalSize}
      overlay={data?.overlay ?? undefined}
      overlaySettings={settings.overlay}
      pixelValueNotation={settings.pixelValueNotation}
    />
  );
}

/**
 * ImageViewport's capability descriptor — all five core modes, image
 * post-processing + overlays, no native modes, no camera sync, "tracked"
 * reset-view (matches `imageViewModified` in ImageGalleryCard today).
 * `maxPanes`/`webglContextsPerPane` are unenforced-large/0 — image has no
 * per-pane WebGL context (diff uses one process-wide singleton, see
 * `image/webgl-diff.ts`) and no card-imposed pane cap today.
 */
export const imageViewportCapabilities: ViewportCapabilities<never> = {
  coreModes: ["normal", "side", "split", "blend", "diff"],
  nativeModes: [],
  hasSteps: true,
  postProcessing: true,
  overlays: true,
  colorbar: "conditional",
  cameraSync: false,
  resetView: "tracked",
  crossTypeCompare: true,
  webglContextsPerPane: 0,
  maxPanes: Number.POSITIVE_INFINITY,
  label: { placement: "bottom-left", draggable: true },
};
