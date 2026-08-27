import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import { resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { downloadArtifact, exportImagesAsComposite, safeName, artifactFilename, type CompositePane } from "../lib/download";
import {
  useCardSeries,
  useStepSlider,
  useRunInfo,
  useMediaReference,
  useReferenceDrop,
  type VisualCompareSettings,
} from "./card-kit";
import { seriesLabel, seriesKey } from "./card-kit/series-identity";
import { useMediaSeriesData } from "./card-kit/use-media-series-data";
import { usePaneResolution } from "./card-kit/use-pane-resolution";
import { usePaneReferenceMeta } from "./card-kit/use-pane-reference-meta";
import { useMediaGridLayout } from "./card-kit/use-media-grid-layout";
import { useEngineDiffKernels } from "./card-kit/use-engine-diff-kernels";
import { ExternalBaselinePicker } from "./card-kit/ExternalBaselinePicker";
import {
  ImageViewportPane,
  ColormapSwatch,
  COLORMAP_OPTIONS,
  DIVERGING_COLORMAPS,
  DEFAULT_OVERLAY_SETTINGS,
  createEndpointDataSource,
  getColormapLUT,
  overlayClassColor,
  parseOverlay,
  resolveArtifactAtStep,
  resolveImageViewportItems,
  resolveImageViewportItemsAsync,
  migrateLegacyMode,
  Colorbar,
  useContainerSize,
  type Colormap,
  type DiffMode,
  type ImageOverlaySettings,
  type ImageViewportItem,
  type MediaCompareModeKind,
  type ViewportDataArgs,
  type ViewportDataResult,
} from "@cairn-plot/lib/cairn-plot";
import { enumerateCompareModeOptions } from "@cairn-plot/lib/cairn-plot/media-compare";
// The Peak-slider seed tracks cairn-plot's own extended-tonemap default so the
// app can't drift from the pane surface's default (16). Deep import: the const
// isn't re-exported from the package root.
import { EXTENDED_TONEMAP_PEAK_DEFAULT } from "@cairn-plot/lib/cairn-plot/image/tonemap";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import { startViewportDrag, type SeriesRef } from "./SeriesChip";
import SeriesChipStrip from "./SeriesChipStrip";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import SettingsSection from "./settings/SettingsSection";
import StepSlider from "./StepSlider";

// ---------------------------------------------------------------------------
// ImageCard — the `image` object_type's card, an individual file (the shared
// media shell was dissolved; every media card owns its own composition of the
// card-kit hooks). Types ≠ cards: `cairn.Image` logs the TYPE; this card is
// one CONSUMER of it. Same-type compare only — the cross-type (image↔3D)
// bridge was dropped with the shell.
//
// Settings model: the pane toolbar stays hidden (`toolbar={false}` — cairn-
// plot's host-driven controlled-surface seam), and this card's settings panel
// drives every host-controllable pane prop: processing (brightness/contrast/
// gamma/exposure/offset/flipSign), the unified tone-map operator set + peak +
// tonemapGamma, interpolation, false-color colormap (every cairn-plot LUT),
// pixel axes, pixel-value notation, overlays, diff kernels (pointwise + the
// GPU FLIP/HDR-FLIP/SSIM set), split position, zoom/pan. Settings persist in
// card settings and are shared per content kind (stacked-settings ruling).
// ---------------------------------------------------------------------------

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

type ImageSettings = VisualCompareSettings;

const OBJECT_TYPE = "image";

const MODE_LABELS: Record<string, string> = {
  normal: "Normal",
  // Aligned to cairn-plot's own compare-mode menu wording (split → "Slide").
  split: "Slide",
  diff: "Diff",
};

const CORE_MODES: MediaCompareModeKind[] = ["normal", "split", "diff"];

const PIXEL_DIFF_TYPE_VALUES = new Set(["signed", "absolute", "squared", "relative_signed", "relative_absolute", "relative_squared"]);

/** The app's default `DataSource` — wraps `api.artifactUrl` (keeps the app's
 *  API client out of cairn-plot itself). */
const endpointDataSource = createEndpointDataSource((hash) => api.artifactUrl(hash));

/**
 * Image data resolution: an instant synchronous `{url, overlay}` baseline per
 * pane (no fetch) so SDR panes render immediately; the async float-aware
 * resolver then fetches+decodes any `.exr`/float-`.npy` artifact (detected
 * from the host's `artifact_mime`, else URL extension + magic bytes) and
 * replaces the item with a decoded float source — this is what lights up the
 * true-HDR panes/compare (rgba16float, HDR-FLIP auto-dispatch, host-driven
 * tonemap). Browser-native panes pass through unchanged.
 */
function useImageData(args: ViewportDataArgs): ViewportDataResult<ImageViewportItem> {
  const { hashes, referenceHashes, metadata, mimes, referenceMimes } = args;
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

export default function ImageCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  useRunMetadataVersion();

  const { kernels: engineDiffKernels, gpuAvailable } = useEngineDiffKernels();
  const MIN_HEIGHT = cardMinSize(OBJECT_TYPE).minHeight;

  const {
    settings,
    updateSettings,
    effectiveMetrics,
    allRunIds: availableRunIds,
    multipleRuns,
  } = useCardSeries<ImageSettings>({
    runId,
    metric,
    extraSeries,
    controlledSeries,
    settingsKeyOverride,
    makeDefaults: (_seed, metrics) => ({
      version: 1,
      metrics,
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
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The unified exclusive mode — `settings.mode` is authoritative once
  // present; otherwise derived from the legacy {diffMode, compareMode,
  // referenceMode} combo (settings migration on read).
  const effectiveMode: MediaCompareModeKind =
    settings.mode ??
    migrateLegacyMode({
      diffMode: settings.diffMode,
      compareMode: settings.compareMode,
      referenceMode: settings.referenceMode,
    });

  const setMode = useCallback((mode: MediaCompareModeKind) => {
    const updates: Partial<ImageSettings> = { mode, nativeMode: undefined };
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

  const {
    paneResolved, paneHashArr, paneMetadata, paneMimes,
    firstResolved, downloadMime,
  } = usePaneResolution(effectiveMetrics, perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode);

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
  // Container size (for auto-height) + image aspect
  // -----------------------------------------------------------------------
  const { ref: containerSizeRef, size: containerSize } = useContainerSize<HTMLDivElement>();
  const containerWidth = containerSize.w;

  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const onImageNaturalSize = useCallback((w: number, h: number) => {
    setImageAspect((prev) => prev ?? h / w);
  }, []);

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

  const onImageDragStart = useCallback((e: React.DragEvent, m: { runId?: string; name: string; context_hash: string }) => {
    startViewportDrag(e, { runId: m.runId ?? runId, name: m.name, context_hash: m.context_hash, objectType: OBJECT_TYPE }, m.name);
  }, [runId]);

  // -----------------------------------------------------------------------
  // Overlays (bounding boxes + segmentation masks)
  // -----------------------------------------------------------------------
  const ovl: ImageOverlaySettings = useMemo(
    () => ({ ...DEFAULT_OVERLAY_SETTINGS, ...(settings.overlay ?? {}) }),
    [settings.overlay],
  );

  const paneOverlays = useMemo(
    () => paneMetadata.map((md) => parseOverlay(md)),
    [paneMetadata],
  );

  const { hasOverlay, overlayClasses } = useMemo(() => {
    const classes = new Map<number, string>();
    let any = false;
    for (const ov of paneOverlays) {
      if (!ov) continue;
      if ((ov.boxes?.length ?? 0) > 0 || (ov.masks?.length ?? 0) > 0) any = true;
      for (const b of ov.boxes ?? []) {
        if (!classes.has(b.class_id)) {
          classes.set(b.class_id, b.label ?? ov.class_labels?.[String(b.class_id)] ?? `#${b.class_id}`);
        }
      }
      for (const [k, v] of Object.entries(ov.class_labels ?? {})) {
        const id = Number(k);
        if (id !== 0 && !classes.has(id)) classes.set(id, v);
      }
      for (const m of ov.masks ?? []) {
        for (const [k, v] of Object.entries(m.class_labels ?? {})) {
          const id = Number(k);
          if (id !== 0 && !classes.has(id)) classes.set(id, v);
        }
      }
    }
    return {
      hasOverlay: any,
      overlayClasses: [...classes.entries()].sort((a, b) => a[0] - b[0]),
    };
  }, [paneOverlays]);

  const updateOverlay = useCallback(
    (changes: Partial<ImageOverlaySettings>) => {
      updateSettings({ overlay: { ...ovl, ...changes } });
    },
    [ovl, updateSettings],
  );

  const toggleOverlayClass = useCallback(
    (classId: number) => {
      const hidden = new Set(ovl.hiddenClasses);
      if (hidden.has(classId)) hidden.delete(classId);
      else hidden.add(classId);
      updateOverlay({ hiddenClasses: [...hidden] });
    },
    [ovl.hiddenClasses, updateOverlay],
  );

  // -----------------------------------------------------------------------
  // Grid layout
  // -----------------------------------------------------------------------
  const gridLayout = useMediaGridLayout({
    paneCount: effectiveMetrics.length,
    imageColumns: settings.imageColumns,
    contentAspect: imageAspect,
    containerWidth,
    settings,
    minHeight: MIN_HEIGHT,
  });

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

  const { paneRefHashArr, paneReferenceMetadata, paneReferenceMimes } = usePaneReferenceMeta({
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

  // Image has no pane cap (no per-pane WebGL context) — every series renders.
  const viewData = useImageData({
    hashes: paneHashArr,
    referenceHashes: paneRefHashArr,
    metadata: paneMetadata,
    referenceMetadata: paneReferenceMetadata,
    mimes: paneMimes,
    referenceMimes: paneReferenceMimes,
  });

  // Settings handed to each Pane: identical to persisted settings, but with
  // the overlay pre-merged against DEFAULT_OVERLAY_SETTINGS.
  const paneSettings = useMemo(
    () => ({ ...settings, overlay: ovl }),
    [settings, ovl],
  );

  const view = useMemo(
    () => ({ kind: "image2d" as const, zoom: settings.zoom, pan: settings.pan }),
    [settings.zoom, settings.pan],
  );
  const onPaneViewChange = useCallback(
    (v: { kind: "image2d"; zoom: number; pan: { x: number; y: number } }) => {
      if (v.kind === "image2d") updateSettings({ zoom: v.zoom, pan: v.pan });
    },
    [updateSettings],
  );

  const cardRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Panes
  // -----------------------------------------------------------------------
  const renderMultiPaneGrid = () => {
    const splitPos = settings.splitPosition ?? 0.5;
    const diffSubmode: DiffMode = settings.diffMode === "none" ? "absolute" : settings.diffMode;

    return (
      <div
        className="grid gap-1 flex-1 min-h-0 overflow-auto"
        style={{
          gridTemplateColumns: `repeat(${settings.imageColumns ?? 2}, 1fr)`,
          gridAutoRows: gridLayout.cellHeight != null ? `${gridLayout.cellHeight}px` : undefined,
        }}
      >
        {effectiveMetrics.map((m, paneIdx) => {
          if (refMode === "global" && settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
          const fallbackStep = paneResolved[paneIdx]?.fallbackStep ?? null;
          const label = seriesLabel(m, runId, multipleRuns, availableRunIds)
            + (fallbackStep != null ? ` (step ${fallbackStep})` : "");

          return (
            <div key={seriesKey(m)} className="relative overflow-hidden">
              <ImageViewportPane
                toolbar={false}
                data={viewData.items[paneIdx] ?? null}
                reference={viewData.referenceItems[paneIdx] ?? null}
                settings={paneSettings}
                view={view}
                onViewChange={onPaneViewChange}
                mode={effectiveMode}
                diffMode={diffSubmode}
                diffKernel={settings.diffKernel}
                onDiffKernelChange={(k) => updateSettings({ diffKernel: k })}
                onCompareModeChange={(mode) => setMode(mode)}
                colorRange={null}
                isBaseline={refMode === "global" && baselineIdx === paneIdx}
                splitPosition={splitPos}
                onSplitPositionChange={(pos) => updateSettings({ splitPosition: pos })}
                label={label}
                isDraggable
                onDragStart={(e) => onImageDragStart(e, m)}
                onNaturalSize={onImageNaturalSize}
              />
            </div>
          );
        })}
      </div>
    );
  };

  const renderSingleImageView = () => (
    <ImageViewportPane
      toolbar={false}
      data={viewData.items[0] ?? null}
      reference={null}
      settings={paneSettings}
      view={view}
      onViewChange={onPaneViewChange}
      mode="normal"
      diffMode="absolute"
      colorRange={null}
      isDraggable
      onDragStart={(e) => onImageDragStart(e, effectiveMetrics[0]!)}
      onNaturalSize={onImageNaturalSize}
      label={metric.name}
    />
  );

  const renderImageContent = () => isMulti ? renderMultiPaneGrid() : renderSingleImageView();

  const handleScreenshot = () => {
    const panes: CompositePane[] = [];
    const cmap = settings.colormap ?? "none";

    if (isMulti) {
      for (let pi = 0; pi < effectiveMetrics.length; pi++) {
        const m = effectiveMetrics[pi]!;
        const stepMap = perSeriesStepMap[pi] ?? new Map();
        const steps = perSeriesPoints[pi]?.map((p) => p.step) ?? [];
        const { hash } = resolveArtifactAtStep(stepMap, currentStep, steps, settings.missingImageMode);
        const label = seriesLabel(m, runId, multipleRuns, availableRunIds);

        const paneBaseline = perPaneHash(pi);
        if (paneBaseline && hash && paneBaseline !== hash) {
          panes.push({ url: api.artifactUrl(paneBaseline), label: `${label} (REF)`, groupWithNext: true, skipColormap: true });
          panes.push({ url: hash ? api.artifactUrl(hash) : undefined, label });
        } else if (hash) {
          panes.push({ url: api.artifactUrl(hash), label });
        }
      }
    } else {
      if (firstResolved.hash) {
        panes.push({ url: api.artifactUrl(firstResolved.hash), label: metric.name });
      }
    }

    const colorbar = cmap !== "none"
      ? { lut: getColormapLUT(cmap as Exclude<Colormap, "none">), name: cmap, diverging: DIVERGING_COLORMAPS.has(cmap) }
      : undefined;

    exportImagesAsComposite(
      panes,
      safeName(metric.name) + `_step${currentStep}`,
      isMulti ? (settings.imageColumns ?? 2) : 1,
      colorbar,
    );
  };

  // Reset-view: enabled only when zoom/pan actually moved ("tracked").
  const viewModified = settings.zoom !== 1 || settings.pan.x !== 0 || settings.pan.y !== 0;
  const resetImageView = () => updateSettings({ zoom: 1, pan: { x: 0, y: 0 } });

  // -----------------------------------------------------------------------
  // Compare menus: core modes (normal/slide/diff) + the diff-type dropdown
  // (six pointwise diffs + the GPU engine kernels FLIP/HDR-FLIP/SSIM).
  // -----------------------------------------------------------------------
  const modeSelectorEntries = CORE_MODES.map((m) => ({
    value: m as string,
    label: MODE_LABELS[m] ?? m,
    disabled: false,
  }));
  const viewModeEntries = modeSelectorEntries.filter((m) => m.value !== "diff");
  const handleModeSelect = useCallback((value: string) => {
    setMode(value as MediaCompareModeKind);
  }, [setMode]);

  const engineKernelEntries = useMemo(
    () =>
      enumerateCompareModeOptions<string>(
        { nativeModes: [], topologyOk: true },
        {
          engineKernels: engineDiffKernels.map((k) => ({ value: k.id, label: k.label })),
          gpuAvailable,
        },
      )
        .filter((o) => o.kernel && !PIXEL_DIFF_TYPE_VALUES.has(o.value))
        .map((o) => ({
          value: o.value,
          label: o.label,
          disabled: o.disabled,
          title: o.disabled ? "Requires a WebGPU browser" : undefined,
        })),
    [engineDiffKernels, gpuAvailable],
  );
  const ENGINE_KERNEL_VALUES = useMemo(
    () => new Set(engineKernelEntries.map((e) => e.value)),
    [engineKernelEntries],
  );
  const diffTypeEntries: Array<{ value: string; label: string; disabled: boolean; title?: string }> = [
    { value: "signed", label: "Signed Error", disabled: false },
    { value: "absolute", label: "Absolute Error", disabled: false },
    { value: "squared", label: "Squared Error", disabled: false },
    { value: "relative_signed", label: "Relative Signed", disabled: false },
    { value: "relative_absolute", label: "Relative Absolute", disabled: false },
    { value: "relative_squared", label: "Relative Squared", disabled: false },
    ...engineKernelEntries,
  ];
  const selectedDiffTypeValue: string =
    (settings.diffKernel && (ENGINE_KERNEL_VALUES.has(settings.diffKernel) || PIXEL_DIFF_TYPE_VALUES.has(settings.diffKernel))
      ? settings.diffKernel
      : undefined)
    ?? (settings.diffMode === "none" ? "absolute" : settings.diffMode);
  const handleDiffTypeSelect = useCallback((value: string) => {
    if (PIXEL_DIFF_TYPE_VALUES.has(value)) {
      // A pointwise pick sets BOTH the descriptor `diffMode` and `diffKernel`
      // (the engine pane resolves `diffKernel ?? diffSubmode`, so keeping
      // them aligned means the selection survives whichever pane path
      // renders).
      updateSettings({ diffMode: value as ImageSettings["diffMode"], nativeMode: undefined, diffKernel: value });
    } else {
      // An engine kernel (flip/flip_ldr/ssim) drives only `diffKernel`; the
      // descriptor `diffMode` stays a valid pointwise fallback.
      updateSettings({ nativeMode: undefined, diffKernel: value });
    }
  }, [updateSettings]);

  // -----------------------------------------------------------------------
  // Settings panel
  // -----------------------------------------------------------------------
  const settingsPanel = (
    <>
      {hasOverlay && (
        <>
          <SettingsSection title="Overlays" />
          <Toggle
            label="Show overlays"
            checked={ovl.enabled}
            onChange={(v) => updateOverlay({ enabled: v })}
            description="Bounding boxes + segmentation masks (foreground image in split/blend)"
          />
          {ovl.enabled && (
            <>
              <Toggle
                label="Bounding boxes"
                checked={ovl.showBoxes}
                onChange={(v) => updateOverlay({ showBoxes: v })}
              />
              <Toggle
                label="Segmentation masks"
                checked={ovl.showMasks}
                onChange={(v) => updateOverlay({ showMasks: v })}
              />
              <Slider
                label="Score threshold"
                value={ovl.scoreThreshold}
                onChange={(v) => updateOverlay({ scoreThreshold: v })}
                min={0}
                max={1}
                step={0.01}
                format={(v) => v.toFixed(2)}
                description="Hide boxes scoring below this value"
              />
              <Slider
                label="Mask opacity"
                value={ovl.maskOpacity}
                onChange={(v) => updateOverlay({ maskOpacity: v })}
                min={0}
                max={1}
                step={0.01}
                format={(v) => v.toFixed(2)}
              />
              {overlayClasses.length > 0 && (
                <div className="mt-2">
                  <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
                    Classes
                  </label>
                  <div className="flex flex-col gap-1">
                    {overlayClasses.map(([classId, name]) => {
                      const visible = !ovl.hiddenClasses.includes(classId);
                      return (
                        <button
                          key={classId}
                          type="button"
                          onClick={() => toggleOverlayClass(classId)}
                          className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs text-left hover:bg-bg-hover ${visible ? "text-fg" : "text-fg-subtle line-through"}`}
                        >
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: overlayClassColor(classId),
                              opacity: visible ? 1 : 0.3,
                            }}
                          />
                          <span className="mono truncate flex-1">{name}</span>
                          <span className="text-[10px] text-fg-subtle">
                            {visible ? "shown" : "hidden"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
      <SettingsSection title="Image" first={!hasOverlay} />
      <Slider
        label="Brightness"
        value={settings.brightness}
        onChange={(v) => updateSettings({ brightness: v })}
        min={-1}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label="Contrast"
        value={settings.contrast}
        onChange={(v) => updateSettings({ contrast: v })}
        min={-1}
        max={1}
        step={0.01}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label="Gamma"
        value={settings.gamma}
        onChange={(v) => updateSettings({ gamma: v })}
        min={0.1}
        max={3}
        step={0.01}
        format={(v) => v.toFixed(2)}
        description="1 = no change; <1 brightens shadows, >1 darkens"
      />
      <Slider
        label="Exposure"
        value={settings.exposure}
        onChange={(v) => updateSettings({ exposure: v })}
        min={-3}
        max={3}
        step={0.01}
        format={(v) => v.toFixed(2)}
        description="EV stops: 0 = none, +1 = 2× brighter"
      />
      <Slider
        label="Offset"
        value={settings.offset}
        onChange={(v) => updateSettings({ offset: v })}
        min={-0.5}
        max={0.5}
        step={0.001}
        format={(v) => v.toFixed(3)}
        description="Uniform shift added after gamma"
      />
      <Toggle
        label="Flip sign"
        checked={settings.flipSign}
        onChange={(v) => updateSettings({ flipSign: v })}
        description="Invert / negate pixel values"
      />
      <SettingsSection title="Tone map" />
      <Select<"linear" | "srgb" | "gamma" | "reinhard" | "aces">
        label="Operator"
        value={settings.tonemap ?? "srgb"}
        onChange={(v) => updateSettings({ tonemap: v })}
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
        value={settings.peak ?? EXTENDED_TONEMAP_PEAK_DEFAULT}
        onChange={(v) => updateSettings({ peak: v })}
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
          onChange={(v) => updateSettings({ tonemapGamma: v })}
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
        onChange={(v) => updateSettings({ interpolation: v })}
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
        onChange={(v) => updateSettings({ colormap: v })}
        options={[
          { value: "none", label: "None (original)" },
          ...COLORMAP_OPTIONS.map((o) => ({ value: o.id as Colormap, label: o.label })),
        ]}
      />
      {(settings.colormap ?? "none") !== "none" && (
        <ColormapSwatch colormap={settings.colormap as Exclude<Colormap, "none">} />
      )}
      <Select<"nothing" | "last_available">
        label="Missing image"
        value={settings.missingImageMode ?? "last_available"}
        onChange={(v) => updateSettings({ missingImageMode: v })}
        options={[
          { value: "nothing", label: "Show nothing" },
          { value: "last_available", label: "Show last available" },
        ]}
      />
      <Toggle
        label="Pixel axes"
        checked={settings.showAxes ?? false}
        onChange={(v) => updateSettings({ showAxes: v })}
        description="Show pixel coordinate ticks along edges"
      />
      <Select<"decimal" | "int">
        label="Pixel-value notation"
        value={settings.pixelValueNotation ?? "decimal"}
        onChange={(v) => updateSettings({ pixelValueNotation: v })}
        options={[
          { value: "decimal", label: "Decimal (0–1)" },
          { value: "int", label: "Integer (0–255)" },
        ]}
        description="Notation for the TEV pixel-value overlay (the retained floating chip)"
      />
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
      {effectiveMode !== "normal" && (
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
      {renderImageContent()}
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
          label="Image selection"
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
      onDownload={firstResolved.hash ? () => downloadArtifact(api.artifactUrl(firstResolved.hash!), artifactFilename(metric.name, currentStep, downloadMime)) : undefined}
      onScreenshot={handleScreenshot}
      addToComparisonSlot={<AddToComparisonButton cardType={OBJECT_TYPE} series={compSeries} />}
      onResetView={resetImageView}
      viewModified={viewModified}
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
            ref={containerSizeRef}
            className={`relative min-h-0 flex flex-col overflow-hidden${resolveCardHeight(settings, undefined, MIN_HEIGHT) != null ? " flex-1" : ""}${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
            style={{
              height: resolveCardHeight(settings, undefined, MIN_HEIGHT) == null ? gridLayout.autoHeight : undefined,
            }}
            onDragOver={onRefDragOver}
            onDragLeave={onRefDragLeave}
            onDrop={onRefDrop}
          >
          <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {renderImageContent()}
          </div>
          {(settings.colormap ?? "none") !== "none" && (
            <Colorbar colormap={settings.colormap as Exclude<Colormap, "none">} isDiff={effectiveMode === "diff"} />
          )}
          </div>
          </div>

          {isMulti && hasBaseline && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
              {/* Colormap select — ALWAYS visible, leftmost. Drives the SAME
                  persisted `settings.colormap` the settings-panel "False
                  color" picker binds, so the two surfaces stay in sync. */}
              <select
                value={settings.colormap ?? "none"}
                onChange={(e) => updateSettings({ colormap: e.target.value as Colormap })}
                className="h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer text-accent"
                title="Colormap"
              >
                <option value="none">None (original)</option>
                {COLORMAP_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              {/* Combined View/Error menu — ONE dropdown mirroring cairn-
                  plot's own compare-mode menu. "View" optgroup = the non-diff
                  core modes; "Error" optgroup = the diff kernels. Picking an
                  Error entry enters diff mode AND sets that kernel. */}
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
              {effectiveMode === "split" && (
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
        <div className="text-sm text-fg-muted">no image logged yet</div>
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
          label="Image selection"
        />
      )}
      </>
    </CardShell>
  );
}
