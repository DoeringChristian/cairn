import { useMemo } from "react";
import { api } from "../api/client";
import {
  ImageViewportPane,
  imageViewportCapabilities,
  ColormapSwatch,
  DIVERGING_COLORMAPS,
  type Colormap,
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
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import SettingsSection from "./settings/SettingsSection";

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

// ---------------------------------------------------------------------------
// ImageSettingsControls — per-type controls injected into the shared settings
// panel via the SAME `viewport.SettingsControls` slot the 3D types
// (PointCloud/Mesh/Boxes/Volume) use (see e.g. PointCloudSettingsControls).
// This is the image type's post-processing + false-color group, moved out of
// VisualContentCard's former header hardcode + hardcoded `caps.postProcessing`
// settings-panel block so image renders its controls through the identical
// mechanism/position as every other media type — one capability-driven bottom
// control area, no header special-case. Overlays + camera-sync stay card-level
// (they read card-computed state, not per-type settings) and are rendered
// centrally by VisualContentCard.
// ---------------------------------------------------------------------------
function ImageSettingsControls({
  settings,
  update,
}: {
  settings: VisualCompareSettings;
  update: (p: Partial<VisualCompareSettings>) => void;
  meta: unknown;
}) {
  return (
    <>
      <SettingsSection title="Image" first />
      <Slider
        label="Brightness"
        value={settings.brightness}
        onChange={(v) => update({ brightness: v })}
        min={-1}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label="Contrast"
        value={settings.contrast}
        onChange={(v) => update({ contrast: v })}
        min={-1}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label="Gamma"
        value={settings.gamma}
        onChange={(v) => update({ gamma: v })}
        min={0.1}
        max={3}
        step={0.01}
        format={(v) => v.toFixed(2)}
        description="1 = no change; <1 brightens shadows, >1 darkens"
      />
      <Slider
        label="Exposure"
        value={settings.exposure}
        onChange={(v) => update({ exposure: v })}
        min={-3}
        max={3}
        step={0.01}
        format={(v) => v.toFixed(2)}
        description="EV stops: 0 = none, +1 = 2× brighter"
      />
      <Slider
        label="Offset"
        value={settings.offset}
        onChange={(v) => update({ offset: v })}
        min={-0.5}
        max={0.5}
        step={0.001}
        format={(v) => v.toFixed(3)}
        description="Uniform shift added after gamma"
      />
      <Toggle
        label="Flip sign"
        checked={settings.flipSign}
        onChange={(v) => update({ flipSign: v })}
        description="Invert / negate pixel values"
      />
      <Select<"auto" | "pixelated" | "crisp-edges">
        label="Interpolation"
        value={settings.interpolation ?? "auto"}
        onChange={(v) => update({ interpolation: v })}
        options={[
          { value: "auto", label: "Smooth (bilinear)" },
          { value: "pixelated", label: "Nearest (pixelated)" },
          { value: "crisp-edges", label: "Crisp edges" },
        ]}
      />
      <Select<Colormap>
        label="False color"
        description={DIVERGING_COLORMAPS.has(settings.colormap ?? "none") ? "Diverging: 0 = center (white)" : undefined}
        value={settings.colormap ?? "none"}
        onChange={(v) => update({ colormap: v })}
        options={[
          { value: "none", label: "None (original)" },
          { value: "viridis", label: "Viridis" },
          { value: "red-green", label: "Red – Green (±)" },
          { value: "red-blue", label: "Red – Blue (±)" },
        ]}
      />
      {(settings.colormap ?? "none") !== "none" && (
        <ColormapSwatch colormap={settings.colormap as Exclude<Colormap, "none">} />
      )}
      <Select<"nothing" | "last_available">
        label="Missing image"
        value={settings.missingImageMode ?? "last_available"}
        onChange={(v) => update({ missingImageMode: v })}
        options={[
          { value: "nothing", label: "Show nothing" },
          { value: "last_available", label: "Show last available" },
        ]}
      />
      <Toggle
        label="Pixel axes"
        checked={settings.showAxes ?? false}
        onChange={(v) => update({ showAxes: v })}
        description="Show pixel coordinate ticks along edges"
      />
    </>
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
  SettingsControls: ImageSettingsControls,
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
