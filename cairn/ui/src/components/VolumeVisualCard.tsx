import { useEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import type { CardSettingsKey } from "../lib/card-settings";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { safeJsonParse } from "../lib/format";
import {
  isCoreCompareMode,
  type MediaCompareModeKind,
  type DiffMode,
  type Colormap,
  type ColormapName,
  type ViewportDataArgs,
  type ViewportDataResult,
  type ViewportModule,
  type ViewState,
} from "../lib/cairn-plot";
import VolumeViewer, {
  type VolumeRenderMode,
  type VolumeQuality,
  type VolumeBackground,
} from "../lib/cairn-plot/three/VolumeViewer";
import { parseNpz } from "../lib/cairn-plot/transforms/parse-npz";
import {
  VolumeSingleView,
  VolumeSideBySideView,
  VolumeNativeDiffPane,
  volumeViewportCapabilities,
  volumeActiveColorbar,
  resolveVolumeViewConfig,
  type VolumeMeta,
  type VolumeViewportItem,
  type VolumeViewState,
  type VolumeNativeMode,
} from "../lib/cairn-plot/viewport/volume-viewport";
import type { DiffColormap } from "../lib/cairn-plot/three/diff";
import { resetScene3DViews, type Scene3DSyncOptions } from "../lib/cairn-plot/three/use-scene3d";
import type { ViewportPaneProps } from "../lib/cairn-plot/viewport/types";
import { OffscreenComparePanes, useOffscreenSnapshot, type VisualCompareSettings } from "./card-kit";
import type { ForeignFrameProps } from "./card-kit/cross-type-frame";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import VisualContentCard from "./VisualContentCard";

// ---------------------------------------------------------------------------
// VolumeVisualCard — the volume object_type's APP-LAYER Viewport assembly +
// the lazy-loading boundary (WS-VC5). Mirrors MeshVisualCard.tsx /
// PointCloudVisualCard.tsx exactly — replaces the deleted VolumeCard.tsx.
// ---------------------------------------------------------------------------

async function fetchVolumeArray(hash: string): Promise<Float32Array> {
  const res = await fetch(api.artifactUrl(hash));
  if (!res.ok) throw new Error(`failed to fetch volume (${res.status})`);
  const npz = await parseNpz(await res.arrayBuffer());
  if (!npz.data) throw new Error("volume artifact is missing its 'data' array");
  // The shared parser returns Float64Array for uniform downstream math;
  // three.js Data3DTexture needs Float32Array, so narrow once here.
  return Float32Array.from(npz.data.data);
}

function useVolumeBlobs(hashes: (string | null)[]) {
  return useQueries({
    queries: hashes.map((h) => ({
      queryKey: ["volume-npz", h],
      enabled: !!h,
      staleTime: Infinity,
      queryFn: () => fetchVolumeArray(h!),
    })),
  });
}

function useVolumeData(args: ViewportDataArgs): ViewportDataResult<VolumeViewportItem> {
  const { hashes, referenceHashes, metadata, referenceMetadata } = args;
  const fg = useVolumeBlobs(hashes);
  const ref = useVolumeBlobs(referenceHashes);

  return useMemo(() => {
    const items = hashes.map((h, i) => {
      if (!h) return null;
      const blob = fg[i]?.data;
      const meta = safeJsonParse<VolumeMeta>(metadata?.[i]);
      if (!blob || !meta) return null;
      return { arrays: { data: blob }, meta };
    });
    const referenceItems = referenceHashes.map((h, i) => {
      if (!h) return null;
      const blob = ref[i]?.data;
      const meta = safeJsonParse<VolumeMeta>(referenceMetadata?.[i]);
      if (!blob || !meta) return null;
      return { arrays: { data: blob }, meta };
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
// VolumeForeignFrame — WS-VC6 cross-type bridge (mirrors `MeshForeignFrame`'s
// doc comment exactly): renders ONE volume hash's viewer hidden, default
// view (`defaultVolumeSettings`, hoisted below), purely to capture a single
// offscreen snapshot for another (image) card's cross-type compare.
// ---------------------------------------------------------------------------
export function VolumeForeignFrame({ hash, metadata, onFrame }: ForeignFrameProps) {
  const [blob] = useVolumeBlobs([hash]);
  const meta = safeJsonParse<VolumeMeta>(metadata);
  const snap = useOffscreenSnapshot();
  const view = resolveVolumeViewConfig(defaultVolumeSettings() as VolumeFullSettings);

  useEffect(() => {
    if (snap.dataUrl) onFrame({ kind: "dataUrl", dataUrl: snap.dataUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.dataUrl]);

  if (!blob?.data || !meta) return null;
  return (
    <VolumeViewer
      data={blob.data}
      shape={meta.shape}
      spacing={meta.spacing}
      origin={meta.origin}
      vmin={meta.vmin}
      vmax={meta.vmax}
      mode={view.mode}
      isovalue={view.isovalue}
      colormap={view.colormap}
      steps={view.steps}
      clip={{ min: view.clipMin, max: view.clipMax }}
      background={view.background}
      showAxes={view.showAxes}
      onFrame={snap.onFrame}
    />
  );
}

// ---------------------------------------------------------------------------
// Settings — VisualCompareSettings (shared) intersected with volume's own
// fields. `compareMode`/`diffSubmode` are the OLD field names for what's now
// `mode`/`nativeMode`/`diffMode` — read only through `migrateVolumeSettings`.
//
// NOTE: volume's render mode ("mip"/"iso") was persisted under the field name
// `mode` in the pre-refactor VolumeCard, which COLLIDES with the shared
// compare `mode` (MediaCompareModeKind) that VisualContentCard now owns. We
// rename the render mode to `renderMode` here to avoid the collision, and
// `migrateVolumeSettings` folds the legacy `mode` (if it held a render mode)
// into `renderMode`.
// ---------------------------------------------------------------------------

export interface VolumeFullSettings extends VisualCompareSettings {
  renderMode: VolumeRenderMode;
  isovalue: number;
  colormap: ColormapName;
  steps: VolumeQuality;
  clipMin: [number, number, number];
  clipMax: [number, number, number];
  background: VolumeBackground;
  diffColormap?: DiffColormap;
  /** Persisted "Show axes" setting (WS-3DR2). */
  showAxes?: boolean;
}

function defaultVolumeSettings(): Omit<VolumeFullSettings, "metrics" | "version"> {
  return {
    renderMode: "mip",
    isovalue: 0.5,
    colormap: "viridis",
    steps: 128,
    clipMin: [0, 0, 0],
    clipMax: [1, 1, 1],
    background: "dark",
    showAxes: false,
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

const LEGACY_CORE_MODES = new Set<string>(["normal", "side", "split", "blend", "diff"]);
const RENDER_MODES = new Set<string>(["mip", "iso"]);

function migrateVolumeSettings(settings: VolumeFullSettings): VolumeFullSettings {
  const raw = settings as unknown as Record<string, unknown>;
  let next = settings;
  // The pre-refactor VolumeCard persisted its render mode ("mip"/"iso") under
  // the field name `mode`, which now collides with the shared compare `mode`
  // (MediaCompareModeKind) that VisualContentCard owns. When the stored
  // `mode` holds a render mode, fold it into `renderMode` and CLEAR `mode` so
  // VisualContentCard doesn't misread "mip"/"iso" as a compare mode. (When it
  // holds a genuine compare kind, leave it untouched.)
  if (typeof raw.mode === "string" && RENDER_MODES.has(raw.mode)) {
    next = { ...next, renderMode: raw.mode as VolumeRenderMode, mode: undefined };
  }
  if (next.mode == null && next.nativeMode == null && typeof raw.compareMode === "string") {
    const legacy = raw.compareMode;
    if (legacy === "diff-value") {
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
// OffscreenComparePanes, mirroring MeshViewportPane.
// ---------------------------------------------------------------------------

function VolumeViewportPane(
  props: ViewportPaneProps<VolumeViewportItem, VolumeViewState, VolumeFullSettings>,
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
    colorRange,
  } = props;
  const sync: Scene3DSyncOptions | null = cameraSyncGroupId ? { groupId: cameraSyncGroupId } : null;
  const view = resolveVolumeViewConfig(settings);
  const hasCrossTypeRef = crossTypeReferenceUrl != null;
  const effectiveMode: MediaCompareModeKind = reference == null && !hasCrossTypeRef ? "normal" : mode;

  // Renders THIS pane's own (foreground) volume live — shared by the
  // same-type split/blend/diff branch below AND the WS-VC6 cross-type
  // branch (a foreign-type reference has no `VolumeSideBySideView`
  // counterpart, so cross-type routes "side" through the generalized
  // `OffscreenComparePanes` too).
  const renderVolumeLive = (cb: (canvas: HTMLCanvasElement) => void, syncOpts: Scene3DSyncOptions) => {
    const [vmin, vmax] = colorRange ?? [data!.meta.vmin, data!.meta.vmax];
    return (
      <VolumeViewer
        data={data!.arrays.data}
        shape={data!.meta.shape}
        spacing={data!.meta.spacing}
        origin={data!.meta.origin}
        vmin={vmin}
        vmax={vmax}
        mode={view.mode}
        isovalue={view.isovalue}
        colormap={view.colormap}
        steps={view.steps}
        clip={{ min: view.clipMin, max: view.clipMax }}
        background={view.background}
        showAxes={view.showAxes}
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
        mode={effectiveMode as Extract<MediaCompareModeKind, "side" | "split" | "blend" | "diff">}
        primary={{ kind: "live", render: renderVolumeLive }}
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
      <VolumeSideBySideView
        item={data}
        reference={reference ?? null}
        view={view}
        sync={sync}
        label={label}
        isDraggable={isDraggable}
        onDragStart={onDragStart}
        colorRange={colorRange}
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
        primary={{ kind: "live", render: renderVolumeLive }}
        reference={{
          kind: "live",
          render: (cb, syncOpts) => {
            const [vmin, vmax] = colorRange ?? [reference.meta.vmin, reference.meta.vmax];
            return (
              <VolumeViewer
                data={reference.arrays.data}
                shape={reference.meta.shape}
                spacing={reference.meta.spacing}
                origin={reference.meta.origin}
                vmin={vmin}
                vmax={vmax}
                mode={view.mode}
                isovalue={view.isovalue}
                colormap={view.colormap}
                steps={view.steps}
                clip={{ min: view.clipMin, max: view.clipMax }}
                background={view.background}
                showAxes={view.showAxes}
                sync={syncOpts}
                onFrame={cb}
              />
            );
          },
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

  void isBaseline;
  return (
    <VolumeSingleView
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
// panel (render mode, isovalue, colormap, quality, background, 6-slider clip
// box, diff colormap). "Sync 3D views" is rendered centrally by
// VisualContentCard. The pre-refactor VolumeCard also had a deliberately
// inert PropertySelector (volume has a single implicit scalar field, no named
// properties — see cairn/sdk/handlers/volume.py); with no properties to
// select it was always a no-op, so it is dropped here rather than shown inert.
// ---------------------------------------------------------------------------

const MODE_OPTIONS: Array<{ value: VolumeRenderMode; label: string }> = [
  { value: "mip", label: "MIP (max-intensity projection)" },
  { value: "iso", label: "Isosurface" },
];

const COLORMAP_OPTIONS: Array<{ value: ColormapName; label: string }> = [
  { value: "viridis", label: "Viridis" },
  { value: "red-blue", label: "Red–Blue" },
  { value: "red-green", label: "Red–Green" },
];

const QUALITY_OPTIONS: Array<{ value: "64" | "128" | "256"; label: string }> = [
  { value: "64", label: "64 steps (fast)" },
  { value: "128", label: "128 steps" },
  { value: "256", label: "256 steps (fine)" },
];

const BACKGROUND_OPTIONS: Array<{ value: VolumeBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

function VolumeSettingsControls({
  settings,
  update,
}: {
  settings: VolumeFullSettings;
  update: (p: Partial<VolumeFullSettings>) => void;
  meta: unknown;
}) {
  const setClipMin = (axis: 0 | 1 | 2, v: number) => {
    const next = [...settings.clipMin] as [number, number, number];
    next[axis] = Math.min(v, settings.clipMax[axis]);
    update({ clipMin: next });
  };
  const setClipMax = (axis: 0 | 1 | 2, v: number) => {
    const next = [...settings.clipMax] as [number, number, number];
    next[axis] = Math.max(v, settings.clipMin[axis]);
    update({ clipMax: next });
  };
  return (
    <>
      <Select
        label="Render mode"
        value={settings.renderMode}
        onChange={(v) => update({ renderMode: v })}
        options={MODE_OPTIONS}
      />
      {settings.renderMode === "iso" && (
        <Slider
          label="Isovalue"
          value={settings.isovalue}
          onChange={(v) => update({ isovalue: v })}
          min={0}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          description="Fraction of the [vmin, vmax] value range"
        />
      )}
      <Select
        label="Colormap"
        value={settings.colormap}
        onChange={(v) => update({ colormap: v })}
        options={COLORMAP_OPTIONS}
      />
      <Select
        label="Quality"
        value={String(settings.steps) as "64" | "128" | "256"}
        onChange={(v) => update({ steps: Number(v) as VolumeQuality })}
        options={QUALITY_OPTIONS}
        description="Raymarch step count — higher is finer but slower"
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
      <div className="mt-2 border-t border-border-subtle pt-2">
        <div className="mb-1 text-xs font-semibold text-fg-muted">
          Clip box (slices the volume; axes follow the box's local X/Y/Z —
          width/height/depth of the [D,H,W] array)
        </div>
        <Slider label="Clip X min" value={settings.clipMin[0]} onChange={(v) => setClipMin(0, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
        <Slider label="Clip X max" value={settings.clipMax[0]} onChange={(v) => setClipMax(0, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
        <Slider label="Clip Y min" value={settings.clipMin[1]} onChange={(v) => setClipMin(1, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
        <Slider label="Clip Y max" value={settings.clipMax[1]} onChange={(v) => setClipMax(1, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
        <Slider label="Clip Z min" value={settings.clipMin[2]} onChange={(v) => setClipMin(2, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
        <Slider label="Clip Z max" value={settings.clipMax[2]} onChange={(v) => setClipMax(2, v)} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />
      </div>
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

const DEFAULT_VIEW: VolumeViewState = {
  kind: "camera3d",
  position: [0, 0, 5],
  target: [0, 0, 0],
  zoom: 1,
};

export const volumeViewportModule: ViewportModule<
  VolumeViewportItem,
  VolumeViewState,
  VolumeFullSettings,
  VolumeNativeMode
> = {
  objectType: "volume",
  capabilities: volumeViewportCapabilities,
  useData: useVolumeData,
  defaultSettings: defaultVolumeSettings,
  migrateSettings: migrateVolumeSettings,
  viewFromSettings: () => DEFAULT_VIEW,
  viewToSettingsPatch: () => ({}),
  defaultView: () => DEFAULT_VIEW,
  onResetView: (container) => resetScene3DViews(container),
  Pane: VolumeViewportPane,
  SettingsControls: VolumeSettingsControls,
  nativeDiff: { render: VolumeNativeDiffPane },
  activeColorbar: volumeActiveColorbar,
};

interface VolumeVisualCardProps {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

/**
 * The lazy-loading boundary for volume (WS-VC5): `CardRenderer.tsx`
 * dynamically imports THIS file instead of the deleted `VolumeCard.tsx`, so
 * `three` + the raymarch shader stay out of every other card's bundle.
 */
export default function VolumeVisualCard(props: VolumeVisualCardProps) {
  return (
    <VisualContentCard
      {...props}
      viewport={volumeViewportModule as unknown as ViewportModule<unknown, ViewState, VisualCompareSettings>}
    />
  );
}
