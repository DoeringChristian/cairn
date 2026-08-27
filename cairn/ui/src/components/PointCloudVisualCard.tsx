import { useCallback, useMemo, useRef, useState } from "react";
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
} from "@cairn-plot/lib/cairn-plot";
import {
  PointCloudSingleView,
  PointCloudNativeDiffPane,
  pointCloudViewportCapabilities,
  pointCloudActiveColorbar,
  type PointCloudMeta,
  type PointCloudViewportItem,
  type PointCloudViewState,
} from "@cairn-plot/lib/cairn-plot/viewport/pointcloud-viewport";
import { propertyNames } from "@cairn-plot/lib/cairn-plot/three/properties";
import type { DiffColormap } from "@cairn-plot/lib/cairn-plot/three/diff";
import { resetScene3DViews, type Scene3DCameraMode, type Scene3DSyncOptions } from "@cairn-plot/lib/cairn-plot/three/use-scene3d";
import type { ViewportPaneProps } from "@cairn-plot/lib/cairn-plot/viewport/types";
import { PropertySelector, type VisualCompareSettings } from "./card-kit";
import { OffscreenComparePanes } from "@cairn-plot/lib/cairn-plot/media-compare/OffscreenComparePanes";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import { resolveCardHeight } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
import { useCardDrop } from "../lib/use-series-drop";
import { downloadArtifact, artifactFilename } from "../lib/download";
import {
  useCardSeries,
  useStepSlider,
  useRunInfo,
  useMediaReference,
  useReferenceDrop,
} from "./card-kit";
import { seriesLabel, seriesKey } from "./card-kit/series-identity";
import { useMediaSeriesData } from "./card-kit/use-media-series-data";
import { usePaneResolution } from "./card-kit/use-pane-resolution";
import { usePaneReferenceMeta } from "./card-kit/use-pane-reference-meta";
import { ExternalBaselinePicker } from "./card-kit/ExternalBaselinePicker";
import { migrateLegacyMode, Colorbar, COLORMAP_OPTIONS as DIFF_LUT_OPTIONS } from "@cairn-plot/lib/cairn-plot";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useCameraSync } from "../lib/camera-sync";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import { startViewportDrag, type SeriesRef } from "./SeriesChip";
import SeriesChipStrip from "./SeriesChipStrip";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import SettingsSection from "./settings/SettingsSection";
import StepSlider from "./StepSlider";

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
// Settings — VisualCompareSettings (shared) intersected with pointcloud's
// own fields, same pattern the design doc describes for every future
// module ("intersected with type-specific fields... via its own settings
// interface"). `compareMode`/`diffSubmode` are the OLD (pre-media-shell)
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

const LEGACY_CORE_MODES = new Set<string>(["normal", "split", "blend", "diff"]);

/**
 * Read migration for old pointcloud cards' persisted settings: folds the
 * pre-media-shell `compareMode` field (`MediaCompareMode<"diff-property"
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
  // Mirrors CompositeMediaPane's own rule: no reference resolved -> always
  // "normal", regardless of the user's selected mode (see ViewportPaneProps'
  // `mode` doc comment) — UNLESS a WS-VC6 cross-type reference is resolved
  // instead (same-type `reference` is always null in that case).
  const effectiveMode: MediaCompareModeKind = reference == null ? "normal" : mode;

  // Renders THIS pane's own (foreground) point cloud live — shared by the
  // same-type split/blend/diff branch below AND the WS-VC6 cross-type
  // branch (a foreign-type reference has no same-type counterpart, so
  // cross-type routes through the generalized
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
        colormap={(settings.diffColormap ?? "turbo") as Colormap}
        splitPosition={splitPosition ?? 0.5}
        onSplitPositionChange={onSplitPositionChange ?? (() => {})}
        primaryLabel={label}
      />
    );
  }

  // "normal" (isBaseline is accepted for interface conformance; unlike
  // image, pointcloud never renders an explicit standalone REF pane in the
  // multi-pane grid, matching the pre-refactor card).
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
// the card body below, gated on `capabilities.cameraSync` (shared chrome,
// not a per-module control).
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
          Compare section of the card body (WS-MFIX Bug 2) — rendering
          it here too would duplicate the control in the same settings
          panel. */}
    </>
  );
}

