import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  ImageViewportPane,
  imageViewportCapabilities,
  ColormapSwatch,
  DIVERGING_COLORMAPS,
  createEndpointDataSource,
  resolveImageViewportItems,
  resolveImageViewportItemsAsync,
  parseOverlay,
  type Colormap,
  type ImageViewportItem,
  type ImageViewState,
} from "@cairn-plot/lib/cairn-plot";
import type {
  ViewState,
  ViewportDataArgs,
  ViewportDataResult,
  ViewportModule,
} from "@cairn-plot/lib/cairn-plot";
import type { VisualCompareSettings } from "./card-kit";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import SettingsSection from "./settings/SettingsSection";

// `parseOverlay` now lives in cairn-plot (`viewport/parse-overlay.ts`) so the
// standalone plot bundle's LOCAL image provider shares the ONE parser. Kept
// re-exported from here so existing importers (VisualContentCard's overlay
// settings aggregation) and this module's `useImageData` keep working.
export { parseOverlay };

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
// `CardRenderer.tsx` renders the image case through `viewportRegistry.image`.
// The 3D types (mesh/pointcloud/boxes3d/volume) are Viewport-backed too, but
// each defines + owns its own `ViewportModule` inside its own card file (see
// `meshViewportModule` etc.) and passes it straight into `VisualContentCard`,
// so they are intentionally NOT registered here — this map holds only the
// image module.
// ---------------------------------------------------------------------------

/** The app's default `DataSource` — wraps `api.artifactUrl`. See
 *  `cairn-plot/viewport/data-sources.ts` for why this indirection exists
 *  (keeps the app's API client out of cairn-plot itself). */
const endpointDataSource = createEndpointDataSource((hash) => api.artifactUrl(hash));

/**
 * ImageViewport's `useData` — a pure, synchronous hash->URL mapping (no
 * network fetch: `api.artifactUrl` is a plain string formatter) plus overlay
 * parsing (moved verbatim from ImageGalleryCard's `parseOverlay`, now run
 * against each pane's resolved `metadata` string here instead of the card
 * reaching into raw `SequencePoint`s directly). The hash->TData mapping
 * itself is `resolveImageViewportItems` (cairn-plot/viewport/data-sources) —
 * this hook is now just the `useMemo` + `DataSource`/`parseOverlay` wiring.
 */
function useImageData(args: ViewportDataArgs): ViewportDataResult<ImageViewportItem> {
  const { hashes, referenceHashes, metadata, mimes, referenceMimes } = args;
  // Instant synchronous baseline (`{url, overlay}` per pane, no fetch) so SDR
  // panes render immediately; the async, float-aware resolver below then
  // fetches+decodes any `.exr`/float-`.npy` artifact (detected from the host's
  // `artifact_mime` via `args.mimes`, else the URL extension + magic bytes) and
  // replaces the item with a decoded `CompareFloatSource` — this is what lights
  // up the true-HDR panes/compare (rgba16float, HDR-FLIP auto-dispatch, the
  // host-driven tonemap). Browser-native panes pass through unchanged.
  const sync = useMemo(
    () => resolveImageViewportItems(args, endpointDataSource, parseOverlay),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hashes.join("|"), referenceHashes.join("|"), (metadata ?? []).join("|")],
  );
  const [resolved, setResolved] = useState<ViewportDataResult<ImageViewportItem>>(sync);
  const key = [
    hashes.join("|"),
    referenceHashes.join("|"),
    (metadata ?? []).join("|"),
    (mimes ?? []).join("|"),
    (referenceMimes ?? []).join("|"),
  ].join("§");
  useEffect(() => {
    setResolved(sync);
    let cancelled = false;
    resolveImageViewportItemsAsync(args, endpointDataSource, parseOverlay)
      .then((r) => {
        if (!cancelled) setResolved(r);
      })
      .catch(() => {
        /* keep the sync `{url}` fallback if a decode fails */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return resolved;
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
      <SettingsSection title="Tone map" />
      <Select<"linear" | "srgb" | "gamma" | "reinhard" | "aces">
        label="Operator"
        value={settings.tonemap ?? "srgb"}
        onChange={(v) => update({ tonemap: v })}
        options={[
          { value: "srgb", label: "sRGB (default)" },
          { value: "linear", label: "Linear" },
          { value: "gamma", label: "Gamma" },
          { value: "reinhard", label: "Reinhard" },
          { value: "aces", label: "ACES" },
        ]}
        description="Unified curve. HDR/float panes extend it; the CPU 2D-canvas backend is SDR-only (P=1)"
      />
      <Slider
        label="Peak (HDR ceiling)"
        value={settings.peak ?? 4}
        onChange={(v) => update({ peak: v })}
        min={1}
        max={16}
        step={0.5}
        format={(v) => `${v.toFixed(1)}×`}
        description="×SDR white. 1 = SDR; >1 extends onto an HDR surface (engaged panes only)"
      />
      {(settings.tonemap ?? "srgb") === "gamma" && (
        <Slider
          label="Tone-map γ"
          value={settings.tonemapGamma ?? 2.2}
          onChange={(v) => update({ tonemapGamma: v })}
          min={0.5}
          max={4}
          step={0.05}
          format={(v) => v.toFixed(2)}
          description="Gamma-operator exponent (distinct from the Gamma filter above)"
        />
      )}
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
      <Select<"decimal" | "int">
        label="Pixel-value notation"
        value={settings.pixelValueNotation ?? "decimal"}
        onChange={(v) => update({ pixelValueNotation: v })}
        options={[
          { value: "decimal", label: "Decimal (0–1)" },
          { value: "int", label: "Integer (0–255)" },
        ]}
        description="Notation for the TEV pixel-value overlay (the retained floating chip)"
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
  // Only "image" is registered here — it is the one type `CardRenderer`
  // renders through this shared registry (`viewportRegistry.image`). The 3D
  // types self-register their own `ViewportModule` in their own card files
  // and wire it straight into `VisualContentCard`, so they never flow through
  // this map.
  //
  // The cast erases the `TView` variance between the module's concrete
  // `ImageViewState` and the card's `ViewState` union — safe because the
  // card only ever round-trips a view it obtained from THIS module's
  // `viewFromSettings`/`defaultView` back through its own
  // `viewToSettingsPatch` (which discriminates on `kind`); it never
  // fabricates a `camera3d` view for an image module.
  image: imageViewportModule as unknown as ViewportModule<unknown, ViewState, VisualCompareSettings>,
};
