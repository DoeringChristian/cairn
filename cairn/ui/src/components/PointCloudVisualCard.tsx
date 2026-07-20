import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import type { CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { safeJsonParse } from "../lib/format";
import {
  PointCloudViewer,
  createEndpointDataSource,
  fetchPointCloudArrays,
  isCoreCompareMode,
  type MediaCompareModeKind,
  type DiffMode,
  type Colormap,
  type PointColorMode,
  type PointSizeMode,
  type PointCloudBackground,
  type ViewportDataArgs,
  type ViewportDataResult,
  type ViewportModule,
  type ViewState,
} from "@cairn-plot/lib/cairn-plot";
import {
  PointCloudSingleView,
  PointCloudSideBySideView,
  PointCloudNativeDiffPane,
  pointCloudViewportCapabilities,
  pointCloudActiveColorbar,
  type PointCloudMeta,
  type PointCloudViewportItem,
  type PointCloudViewState,
  type PointCloudNativeMode,
} from "@cairn-plot/lib/cairn-plot/viewport/pointcloud-viewport";
import { propertyNames } from "@cairn-plot/lib/cairn-plot/three/properties";
import type { DiffColormap } from "@cairn-plot/lib/cairn-plot/three/diff";
import { resetScene3DViews, type Scene3DCameraMode, type Scene3DSyncOptions } from "@cairn-plot/lib/cairn-plot/three/use-scene3d";
import type { ViewportPaneProps } from "@cairn-plot/lib/cairn-plot/viewport/types";
import { OffscreenComparePanes, PropertySelector, useOffscreenSnapshot, type VisualCompareSettings } from "./card-kit";
import type { ForeignFrameProps } from "./card-kit/cross-type-frame";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import VisualContentCard from "./VisualContentCard";

// ---------------------------------------------------------------------------
// PointCloudVisualCard — the pointcloud object_type's APP-LAYER Viewport
// assembly + the lazy-loading boundary (WS-VC4).
//
// This file (not `viewport-registry.tsx`) is where pointcloud's `useData`
// (react-query blob fetch) AND its full `Pane` (which needs
// `OffscreenComparePanes`, an app-layer/card-kit component — see
// `cairn-plot/viewport/pointcloud-viewport.tsx`'s header comment for why
// that split exists) are assembled, and is itself the thing `CardRenderer`
// dynamically imports (`lazy(() => import("./PointCloudVisualCard"))`,
// replacing the old `lazy(() => import("./PointCloudCard"))`) — this keeps
// `three`/`PointCloudViewer` out of every OTHER card's bundle exactly as
// before, since nothing outside this lazy chunk imports
// `cairn-plot/viewport/pointcloud-viewport` or this file.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// useData — fetch + parse the point-cloud blob, REUSING the existing parse
// path (`parseNpy`/`parseNpz`/`extractProperties`, all cairn-plot, untouched)
// verbatim. Moved from the pre-refactor `PointCloudCard`'s `usePointCloudBlob`
// (same content-sniff, same query shape) — just generalized to fetch BOTH
// the foreground and the reference hash arrays via `useQueries` (dynamic-
// length, one hook call each), since `ViewportModule.useData` receives
// arrays of already-resolved hashes rather than owning its own step
// resolution (that stays card-owned — see `ViewportDataArgs`'s doc comment).
//
// The fetch+parse core itself (`fetchPointCloudArrays`) now lives in
// `cairn-plot/viewport/data-sources.ts`, parameterized by a `DataSource`
// instead of calling `api.artifactUrl` directly — this file just supplies
// the app's endpoint-backed `DataSource` and the react-query wiring.
// ---------------------------------------------------------------------------

const dataSource = createEndpointDataSource((hash) => api.artifactUrl(hash));

function usePointCloudBlobs(hashes: (string | null)[]) {
  return useQueries({
    queries: hashes.map((h) => ({
      queryKey: ["pointcloud-blob", h],
      enabled: !!h,
      staleTime: Infinity,
      queryFn: () => fetchPointCloudArrays(h!, dataSource),
    })),
  });
}

function usePointCloudData(args: ViewportDataArgs): ViewportDataResult<PointCloudViewportItem> {
  const { hashes, referenceHashes, metadata, referenceMetadata } = args;
  const fg = usePointCloudBlobs(hashes);
  const ref = usePointCloudBlobs(referenceHashes);

  return useMemo(() => {
    const items = hashes.map((h, i) => {
      if (!h) return null;
      const blob = fg[i]?.data;
      const meta = safeJsonParse<PointCloudMeta>(metadata?.[i]);
      if (!blob || !meta) return null;
      return { arrays: blob, meta };
    });
    const referenceItems = referenceHashes.map((h, i) => {
      if (!h) return null;
      const blob = ref[i]?.data;
      const meta = safeJsonParse<PointCloudMeta>(referenceMetadata?.[i]);
      if (!blob || !meta) return null;
      return { arrays: blob, meta };
    });
    const isLoading = fg.some((q) => q.isLoading) || ref.some((q) => q.isLoading);
    return { items, referenceItems, isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hashes.join("|"),
    referenceHashes.join("|"),
    (metadata ?? []).join("|"),
    (referenceMetadata ?? []).join("|"),
    fg.map((q) => q.dataUpdatedAt).join("|"),
    ref.map((q) => q.dataUpdatedAt).join("|"),
  ]);
}

// ---------------------------------------------------------------------------
// PointCloudForeignFrame — WS-VC6 cross-type bridge (mirrors
// `MeshForeignFrame`'s doc comment exactly): renders ONE point cloud hash's
// viewer hidden, default view, purely to capture a single offscreen snapshot
// for another (image) card's cross-type compare.
// ---------------------------------------------------------------------------
export function PointCloudForeignFrame({ hash, metadata, onFrame }: ForeignFrameProps) {
  const [blob] = usePointCloudBlobs([hash]);
  const meta = safeJsonParse<PointCloudMeta>(metadata);
  const snap = useOffscreenSnapshot();

  useEffect(() => {
    if (snap.dataUrl) onFrame({ kind: "dataUrl", dataUrl: snap.dataUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.dataUrl]);

  if (!blob?.data || !meta) return null;
  return (
    <PointCloudViewer
      data={blob.data.data}
      channels={meta.channels}
      nPoints={meta.n_points}
      bounds={meta.bounds}
      colorMode="auto"
      pointSize={2.5}
      background="dark"
      onFrame={snap.onFrame}
    />
  );
}

// ---------------------------------------------------------------------------
// Settings — VisualCompareSettings (shared) intersected with pointcloud's
// own fields, same pattern the design doc describes for every future
// module ("intersected with type-specific fields... via its own settings
// interface"). `compareMode`/`diffSubmode` are the OLD (pre-VisualContentCard)
// pointcloud card's field names for what's now `mode`/`nativeMode`/`diffMode`
// — kept OUT of this type (not redeclared) and read only through
// `migratePointCloudSettings`'s one-time unsafe-cast read, so old cards keep
// loading (persisted-settings compatibility) without widening the shared
// `VisualCompareSettings.compareMode` field's type.
// ---------------------------------------------------------------------------

export interface PointCloudFullSettings extends VisualCompareSettings {
  pointSize: number;
  /** Screen (constant-pixel, default) vs world (perspective) point sizing. */
  pointSizeMode?: PointSizeMode;
  colorMode: PointColorMode;
  background: PointCloudBackground;
  property?: string;
  diffColormap?: DiffColormap;
  /** Persisted "Show axes" setting (WS-3DR2) — see `PointCloudViewportSettings`. */
  showAxes?: boolean;
  /** Persisted "Show planes" setting (#69 S2). */
  showPlanes?: boolean;
  /** Persisted camera orientation mode (#69 S1). */
  cameraMode?: Scene3DCameraMode;
}

function defaultPointCloudSettings(): Omit<PointCloudFullSettings, "metrics" | "version"> {
  return {
    pointSize: 2.5,
    pointSizeMode: "screen",
    colorMode: "auto",
    background: "dark",
    showAxes: false,
    showPlanes: false,
    cameraMode: "orbital",
    // 3D views linked by default (WS-VCP fix 1) — see MeshVisualCard's
    // identical comment; only affects cards without an explicit persisted
    // `syncViews` value.
    syncViews: true,
    // Inert placeholders: VisualCompareSettings' post-processing/view fields
    // are required by the base type but never read (capabilities.postProcessing
    // is false; view state isn't settings-roundtripped for pointcloud — see
    // viewFromSettings/viewToSettingsPatch below) or shown (the shared
    // settings panel gates those controls on the capability, not presence).
    brightness: 0,
    contrast: 0,
    gamma: 1,
    exposure: 0,
    offset: 0,
    flipSign: false,
    zoom: 1,
    pan: { x: 0, y: 0 },
    diffMode: "none",
  };
}

const LEGACY_CORE_MODES = new Set<string>(["normal", "side", "split", "blend", "diff"]);

/**
 * Read migration for old pointcloud cards' persisted settings: folds the
 * pre-VisualContentCard `compareMode` field (`MediaCompareMode<"diff-property"
 * | "diff-position">` — core kinds ∪ the two native kinds, ONE field) into
 * the shared `mode`/`nativeMode` fields, and `diffSubmode` (the old core-diff
 * submode selector) into the shared `diffMode`. Non-destructive (never
 * rewrites storage) — recomputed on every read, exactly like
 * `migrateLegacyMode` does for image's legacy fields.
 */
function migratePointCloudSettings(settings: PointCloudFullSettings): PointCloudFullSettings {
  const raw = settings as unknown as Record<string, unknown>;
  let next = settings;
  if (next.mode == null && next.nativeMode == null && typeof raw.compareMode === "string") {
    const legacy = raw.compareMode;
    if (legacy === "diff-property" || legacy === "diff-position") {
      next = { ...next, nativeMode: legacy };
    } else if (LEGACY_CORE_MODES.has(legacy)) {
      next = { ...next, mode: legacy as MediaCompareModeKind };
    }
  }
  if (next.diffMode === "none" && typeof raw.diffSubmode === "string") {
    next = { ...next, diffMode: raw.diffSubmode as DiffMode };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Pane — the REAL `ViewportModule.Pane`. Dispatches "normal"/"side" to the
// pure cairn-plot components and "split"/"blend"/"diff" to
// `OffscreenComparePanes` (snapshot -> the shared image-space compositor),
// mirroring the pre-refactor `PointCloudComparePane`'s three-way dispatch
// verbatim (same viewer wiring, same `sync`/`onFrame` contract) — only the
// prop *source* changed (a resolved `ViewportPaneProps`, not ad hoc card
// state).
// ---------------------------------------------------------------------------

function PointCloudViewportPane(
  props: ViewportPaneProps<PointCloudViewportItem, PointCloudViewState, PointCloudFullSettings>,
) {
  const {
    data,
    reference,
    settings,
    mode,
    diffMode,
    cameraSyncGroupId,
    label,
    isBaseline,
    isDraggable,
    onDragStart,
    splitPosition,
    onSplitPositionChange,
    blendAlpha,
    crossTypeReferenceUrl,
    crossTypeAlignForDiff,
  } = props;
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = {
    pointSize: settings.pointSize,
    pointSizeMode: settings.pointSizeMode ?? "screen",
    colorMode: settings.colorMode,
    background: settings.background,
    property: settings.property ?? null,
    showAxes: settings.showAxes ?? false,
    showPlanes: settings.showPlanes ?? false,
    cameraMode: settings.cameraMode ?? "orbital",
  };
  const hasCrossTypeRef = crossTypeReferenceUrl != null;
  // Mirrors CompositeMediaPane's own rule: no reference resolved -> always
  // "normal", regardless of the user's selected mode (see ViewportPaneProps'
  // `mode` doc comment) — UNLESS a WS-VC6 cross-type reference is resolved
  // instead (same-type `reference` is always null in that case).
  const effectiveMode: MediaCompareModeKind = reference == null && !hasCrossTypeRef ? "normal" : mode;

  // Renders THIS pane's own (foreground) point cloud live — shared by the
  // same-type split/blend/diff branch below AND the WS-VC6 cross-type
  // branch (a foreign-type reference has no `PointCloudSideBySideView`
  // counterpart, so cross-type routes "side" through the generalized
  // `OffscreenComparePanes` too).
  const renderPointCloudLive = (cb: (canvas: HTMLCanvasElement) => void, syncOpts: Scene3DSyncOptions) => (
    <PointCloudViewer
      data={data!.arrays.data}
      channels={data!.meta.channels}
      nPoints={data!.meta.n_points}
      bounds={data!.meta.bounds}
      colorMode={view.colorMode}
      pointSize={view.pointSize}
      pointSizeMode={view.pointSizeMode}
      background={view.background}
      showAxes={view.showAxes}
      showPlanes={view.showPlanes}
      cameraMode={view.cameraMode}
      sync={syncOpts}
      onFrame={cb}
    />
  );

  if (hasCrossTypeRef && effectiveMode !== "normal") {
    if (!data) {
      return (
        <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
          loading…
        </div>
      );
    }
    return (
      <OffscreenComparePanes
        mode={effectiveMode as Extract<MediaCompareModeKind, "side" | "split" | "blend" | "diff">}
        syncGroupId={cameraSyncGroupId ?? null}
        primary={{ kind: "live", render: renderPointCloudLive }}
        reference={{ kind: "frame", frameSource: { kind: "url", url: crossTypeReferenceUrl! } }}
        diffSubmode={diffMode}
        colormap={(settings.diffColormap ?? "viridis") as Colormap}
        splitPosition={splitPosition ?? 0.5}
        onSplitPositionChange={onSplitPositionChange ?? (() => {})}
        blendAlpha={blendAlpha ?? 0.5}
        primaryLabel={label}
        alignForDiff={crossTypeAlignForDiff}
      />
    );
  }

  if (effectiveMode === "side") {
    return (
      <PointCloudSideBySideView
        item={data}
        reference={reference ?? null}
        view={view}
        sync={sync}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
      />
    );
  }

  if (isCoreCompareMode(effectiveMode) && (effectiveMode === "split" || effectiveMode === "blend" || effectiveMode === "diff")) {
    if (!data || !reference) {
      return (
        <div className="flex h-full w-full items-center justify-center text-sm text-fg-muted motion-safe:animate-pulse">
          loading…
        </div>
      );
    }
    return (
      <OffscreenComparePanes
        mode={effectiveMode}
        syncGroupId={cameraSyncGroupId ?? null}
        primary={{ kind: "live", render: renderPointCloudLive }}
        reference={{
          kind: "live",
          render: (cb, syncOpts) => (
            <PointCloudViewer
              data={reference.arrays.data}
              channels={reference.meta.channels}
              nPoints={reference.meta.n_points}
              bounds={reference.meta.bounds}
              colorMode={view.colorMode}
              pointSize={view.pointSize}
              pointSizeMode={view.pointSizeMode}
              background={view.background}
              showAxes={view.showAxes}
              showPlanes={view.showPlanes}
              cameraMode={view.cameraMode}
              sync={syncOpts}
              onFrame={cb}
            />
          ),
        }}
        diffSubmode={diffMode}
        colormap={(settings.diffColormap ?? "viridis") as Colormap}
        splitPosition={splitPosition ?? 0.5}
        onSplitPositionChange={onSplitPositionChange ?? (() => {})}
        blendAlpha={blendAlpha ?? 0.5}
        primaryLabel={label}
      />
    );
  }

  // "normal" (isBaseline is accepted for interface conformance; unlike
  // image, pointcloud never renders an explicit standalone REF pane in the
  // multi-pane grid outside of "side" mode, matching the pre-refactor card).
  void isBaseline;
  return (
    <PointCloudSingleView
      item={data}
      view={view}
      sync={sync}
      label={label}
      isDraggable={isDraggable}
      onDragStart={onDragStart}
    />
  );
}

// ---------------------------------------------------------------------------
// SettingsControls — per-type controls injected into the shared settings
// panel (point size, color mode, background, property, native-diff
// colormap). "Sync 3D views" is NOT here: it's rendered CENTRALLY by
// VisualContentCard, gated on `capabilities.cameraSync` (shared chrome, not
// a per-module control) — see VisualContentCard.tsx.
// ---------------------------------------------------------------------------

const COLOR_MODE_OPTIONS: Array<{ value: PointColorMode; label: string }> = [
  { value: "auto", label: "Auto (rgb → category → height)" },
  { value: "rgb", label: "RGB" },
  { value: "category", label: "Category" },
  { value: "height", label: "Height (viridis)" },
];

const BACKGROUND_OPTIONS: Array<{ value: PointCloudBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const ORIENTATION_OPTIONS: Array<{ value: Scene3DCameraMode; label: string }> = [
  { value: "orbital", label: "Orbital" },
  { value: "turntable", label: "Turntable" },
];

const POINT_SIZE_MODE_OPTIONS: Array<{ value: PointSizeMode; label: string }> = [
  { value: "screen", label: "Screen (constant pixels)" },
  { value: "world", label: "World (shrinks with distance)" },
];

function PointCloudSettingsControls({
  settings,
  update,
  meta,
}: {
  settings: PointCloudFullSettings;
  update: (p: Partial<PointCloudFullSettings>) => void;
  meta: unknown;
}) {
  const item = meta as PointCloudViewportItem | null;
  const propertyOptions = propertyNames(item?.arrays.properties);
  return (
    <>
      <Slider
        label="Point size"
        value={settings.pointSize}
        onChange={(v) => update({ pointSize: v })}
        min={0.5}
        max={8}
        step={0.5}
        format={(v) => v.toFixed(1)}
        description={
          (settings.pointSizeMode ?? "screen") === "world"
            ? "Point radius in world units"
            : "Point radius in pixels"
        }
      />
      <Select
        label="Point size mode"
        value={settings.pointSizeMode ?? "screen"}
        onChange={(v) => update({ pointSizeMode: v })}
        options={POINT_SIZE_MODE_OPTIONS}
        description="Screen keeps a constant on-screen size; world attenuates with camera distance"
      />
      <Select
        label="Color mode"
        value={settings.colorMode}
        onChange={(v) => update({ colorMode: v })}
        options={COLOR_MODE_OPTIONS}
        description="Falls back to an available channel when the chosen one is absent"
      />
      <PropertySelector
        properties={propertyOptions}
        value={settings.property ?? null}
        onChange={(p) => update({ property: p })}
      />
      <Select
        label="Background"
        value={settings.background}
        onChange={(v) => update({ background: v })}
        options={BACKGROUND_OPTIONS}
      />
      <Toggle
        label="Show axes"
        checked={!!settings.showAxes}
        onChange={(v) => update({ showAxes: v })}
        description="Colored XYZ origin lines + grid, sized to the fitted view"
      />
      <Toggle
        label="Show planes"
        checked={!!settings.showPlanes}
        onChange={(v) => update({ showPlanes: v })}
        description="Faint XY/YZ/XZ reference planes through the origin"
      />
      <Select
        label="Orientation"
        value={settings.cameraMode ?? "orbital"}
        onChange={(v) => update({ cameraMode: v })}
        options={ORIENTATION_OPTIONS}
        description="Turntable locks world-up and spins about it; orbital is free orbit"
      />
      {/* "Diff colormap" (red-green/viridis) now lives in the shared
          Compare section (VisualContentCard.tsx, WS-MFIX Bug 2) — rendering
          it here too would duplicate the control in the same settings
          panel. */}
    </>
  );
}

// ---------------------------------------------------------------------------
// Module assembly + the lazy-loaded card component.
// ---------------------------------------------------------------------------

const DEFAULT_VIEW: PointCloudViewState = {
  kind: "camera3d",
  position: [0, 0, 5],
  target: [0, 0, 0],
  zoom: 1,
};

export const pointCloudViewportModule: ViewportModule<
  PointCloudViewportItem,
  PointCloudViewState,
  PointCloudFullSettings,
  PointCloudNativeMode
> = {
  objectType: "pointcloud",
  capabilities: pointCloudViewportCapabilities,
  useData: usePointCloudData,
  defaultSettings: defaultPointCloudSettings,
  migrateSettings: migratePointCloudSettings,
  // View state is not settings-roundtripped for 3D (see
  // `PointCloudViewState`'s doc comment) — these are inert stubs;
  // `capabilities.resetView: "always"` means the card's own
  // `viewModified` gate is bypassed anyway, and `onResetView` below (not
  // this settings roundtrip) is what the card actually calls.
  viewFromSettings: () => DEFAULT_VIEW,
  viewToSettingsPatch: () => ({}),
  defaultView: () => DEFAULT_VIEW,
  onResetView: (container) => resetScene3DViews(container),
  Pane: PointCloudViewportPane,
  SettingsControls: PointCloudSettingsControls,
  nativeDiff: { render: PointCloudNativeDiffPane },
  activeColorbar: pointCloudActiveColorbar,
};

interface PointCloudVisualCardProps {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/**
 * The lazy-loading boundary for pointcloud (WS-VC4): `CardRenderer.tsx`
 * dynamically imports THIS file (`lazy(() => import("./PointCloudVisualCard"))`)
 * instead of the deleted `PointCloudCard.tsx`, so `three`/`PointCloudViewer`
 * stay out of every other card's bundle exactly as before. A thin wrapper —
 * all the actual behavior is `VisualContentCard` + `pointCloudViewportModule`.
 */
export default function PointCloudVisualCard(props: PointCloudVisualCardProps) {
  return (
    <VisualContentCard
      {...props}
      viewport={pointCloudViewportModule as unknown as ViewportModule<unknown, ViewState, VisualCompareSettings>}
    />
  );
}
