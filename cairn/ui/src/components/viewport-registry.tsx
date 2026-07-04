import { useMemo } from "react";
import { api } from "../api/client";
import {
  ImageViewportPane,
  imageViewportCapabilities,
  type ImageViewportItem,
  type ImageViewState,
} from "../lib/cairn-plot";
import type {
  ImageOverlayData,
  OverlayMask,
  ViewState,
  ViewportDataArgs,
  ViewportDataResult,
  ViewportModule,
} from "../lib/cairn-plot";
import type { VisualCompareSettings } from "./card-kit";

/** Parse box/mask overlay annotations out of a point's raw
 *  `artifact_metadata` JSON — moved verbatim from ImageGalleryCard's
 *  `parseOverlay` (same behavior, same shape). Exported so VisualContentCard's
 *  overlay-class aggregation (settings panel) reuses the ONE parser rather
 *  than keeping a private copy. */
export function parseOverlay(raw: string | null | undefined): ImageOverlayData | null {
  if (!raw) return null;
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const boxes = Array.isArray(meta.boxes)
    ? (meta.boxes as ImageOverlayData["boxes"])
    : undefined;
  const masksObj =
    meta.masks && typeof meta.masks === "object"
      ? (meta.masks as Record<string, { png_b64: string; class_labels?: Record<string, string> }>)
      : undefined;
  const masks: OverlayMask[] | undefined = masksObj
    ? Object.entries(masksObj).map(([name, m]) => ({
        name,
        png_b64: m.png_b64,
        class_labels: m.class_labels,
      }))
    : undefined;
  const class_labels =
    meta.class_labels && typeof meta.class_labels === "object"
      ? (meta.class_labels as Record<string, string>)
      : undefined;
  if (!boxes?.length && !masks?.length) return null;
  return { boxes, masks, class_labels };
}

// ---------------------------------------------------------------------------
// viewport-registry — `object_type` -> `ViewportModule`.
//
// Assembles the FULL `ViewportModule` for each registered type by combining
// the pure/app-agnostic pieces from `lib/cairn-plot/viewport` (Pane,
// capabilities) with the app-layer pieces that need `api.artifactUrl` (or,
// for a future 3D module, react-query blob fetching) — `useData`,
// `defaultSettings`, `defaultView`. This mirrors the existing split between
// `lib/cairn-plot/media-compare/reference.ts` (pure) and
// `components/card-kit/use-media-reference.ts` (react-query, app layer).
//
// `CardRenderer.tsx` looks up `viewportRegistry[metric.object_type]` instead
// of branching per type; today only "image" is registered (WS-VC3 scope).
// WS-VC4 adds mesh/pointcloud/boxes3d/volume entries here without touching
// this file's shape.
// ---------------------------------------------------------------------------

/**
 * ImageViewport's `useData` — a pure, synchronous hash->URL mapping (no
 * network fetch: `api.artifactUrl` is a plain string formatter) plus overlay
 * parsing (moved verbatim from ImageGalleryCard's `parseOverlay`, now run
 * against each pane's resolved `metadata` string here instead of the card
 * reaching into raw `SequencePoint`s directly).
 */
function useImageData(args: ViewportDataArgs): ViewportDataResult<ImageViewportItem> {
  const { hashes, referenceHashes, metadata } = args;
  return useMemo(
    () => ({
      items: hashes.map((h, i) =>
        h ? { url: api.artifactUrl(h), overlay: parseOverlay(metadata?.[i]) } : null,
      ),
      referenceItems: referenceHashes.map((h) => (h ? { url: api.artifactUrl(h) } : null)),
      isLoading: false,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hashes.join("|"), referenceHashes.join("|"), (metadata ?? []).join("|")],
  );
}

export const imageViewportModule: ViewportModule<
  ImageViewportItem,
  ImageViewState,
  VisualCompareSettings
> = {
  objectType: "image",
  capabilities: imageViewportCapabilities,
  useData: useImageData,
  defaultSettings: () => ({
    brightness: 0,
    contrast: 0,
    gamma: 1,
    exposure: 0,
    offset: 0,
    flipSign: false,
    zoom: 1,
    pan: { x: 0, y: 0 },
    diffMode: "none",
    interpolation: "auto",
    colormap: "none",
    showAxes: false,
  }),
  viewFromSettings: (s) => ({ kind: "image2d", zoom: s.zoom, pan: s.pan }),
  viewToSettingsPatch: (v) => (v.kind === "image2d" ? { zoom: v.zoom, pan: v.pan } : {}),
  defaultView: () => ({ kind: "image2d", zoom: 1, pan: { x: 0, y: 0 } }),
  Pane: ImageViewportPane,
};

export const viewportRegistry: Record<
  string,
  ViewportModule<unknown, ViewState, VisualCompareSettings>
> = {
  // Only "image" is a real Viewport-backed type today (WS-VC3 scope). VC4
  // adds mesh/pointcloud/boxes3d/volume entries; VisualContentCard is not
  // wired to those object_types yet (CardRenderer keeps their existing
  // bespoke cards until WS-VC5).
  //
  // The cast erases the `TView` variance between the module's concrete
  // `ImageViewState` and the card's `ViewState` union — safe because the
  // card only ever round-trips a view it obtained from THIS module's
  // `viewFromSettings`/`defaultView` back through its own
  // `viewToSettingsPatch` (which discriminates on `kind`); it never
  // fabricates a `camera3d` view for an image module.
  image: imageViewportModule as unknown as ViewportModule<unknown, ViewState, VisualCompareSettings>,
};
