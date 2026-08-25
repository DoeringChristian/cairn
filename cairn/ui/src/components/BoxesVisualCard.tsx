import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import type { CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { safeJsonParse } from "../lib/format";
import {
  createEndpointDataSource,
  fetchBoxesArrays,
  isCoreCompareMode,
  type MediaCompareModeKind,
  type DiffMode,
  type Colormap,
  type ViewportDataArgs,
  type ViewportDataResult,
  type ViewportModule,
  type ViewState,
} from "@cairn-plot/lib/cairn-plot";
import BoxesViewer, {
  resolveBoxesColorMode,
  type BoxesColorMode,
  type BoxesBackground,
} from "@cairn-plot/lib/cairn-plot/three/BoxesViewer";
import {
  BoxesSingleView,
  BoxesNativeDiffPane,
  boxesViewportCapabilities,
  boxesActiveColorbar,
  resolveBoxesViewConfig,
  type Boxes3DMeta,
  type BoxesViewportItem,
  type BoxesViewState,
  type BoxesNativeMode,
} from "@cairn-plot/lib/cairn-plot/viewport/boxes-viewport";
import {
  propertyNames,
  resolveActiveProperty,
} from "@cairn-plot/lib/cairn-plot/three/properties";
import type { DiffColormap } from "@cairn-plot/lib/cairn-plot/three/diff";
import { resetScene3DViews, type Scene3DCameraMode, type Scene3DSyncOptions } from "@cairn-plot/lib/cairn-plot/three/use-scene3d";
import type { ViewportPaneProps } from "@cairn-plot/lib/cairn-plot/viewport/types";
import { PropertySelector, useOffscreenSnapshot, type VisualCompareSettings } from "./card-kit";
import { OffscreenComparePanes } from "@cairn-plot/lib/cairn-plot/media-compare/OffscreenComparePanes";
import type { ForeignFrameProps } from "./card-kit/cross-type-frame";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import VisualContentCard from "./VisualContentCard";

// ---------------------------------------------------------------------------
// BoxesVisualCard — the boxes3d object_type's APP-LAYER Viewport assembly +
// the lazy-loading boundary (WS-VC5). Mirrors MeshVisualCard.tsx /
// PointCloudVisualCard.tsx exactly — replaces the deleted BoxesCard.tsx.
// ---------------------------------------------------------------------------

// The fetch+parse core (`fetchBoxesArrays`) now lives in
// `cairn-plot/viewport/data-sources.ts`, parameterized by a `DataSource`
// (mirrors PointCloudVisualCard's G3a extraction).
const dataSource = createEndpointDataSource((hash) => api.artifactUrl(hash));

function useBoxesBlobs(hashes: (string | null)[]) {
  return useQueries({
    queries: hashes.map((h) => ({
      queryKey: ["boxes3d-npz", h],
      enabled: !!h,
      staleTime: Infinity,
      queryFn: () => fetchBoxesArrays(h!, dataSource),
    })),
  });
}

function useBoxesData(args: ViewportDataArgs): ViewportDataResult<BoxesViewportItem> {
  const { hashes, referenceHashes, metadata, referenceMetadata } = args;
  const fg = useBoxesBlobs(hashes);
  const ref = useBoxesBlobs(referenceHashes);

  return useMemo(() => {
    const items = hashes.map((h, i) => {
      if (!h) return null;
      const blob = fg[i]?.data;
      const meta = safeJsonParse<Boxes3DMeta>(metadata?.[i]);
      if (!blob || !meta) return null;
      return { arrays: blob, meta };
    });
    const referenceItems = referenceHashes.map((h, i) => {
      if (!h) return null;
      const blob = ref[i]?.data;
      const meta = safeJsonParse<Boxes3DMeta>(referenceMetadata?.[i]);
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
// BoxesForeignFrame — WS-VC6 cross-type bridge (mirrors `MeshForeignFrame`'s
// doc comment exactly): renders ONE boxes3d hash's viewer hidden, default
// view, purely to capture a single offscreen snapshot for another (image)
// card's cross-type compare.
// ---------------------------------------------------------------------------
export function BoxesForeignFrame({ hash, metadata, onFrame }: ForeignFrameProps) {
  const [blob] = useBoxesBlobs([hash]);
  const meta = safeJsonParse<Boxes3DMeta>(metadata);
  const snap = useOffscreenSnapshot();

  useEffect(() => {
    if (snap.dataUrl) onFrame({ kind: "dataUrl", dataUrl: snap.dataUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.dataUrl]);

  if (!blob?.data || !meta) return null;
  const active = resolveActiveProperty(blob.data.properties, null, meta.properties ?? null);
  return (
    <BoxesViewer
      mins={blob.data.mins}
      maxs={blob.data.maxs}
      depth={blob.data.depth}
      values={active.values}
      nBoxes={meta.n_boxes}
      bounds={meta.bounds}
      maxDepth={meta.max_depth}
      valueRange={active.range}
      colorMode="depth"
      depthRange={[0, meta.max_depth]}
      background="dark"
      onFrame={snap.onFrame}
    />
  );
}

// ---------------------------------------------------------------------------
// Settings — VisualCompareSettings (shared) intersected with boxes3d's own
// fields. `compareMode`/`diffSubmode` are the OLD field names for what's now
// `mode`/`nativeMode`/`diffMode` — read only through `migrateBoxesSettings`.
// ---------------------------------------------------------------------------

export interface BoxesFullSettings extends VisualCompareSettings {
  colorMode: BoxesColorMode;
  background: BoxesBackground;
  depthMin?: number;
  depthMax?: number;
  valueFilterEnabled?: boolean;
  valueMin?: number;
  valueMax?: number;
  property?: string;
  diffColormap?: DiffColormap;
  /** Persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
  /** Persisted "Show planes" setting (#69 S2). */
  showPlanes?: boolean;
  /** Persisted camera orientation mode (#69 S1). */
  cameraMode?: Scene3DCameraMode;
}

function defaultBoxesSettings(): Omit<BoxesFullSettings, "metrics" | "version"> {
  return {
    colorMode: "depth",
    background: "dark",
    showAxes: false,
    showPlanes: false,
    cameraMode: "orbital",
    // 3D views linked by default (WS-VCP fix 1) — see MeshVisualCard's
    // identical comment; only affects cards without an explicit persisted
    // `syncViews` value.
    syncViews: true,
    // Inert placeholders — see defaultPointCloudSettings' identical comment.
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

const LEGACY_CORE_MODES = new Set<string>(["normal", "split", "blend", "diff"]);

function migrateBoxesSettings(settings: BoxesFullSettings): BoxesFullSettings {
  const raw = settings as unknown as Record<string, unknown>;
  let next = settings;
  if (next.mode == null && next.nativeMode == null && typeof raw.compareMode === "string") {
    const legacy = raw.compareMode;
    if (legacy === "diff-property") {
      next = { ...next, nativeMode: legacy };
    } else if (LEGACY_CORE_MODES.has(legacy)) {
      // cairn-plot removed the "blend" compare mode — legacy stored settings
      // alias to "split" (matching cairn-plot's own normalize-on-read).
      next = { ...next, mode: (legacy === "blend" ? "split" : legacy) as MediaCompareModeKind };
    }
  }
  if (next.diffMode === "none" && typeof raw.diffSubmode === "string") {
    next = { ...next, diffMode: raw.diffSubmode as DiffMode };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Pane — the REAL `ViewportModule.Pane`. Dispatches "normal" to the
// pure cairn-plot components and "split"/"diff" to
// OffscreenComparePanes, mirroring MeshViewportPane.
// ---------------------------------------------------------------------------

function BoxesViewportPane(
  props: ViewportPaneProps<BoxesViewportItem, BoxesViewState, BoxesFullSettings>,
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
    crossTypeReferenceUrl,
    crossTypeAlignForDiff,
    colorRange,
  } = props;
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = resolveBoxesViewConfig(settings);
  const hasCrossTypeRef = crossTypeReferenceUrl != null;
  const effectiveMode: MediaCompareModeKind = reference == null && !hasCrossTypeRef ? "normal" : mode;

  // Renders THIS pane's own (foreground) boxes live — shared by the
  // same-type split/blend/diff branch below AND the WS-VC6 cross-type
  // branch (a foreign-type reference has no same-type counterpart, so
  // cross-type routes through the generalized
  // `OffscreenComparePanes` too).
  const renderBoxesLive = (cb: (canvas: HTMLCanvasElement) => void, syncOpts: Scene3DSyncOptions) => {
    const active = resolveActiveProperty(data!.arrays.properties, view.property, data!.meta.properties ?? null);
    const effectiveColorMode = resolveBoxesColorMode(view.colorMode, !!active.values && !!active.range);
    const valueRange = effectiveColorMode === "value" ? (colorRange ?? active.range) : active.range;
    const maxDepth = effectiveColorMode === "depth" && colorRange ? colorRange[1] : data!.meta.max_depth;
    return (
      <BoxesViewer
        mins={data!.arrays.mins}
        maxs={data!.arrays.maxs}
        depth={data!.arrays.depth}
        values={active.values}
        nBoxes={data!.meta.n_boxes}
        bounds={data!.meta.bounds}
        maxDepth={maxDepth}
        valueRange={valueRange}
        colorMode={view.colorMode}
        depthRange={[0, data!.meta.max_depth]}
        background={view.background}
        showAxes={view.showAxes}
        showPlanes={view.showPlanes}
        cameraMode={view.cameraMode}
        sync={syncOpts}
        onFrame={cb}
      />
    );
  };

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
        mode={effectiveMode as Extract<MediaCompareModeKind, "split" | "diff">}
        syncGroupId={cameraSyncGroupId ?? null}
        primary={{ kind: "live", render: renderBoxesLive }}
        reference={{ kind: "frame", frameSource: { kind: "url", url: crossTypeReferenceUrl! } }}
        diffSubmode={diffMode}
        colormap={(settings.diffColormap ?? "turbo") as Colormap}
        splitPosition={splitPosition ?? 0.5}
        onSplitPositionChange={onSplitPositionChange ?? (() => {})}
        primaryLabel={label}
        alignForDiff={crossTypeAlignForDiff}
      />
    );
  }

  if (isCoreCompareMode(effectiveMode) && (effectiveMode === "split" || effectiveMode === "diff")) {
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
        primary={{ kind: "live", render: renderBoxesLive }}
        reference={{
          kind: "live",
          render: (cb, syncOpts) => {
            const active = resolveActiveProperty(reference.arrays.properties, view.property, reference.meta.properties ?? null);
            const effectiveColorMode = resolveBoxesColorMode(view.colorMode, !!active.values && !!active.range);
            const valueRange = effectiveColorMode === "value" ? (colorRange ?? active.range) : active.range;
            const maxDepth = effectiveColorMode === "depth" && colorRange ? colorRange[1] : reference.meta.max_depth;
            return (
              <BoxesViewer
                mins={reference.arrays.mins}
                maxs={reference.arrays.maxs}
                depth={reference.arrays.depth}
                values={active.values}
                nBoxes={reference.meta.n_boxes}
                bounds={reference.meta.bounds}
                maxDepth={maxDepth}
                valueRange={valueRange}
                colorMode={view.colorMode}
                depthRange={[0, reference.meta.max_depth]}
                background={view.background}
                showAxes={view.showAxes}
                showPlanes={view.showPlanes}
                cameraMode={view.cameraMode}
                sync={syncOpts}
                onFrame={cb}
              />
            );
          },
        }}
        diffSubmode={diffMode}
        colormap={(settings.diffColormap ?? "turbo") as Colormap}
        splitPosition={splitPosition ?? 0.5}
        onSplitPositionChange={onSplitPositionChange ?? (() => {})}
        primaryLabel={label}
      />
    );
  }

  void isBaseline;
  return (
    <BoxesSingleView
      item={data}
      view={view}
      sync={sync}
      label={label}
      isDraggable={isDraggable}
      onDragStart={onDragStart}
      colorRange={colorRange}
    />
  );
}

// ---------------------------------------------------------------------------
// SettingsControls — per-type controls injected into the shared settings
// panel (color mode, property, background, depth filter, value filter, diff
// colormap). "Sync 3D views" is rendered centrally by VisualContentCard.
// ---------------------------------------------------------------------------

const COLOR_MODE_OPTIONS: Array<{ value: BoxesColorMode; label: string }> = [
  { value: "depth", label: "Depth" },
  { value: "value", label: "Value (falls back to depth if absent)" },
  { value: "solid", label: "Solid" },
];

const BACKGROUND_OPTIONS: Array<{ value: BoxesBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

const ORIENTATION_OPTIONS: Array<{ value: Scene3DCameraMode; label: string }> = [
  { value: "orbital", label: "Orbital" },
  { value: "turntable", label: "Turntable" },
];

function BoxesSettingsControls({
  settings,
  update,
  meta,
}: {
  settings: BoxesFullSettings;
  update: (p: Partial<BoxesFullSettings>) => void;
  meta: unknown;
}) {
  const item = meta as BoxesViewportItem | null;
  const propertyOptions = propertyNames(item?.arrays.properties);
  const boxMeta = item?.meta;

  const depthCap = Math.max(boxMeta?.max_depth ?? 8, 1);
  const curDepthMin = settings.depthMin ?? 0;
  const curDepthMax = settings.depthMax ?? depthCap;
  const canFilterByValue = !!boxMeta?.value_range;
  const valLo = boxMeta?.value_range?.min ?? 0;
  const valHi = boxMeta?.value_range?.max ?? 1;
  const valStep = (valHi - valLo) / 100 || 0.01;
  const curValMin = settings.valueMin ?? valLo;
  const curValMax = settings.valueMax ?? valHi;

  return (
    <>
      <Select
        label="Color mode"
        value={settings.colorMode}
        onChange={(v) => update({ colorMode: v })}
        options={COLOR_MODE_OPTIONS}
        description="Depth uses a LUT over 0..max depth; Value needs per-box values logged"
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
      <Slider
        label="Depth min"
        value={curDepthMin}
        onChange={(v) => update({ depthMin: Math.min(v, curDepthMax) })}
        min={0}
        max={depthCap}
        step={1}
        format={(v) => v.toFixed(0)}
      />
      <Slider
        label="Depth max"
        value={curDepthMax}
        onChange={(v) => update({ depthMax: Math.max(v, curDepthMin) })}
        min={0}
        max={depthCap}
        step={1}
        format={(v) => v.toFixed(0)}
        description="Rebuilds the box geometry live; shows 'n of N boxes' below the view"
      />
      {canFilterByValue && (
        <>
          <Toggle
            label="Filter by value"
            checked={!!settings.valueFilterEnabled}
            onChange={(v) => update({ valueFilterEnabled: v })}
          />
          {settings.valueFilterEnabled && (
            <>
              <Slider
                label="Value min"
                value={curValMin}
                onChange={(v) => update({ valueMin: Math.min(v, curValMax) })}
                min={valLo}
                max={valHi}
                step={valStep}
                format={(v) => v.toFixed(2)}
              />
              <Slider
                label="Value max"
                value={curValMax}
                onChange={(v) => update({ valueMax: Math.max(v, curValMin) })}
                min={valLo}
                max={valHi}
                step={valStep}
                format={(v) => v.toFixed(2)}
              />
            </>
          )}
        </>
      )}
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

const DEFAULT_VIEW: BoxesViewState = {
  kind: "camera3d",
  position: [0, 0, 5],
  target: [0, 0, 0],
  zoom: 1,
};

export const boxesViewportModule: ViewportModule<
  BoxesViewportItem,
  BoxesViewState,
  BoxesFullSettings,
  BoxesNativeMode
> = {
  objectType: "boxes3d",
  capabilities: boxesViewportCapabilities,
  useData: useBoxesData,
  defaultSettings: defaultBoxesSettings,
  migrateSettings: migrateBoxesSettings,
  viewFromSettings: () => DEFAULT_VIEW,
  viewToSettingsPatch: () => ({}),
  defaultView: () => DEFAULT_VIEW,
  onResetView: (container) => resetScene3DViews(container),
  Pane: BoxesViewportPane,
  SettingsControls: BoxesSettingsControls,
  nativeDiff: { render: BoxesNativeDiffPane },
  activeColorbar: boxesActiveColorbar,
};

interface BoxesVisualCardProps {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/**
 * The lazy-loading boundary for boxes3d (WS-VC5): `CardRenderer.tsx`
 * dynamically imports THIS file instead of the deleted `BoxesCard.tsx`, so
 * `three`/`BoxesViewer` stay out of every other card's bundle.
 */
export default function BoxesVisualCard(props: BoxesVisualCardProps) {
  return (
    <VisualContentCard
      {...props}
      viewport={boxesViewportModule as unknown as ViewportModule<unknown, ViewState, VisualCompareSettings>}
    />
  );
}