const DEFAULT_VIEW: PointCloudViewState = {
  kind: "camera3d",
  position: [0, 0, 5],
  target: [0, 0, 0],
  zoom: 1,
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

const OBJECT_TYPE = "pointcloud";

const MODE_LABELS: Record<string, string> = {
  normal: "Normal",
  // Aligned to cairn-plot's own compare-mode menu wording (split -> "Slide").
  split: "Slide",
  diff: "Diff",
};

const PIXEL_DIFF_TYPE_VALUES = new Set(["signed", "absolute", "squared", "relative_signed", "relative_absolute", "relative_squared"]);

/**
 * The pointcloud card — an individual file (the shared media shell was
 * dissolved into per-kind cards; this file owns its own composition of the
 * card-kit hooks). Also the lazy-loading boundary (WS-VC5): `CardRenderer`
 * dynamically imports THIS file so `three` stays out of every other card's
 * bundle. Same-type compare only — the cross-type (image<->3D) bridge was
 * dropped with the shell.
 */
export default function PointCloudVisualCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: PointCloudVisualCardProps) {
  useRunMetadataVersion();

  const caps = pointCloudViewportCapabilities;
  const MIN_HEIGHT = cardMinSize(OBJECT_TYPE).minHeight;

  const {
    settings: rawSettings,
    updateSettings,
    effectiveMetrics,
    allRunIds: availableRunIds,
    multipleRuns,
  } = useCardSeries<PointCloudFullSettings>({
    runId,
    metric,
    extraSeries,
    controlledSeries,
    settingsKeyOverride,
    makeDefaults: (_seed, metrics) => ({
      version: 1,
      metrics,
      ...defaultPointCloudSettings(),
    }),
  });

  // Read migration for pre-shell persisted settings (non-destructive).
  const settings = migratePointCloudSettings(rawSettings);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const effectiveMode: MediaCompareModeKind =
    settings.mode ??
    migrateLegacyMode({
      diffMode: settings.diffMode,
      compareMode: settings.compareMode,
      referenceMode: settings.referenceMode,
    });

  const activeNativeMode: string | undefined = settings.nativeMode ?? undefined;

  const setMode = useCallback((mode: MediaCompareModeKind) => {
    const updates: Partial<PointCloudFullSettings> = { mode, nativeMode: undefined };
    if (mode === "diff" && settingsRef.current.diffMode === "none") {
      updates.diffMode = "absolute";
    }
    updateSettings(updates);
  }, [updateSettings]);

  // -----------------------------------------------------------------------
  // Data: multi-series fetch, step slider, per-pane resolution
  // -----------------------------------------------------------------------
  const { perSeriesPoints, perSeriesStepMap, globalStepPoints, anyLoading } =
    useMediaSeriesData(runId, effectiveMetrics);

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints: perSeriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });

  const { paneResolved, paneHashArr, paneMetadata, firstResolved, downloadMime } =
    usePaneResolution(effectiveMetrics, perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode);

  const isMulti = effectiveMetrics.length > 1 || settings.externalBaseline != null;

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();
  const { runInfoMap } = useRunInfo(availableRunIds);
  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => effectiveMetrics.map((m) => ({
      runId: m.runId ?? runId,
      name: m.name,
      context_hash: m.context_hash,
    })),
    [runId, effectiveMetrics],
  );

  // -----------------------------------------------------------------------
  // Reference drop target — SAME-TYPE only: a drag payload carrying a
  // different object_type is ignored (the cross-type bridge was dropped).
  // Dropping a reference always lands on "diff".
  // -----------------------------------------------------------------------
  const applyReference = useCallback((ref: SeriesRef, mode: "global" | "per-run") => {
    if (ref.objectType && ref.objectType !== OBJECT_TYPE) return;
    updateSettings({
      externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
      baselineIndex: undefined,
      referenceMode: mode,
      diffMode: settingsRef.current.diffMode === "none" ? "absolute" : settingsRef.current.diffMode,
      mode: "diff",
    });
  }, [updateSettings]);
  const { highlight: refDropHighlight, dropProps: refDropProps } = useReferenceDrop({
    onSeriesDrop: (ref) => applyReference(ref, "per-run"),
    onViewportDrop: (ref) => applyReference(ref, "global"),
  });
  const { onDragOver: onRefDragOver, onDragLeave: onRefDragLeave, onDrop: onRefDrop } = refDropProps;

  const onPaneDragStart = useCallback((e: React.DragEvent, m: { runId?: string; name: string; context_hash: string }) => {
    startViewportDrag(e, { runId: m.runId ?? runId, name: m.name, context_hash: m.context_hash, objectType: OBJECT_TYPE }, m.name);
  }, [runId]);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  // -----------------------------------------------------------------------
  // Reference resolution
  // -----------------------------------------------------------------------
  const extBase = settings.externalBaseline;
  const refMode = settings.referenceMode ?? "global";

  const setReferenceMode = useCallback((mode: "global" | "per-run") => {
    updateSettings({ referenceMode: mode });
  }, [updateSettings]);

  const { perPaneHash, externalPoints, perRunPoints } = useMediaReference({
    runId,
    perSeriesStepMap,
    perSeriesPoints,
    seriesBaselineIndex: settings.baselineIndex,
    seriesBaselineFixedStep: settings.refFixedStep,
    external: extBase,
    externalScope: refMode,
    panes: effectiveMetrics,
    currentStep,
    safeIdx,
    missingImageMode: settings.missingImageMode,
  });

  const baselineIdx = settings.baselineIndex;
  const hasBaseline = baselineIdx != null || extBase != null;

  const { paneRefHashArr, paneReferenceMetadata } = usePaneReferenceMeta({
    effectiveMetrics,
    paneResolvedHashes: paneHashArr,
    perPaneHash,
    externalBaseline: extBase,
    referenceMode: refMode,
    externalPoints,
    perRunPoints,
    perSeriesPoints,
    baselineIndex: settings.baselineIndex,
  });

  // Cap simultaneously-rendered panes (WebGL budget) — only the RENDERED/
  // FETCHED pane set is capped; series management (SeriesChipStrip, the step
  // slider's range) still spans every series.
  const shownMetrics = useMemo(
    () => (Number.isFinite(caps.maxPanes) ? effectiveMetrics.slice(0, caps.maxPanes) : effectiveMetrics),
    [effectiveMetrics, caps.maxPanes],
  );

  const viewData = usePointCloudData({
    hashes: paneHashArr.slice(0, shownMetrics.length),
    referenceHashes: paneRefHashArr.slice(0, shownMetrics.length),
    metadata: paneMetadata.slice(0, shownMetrics.length),
    referenceMetadata: paneReferenceMetadata.slice(0, shownMetrics.length),
  });

  // Live camera-sync group — resolved ONCE per card (never per pane, see
  // `lib/camera-sync.ts`) and threaded to every pane below.
  const cameraSyncGroupId = useCameraSync(!!settings.syncViews);

  // The selected native (card-rendered, non-compositor) mode, if any is both
  // chosen AND currently enabled (`enabledFor`, evaluated against the first
  // pane's resolved content/reference as a representative pair).
  const activeNativeSpec = activeNativeMode
    ? caps.nativeModes.find((nm) => nm.mode === activeNativeMode)
    : undefined;
  const nativeEnabled =
    !!activeNativeSpec
    && activeNativeSpec.enabledFor(viewData.items[0] ?? null, viewData.referenceItems[0] ?? null);
  const RenderPane = nativeEnabled ? PointCloudNativeDiffPane : PointCloudViewportPane;

  // The SINGLE card-level colorbar, computed once (not per Pane) across every
  // currently-resolved pane's items; `nativeMode` mirrors the actual render
  // gating so the colorbar reflects what's rendered, not merely selected.
  const colorbarInfo = pointCloudActiveColorbar({
    items: viewData.items,
    referenceItems: viewData.referenceItems,
    settings,
    mode: effectiveMode,
    nativeMode: nativeEnabled ? activeNativeMode : undefined,
  }) ?? null;
  const colorRange: [number, number] | null = colorbarInfo ? [colorbarInfo.min, colorbarInfo.max] : null;

  const cardRef = useRef<HTMLDivElement>(null);

  // 3D panes don't report a natural size, so the auto height is the fixed
  // pre-shell default; an explicitly persisted card height rules when set.
  const autoHeight = resolveCardHeight(settings, undefined, MIN_HEIGHT) == null ? "20rem" : undefined;

  // -----------------------------------------------------------------------
  // Panes
  // -----------------------------------------------------------------------
  const renderMultiPaneGrid = () => {
    const splitPos = settings.splitPosition ?? 0.5;
    const diffSubmode: DiffMode = settings.diffMode === "none" ? "absolute" : settings.diffMode;

    return (
      <div
        className="grid gap-1 flex-1 min-h-0 overflow-auto"
        style={{ gridTemplateColumns: `repeat(${settings.imageColumns ?? 2}, 1fr)` }}
      >
        {shownMetrics.length < effectiveMetrics.length && (
          <div className="col-span-full mono text-xs text-fg-subtle">
            {`showing ${shownMetrics.length} of ${effectiveMetrics.length}`}
          </div>
        )}
        {shownMetrics.map((m, paneIdx) => {
          if (refMode === "global" && settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
          const fallbackStep = paneResolved[paneIdx]?.fallbackStep ?? null;
          const label = seriesLabel(m, runId, multipleRuns, availableRunIds)
            + (fallbackStep != null ? ` (step ${fallbackStep})` : "");

          return (
            <div key={seriesKey(m)} className="relative overflow-hidden">
              <RenderPane
                toolbar={false}
                data={viewData.items[paneIdx] ?? null}
                reference={viewData.referenceItems[paneIdx] ?? null}
                settings={settings}
                view={DEFAULT_VIEW}
                onViewChange={() => {}}
                mode={effectiveMode}
                diffMode={diffSubmode}
                nativeMode={activeNativeMode}
                cameraSyncGroupId={cameraSyncGroupId}
                colorRange={colorRange}
                isBaseline={refMode === "global" && baselineIdx === paneIdx}
                splitPosition={splitPos}
                onSplitPositionChange={(pos) => updateSettings({ splitPosition: pos })}
                label={label}
                isDraggable
                onDragStart={(e) => onPaneDragStart(e, m)}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const renderSingleView = () => (
    <PointCloudViewportPane
      toolbar={false}
      data={viewData.items[0] ?? null}
      reference={null}
      settings={settings}
      view={DEFAULT_VIEW}
      onViewChange={() => {}}
      mode="normal"
      diffMode="absolute"
      cameraSyncGroupId={cameraSyncGroupId}
      colorRange={colorRange}
      isDraggable
      onDragStart={(e) => onPaneDragStart(e, effectiveMetrics[0]!)}
      label={metric.name}
    />
  );

  const renderContent = () => isMulti ? renderMultiPaneGrid() : renderSingleView();

  // 3D reset-view is imperative (`resetScene3DViews`) — always enabled.
  const resetView = () => resetScene3DViews(cardRef.current);

  // -----------------------------------------------------------------------
  // Compare menus: core modes + the diff-type dropdown (six pointwise diffs
  // + this type's native geometry diffs, gated on topology).
  // -----------------------------------------------------------------------
  const modeSelectorEntries = caps.coreModes.map((m) => ({
    value: m as string,
    label: MODE_LABELS[m] ?? m,
    disabled: false,
  }));
  const viewModeEntries = modeSelectorEntries.filter((m) => m.value !== "diff");
  const handleModeSelect = useCallback((value: string) => {
    setMode(value as MediaCompareModeKind);
  }, [setMode]);

  const diffTypeEntries: Array<{ value: string; label: string; disabled: boolean; title?: string }> = [
    { value: "signed", label: "Signed Error", disabled: false },
    { value: "absolute", label: "Absolute Error", disabled: false },
    { value: "squared", label: "Squared Error", disabled: false },
    { value: "relative_signed", label: "Relative Signed", disabled: false },
    { value: "relative_absolute", label: "Relative Absolute", disabled: false },
    { value: "relative_squared", label: "Relative Squared", disabled: false },
    ...caps.nativeModes.map((nm) => {
      const enabled = nm.enabledFor(viewData.items[0] ?? null, viewData.referenceItems[0] ?? null);
      return { value: nm.mode as string, label: nm.label, disabled: !enabled, title: enabled ? undefined : nm.disabledReason };
    }),
  ];
  const selectedDiffTypeValue: string =
    (settings.diffKernel && PIXEL_DIFF_TYPE_VALUES.has(settings.diffKernel)
      ? settings.diffKernel
      : undefined)
    ?? activeNativeMode
    ?? (settings.diffMode === "none" ? "absolute" : settings.diffMode);
  const handleDiffTypeSelect = useCallback((value: string) => {
    if (PIXEL_DIFF_TYPE_VALUES.has(value)) {
      updateSettings({ diffMode: value as PointCloudFullSettings["diffMode"], nativeMode: undefined, diffKernel: value });
    } else {
      updateSettings({ nativeMode: value, diffKernel: undefined });
    }
  }, [updateSettings]);

  // -----------------------------------------------------------------------
  // Settings panel
  // -----------------------------------------------------------------------
  const settingsPanel = (
    <>
      <Toggle
        label="Sync 3D views"
        checked={!!settings.syncViews}
        onChange={(v) => updateSettings({ syncViews: v })}
        description="Share orbit/zoom/pan live across this card's own panes (not with other 3D cards on the page)"
      />
      <PointCloudSettingsControls settings={settings} update={updateSettings} meta={viewData.items[0] ?? null} />
      <SettingsSection title="Compare" />
      <Select<string>
        label="Mode"
        value={effectiveMode}
        onChange={(v) => handleModeSelect(v)}
        options={modeSelectorEntries}
      />
      {effectiveMode === "diff" && (
        <Select<string>
          label="Diff type"
          value={selectedDiffTypeValue}
          onChange={(v) => handleDiffTypeSelect(v)}
          options={diffTypeEntries}
        />
      )}
      {effectiveMode === "diff" && (
        <Select<DiffColormap>
          label="Diff colormap"
          value={settings.diffColormap ?? "turbo"}
          onChange={(v) => updateSettings({ diffColormap: v })}
          options={[
            { value: "turbo", label: "Turbo (magnitude)" },
            { value: "red-green", label: "Red - Green (signed)" },
          ]}
          description="Color mapping for the active diff (pixel or native)"
        />
      )}
      {isMulti && extBase && (
        <Select<"global" | "per-run">
          label="Reference mode"
          value={settings.referenceMode ?? "global"}
          onChange={(v) => setReferenceMode(v)}
          options={[
            { value: "per-run", label: "Per-run (each run uses its own copy of the ref tag)" },
            { value: "global", label: "Global (same ref for all runs)" },
          ]}
        />
      )}
      {(effectiveMode !== "normal" || activeNativeMode != null) && (
        <>
          <Toggle
            label="Pin reference to a fixed step"
            checked={settings.refFixedStep != null}
            onChange={(v) => updateSettings({ refFixedStep: v ? currentStep : undefined })}
            description="Off = per-iteration (reference tracks the same step as the primary series)"
          />
          {settings.refFixedStep != null && (
            <Slider
              label="Reference step"
              value={settings.refFixedStep}
              onChange={(v) => updateSettings({ refFixedStep: Math.round(v) })}
              min={0}
              max={Math.max(...globalSteps, settings.refFixedStep, 1)}
              step={1}
              format={(v) => v.toFixed(0)}
            />
          )}
        </>
      )}
      <div className="mt-2">
        <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
          Reference source
        </label>
        {settings.externalBaseline ? (
          <div className="flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
            <span className="mono truncate flex-1">{settings.externalBaseline.name}{settings.externalBaseline.runId && settings.externalBaseline.runId !== runId ? ` · ${shortRunLabel(settings.externalBaseline.runId)}` : ""}</span>
            <button
              type="button"
              onClick={() => updateSettings({ externalBaseline: undefined, baselineIndex: undefined, referenceMode: undefined })}
              className="text-fg-subtle hover:text-fg shrink-0"
              title="Remove external reference"
            >{"×"}</button>
          </div>
        ) : (
          <p className="text-[10px] text-fg-subtle mb-1">
            {multipleRuns
              ? "Pick a run below, then choose this metric to make that run the shared baseline every other run diffs/splits against. Or select a different tag / drag a series chip onto the card."
              : "Drag a series chip onto the card, or select a tag below."}
          </p>
        )}
        <ExternalBaselinePicker
          runId={runId}
          objectType={OBJECT_TYPE}
          currentMetricName={metric.name}
          selected={settings.externalBaseline?.name}
          availableRunIds={availableRunIds}
          onSelect={(name, ctx, selectedRunId) => {
            updateSettings({
              externalBaseline: { runId: selectedRunId, name, context_hash: ctx },
              baselineIndex: undefined,
              diffMode: settings.diffMode === "none" ? "absolute" : settings.diffMode,
              mode: "diff",
            });
          }}
        />
      </div>
    </>
  );

  const modalContent = (
    <div className="h-[calc(100vh-12rem)] flex flex-col">
      {renderContent()}
      <StepSlider
        points={globalStepPoints}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateSettings({ xAxis: m })}
        className="mt-3"
      />
      {!hasSelectionProvider && (
        <RunSelectionPanel
          selectedRunIds={selectedArray}
          allRunIds={availableRunIds}
          onClear={clear}
          runInfo={runInfoMap}
          label="Point cloud selection"
        />
      )}
    </div>
  );

  return (
    <CardShell cardKind={OBJECT_TYPE}
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={firstResolved.hash ? () => downloadArtifact(api.artifactUrl(firstResolved.hash!), artifactFilename(metric.name, currentStep, downloadMime, caps.downloadExtension)) : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType={OBJECT_TYPE} series={compSeries} />}
      onResetView={resetView}
      viewModified
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={settingsPanel}
      modalContent={modalContent}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>
      {anyLoading && globalSteps.length === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : globalSteps.length > 0 ? (
        <>
          <div
            ref={cardRef}
            className={`relative min-h-0 flex flex-col overflow-hidden${resolveCardHeight(settings, undefined, MIN_HEIGHT) != null ? " flex-1" : ""}${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
            style={{ height: autoHeight }}
            onDragOver={onRefDragOver}
            onDragLeave={onRefDragLeave}
            onDrop={onRefDrop}
          >
          <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {renderContent()}
          </div>
          {colorbarInfo && (
            <Colorbar colormap={colorbarInfo.colormap} min={colorbarInfo.min} max={colorbarInfo.max} />
          )}
          </div>
          </div>

          {isMulti && hasBaseline && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
              <select
                value={settings.diffColormap ?? "turbo"}
                onChange={(e) => updateSettings({ diffColormap: e.target.value as DiffColormap })}
                className="h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer text-accent"
                title="Colormap"
              >
                {DIFF_LUT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <select
                value={effectiveMode === "diff" ? selectedDiffTypeValue : effectiveMode}
                onChange={(e) => {
                  const value = e.target.value;
                  if (viewModeEntries.some((m) => m.value === value)) {
                    handleModeSelect(value);
                  } else {
                    handleModeSelect("diff");
                    handleDiffTypeSelect(value);
                  }
                }}
                className="h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer text-accent"
                title="Compare / diff mode"
              >
                <optgroup label="View">
                  {viewModeEntries.map((m) => (
                    <option key={m.value} value={m.value} disabled={m.disabled}>{m.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Error">
                  {diffTypeEntries.map((d) => (
                    <option key={d.value} value={d.value} disabled={d.disabled} title={d.title}>{d.label}</option>
                  ))}
                </optgroup>
              </select>
              {effectiveMode === "split" && !activeNativeMode && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.splitPosition ?? 0.5}
                  onChange={(e) => updateSettings({ splitPosition: Number(e.target.value) })}
                  className="w-24 accent-accent"
                  title="Split position"
                />
              )}
            </div>
          )}

          <StepSlider
            points={globalStepPoints}
            currentIndex={safeIdx}
            onChange={onSliderChange}
            xAxis={settings.xAxis}
            onXAxisChange={(m) => updateSettings({ xAxis: m })}
            className="mt-3"
          />
        </>
      ) : (
        <div className="text-sm text-fg-muted">no pointcloud logged yet</div>
      )}

      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={availableRunIds}
        onMetricsChange={(next) => updateSettings({ metrics: next, baselineIndex: undefined, paneWidths: undefined })}
        labelFn={seriesLabel}
        onClick={multipleRuns ? toggle : undefined}
        selectedIds={selectedIds}
      />

      {!hasSelectionProvider && (
        <RunSelectionPanel
          selectedRunIds={selectedArray}
          allRunIds={availableRunIds}
          onClear={clear}
          runInfo={runInfoMap}
          label="Point cloud selection"
        />
      )}
      </>
    </CardShell>
  );
}
