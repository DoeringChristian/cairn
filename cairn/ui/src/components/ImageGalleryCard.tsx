import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useSequences } from "../api/hooks";
import type { SequenceMeta, SequencePoint } from "../api/types";
import { resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { downloadArtifact, exportImagesAsComposite, safeName, type CompositePane } from "../lib/download";
import { useCardSeries, useStepSlider, useRunInfo, useMediaReference, type BaseCardSettings } from "./card-kit";
import {
  type DiffMode,
  type ImageProcessing,
  type Interpolation,
  type Colormap,
  type ImageOverlayData,
  type ImageOverlaySettings,
  type OverlayMask,
  type MediaCompareModeKind,
  DIVERGING_COLORMAPS,
  DEFAULT_OVERLAY_SETTINGS,
  MEDIA_COMPARE_MODE_KINDS,
  getColormapLUT,
  overlayClassColor,
  resolveArtifactAtStep,
  migrateLegacyMode,
  CompositeMediaPane,
  ImagePane,
  Colorbar,
  ColormapSwatch,
  useContainerSize,
} from "../lib/cairn-plot";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import { CAIRN_SERIES_MIME } from "./SeriesChip";
import SeriesChipStrip from "./SeriesChipStrip";
const CAIRN_IMAGE_MIME = "application/x-cairn-image";
// The card's own minimum height — passed to every resolveCardHeight read so
// the inner content agrees with CardShell's outer-box clamp (one clamp source).
const IMAGE_MIN_HEIGHT = cardMinSize("image").minHeight;
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";
import SettingsSection from "./settings/SettingsSection";
import StepSlider from "./StepSlider";
import { artifactFilename } from "../lib/download";

// ---------------------------------------------------------------------------
// Settings
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

interface ImageSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  brightness: number;
  contrast: number;
  gamma: number;
  exposure: number;
  offset: number;
  flipSign: boolean;
  zoom: number;
  pan: { x: number; y: number };
  baselineIndex?: number;
  externalBaseline?: { runId?: string; name: string; context_hash: string };
  /**
   * The single exclusive media-compare mode (normal|side|split|blend|diff).
   * When unset, `migrateLegacyMode` derives it from the legacy fields below
   * on every read — see media-compare/migrate-legacy-mode.ts. Legacy fields
   * are NEVER deleted on write (rollback safety); once `mode` is present it
   * is authoritative and the legacy combo is ignored.
   */
  mode?: MediaCompareModeKind;
  /** Legacy exclusive-mode axis #1 (kept for rollback + reused as the "diff"
   *  mode's sub-mode selector: signed/absolute/squared/relative*). */
  diffMode: "none" | DiffMode;
  interpolation: Interpolation;
  colormap: Colormap;
  showAxes: boolean;
  sliderStep?: number;
  imageColumns?: 1 | 2;
  missingImageMode?: "nothing" | "last_available";
  xAxis?: "step" | "relative_time" | "wall_time";
  referenceMode?: "global" | "per-run";
  perRunBaselineStep?: number;
  /** Legacy exclusive-mode axis #2 (kept for rollback). */
  compareMode?: "side-by-side" | "split" | "blend";
  splitPosition?: number;
  blendAlpha?: number;
  splitSynced?: boolean;
  overlay?: ImageOverlaySettings;
}

function defaultImageSettings(seed: {
  name: string;
  context_hash: string;
}): ImageSettings {
  return {
    version: 1,
    metrics: [{ name: seed.name, context_hash: seed.context_hash }],
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
  };
}

function seriesLabel(
  m: { runId?: string; name: string; context_hash: string },
  fallbackRunId: string,
  multiRun: boolean,
  siblingRunIds?: string[],
): string {
  if (multiRun) {
    return shortRunLabel(m.runId ?? fallbackRunId, siblingRunIds);
  }
  const parts: string[] = [m.name];
  if (m.context_hash) parts.push(m.context_hash.slice(0, 6));
  return parts.join(" · ");
}

function seriesKey(m: {
  runId?: string;
  name: string;
  context_hash: string;
}): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

/** Parse box/mask overlay annotations out of a point's artifact metadata. */
function parseOverlay(pt: SequencePoint | undefined): ImageOverlayData | null {
  const raw = pt?.artifact_metadata;
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

const MEDIA_COMPARE_MODE_LABELS: Record<MediaCompareModeKind, string> = {
  normal: "normal",
  side: "side",
  split: "split",
  blend: "blend",
  diff: "diff",
};

// ---------------------------------------------------------------------------
// ExternalBaselinePicker
// ---------------------------------------------------------------------------

function ExternalBaselinePicker({
  runId,
  currentMetricName,
  selected,
  onSelect,
  availableRunIds,
}: {
  runId: string;
  currentMetricName: string;
  selected?: string;
  onSelect: (name: string, contextHash: string, selectedRunId: string) => void;
  availableRunIds: string[];
}) {
  const multiRun = availableRunIds.length > 1;
  const [pickedRunId, setPickedRunId] = useState<string>(runId);
  const activeRunId = multiRun ? pickedRunId : runId;

  const { data } = useSequences(activeRunId);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const imageMetrics = useMemo(() => {
    const seqs = data?.sequences ?? [];
    return seqs
      .filter((s) => s.object_type === "image" && s.name !== currentMetricName)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, currentMetricName]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? imageMetrics.filter((m) => m.name.toLowerCase().includes(q)) : imageMetrics;
  }, [imageMetrics, filter]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (dropRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const runLabel = (id: string) => shortRunLabel(id, availableRunIds);

  return (
    <div className="relative mt-1">
      {multiRun && (
        <div className="mb-1">
          <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-0.5">Run</label>
          <select
            value={pickedRunId}
            onChange={(e) => setPickedRunId(e.target.value)}
            className="input w-full text-xs"
          >
            {availableRunIds.map((rid) => (
              <option key={rid} value={rid}>{runLabel(rid)}</option>
            ))}
          </select>
        </div>
      )}
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setOpen((v) => !v); setFilter(""); }}
        className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs text-fg-muted hover:border-accent hover:text-fg"
      >
        <span aria-hidden="true">+</span> Reference tag
      </button>
      {open && (
        <div ref={dropRef} className="absolute left-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-bg-elevated shadow-lg">
          <div className="border-b border-border-subtle p-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter image tags..."
              className="input w-full text-xs"
              autoFocus
            />
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-fg-subtle">No other image tags</div>
            ) : (
              filtered.map((m) => (
                <button
                  key={`${m.name}::${m.context_hash}`}
                  type="button"
                  onClick={() => { onSelect(m.name, m.context_hash, activeRunId); setOpen(false); }}
                  className={`mono block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-bg-hover ${
                    selected === m.name ? "text-accent" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {m.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageGalleryCard
// ---------------------------------------------------------------------------

export default function ImageGalleryCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  useRunMetadataVersion();

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
    makeDefaults: (seed, metrics) => ({
      ...defaultImageSettings(seed),
      metrics,
    }),
  });

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // The unified exclusive mode — `settings.mode` is authoritative once
  // present; otherwise derived from the legacy {diffMode, compareMode,
  // referenceMode} combo (spec-visual-compare.md: settings migration on
  // read, one table-driven utility — see media-compare/migrate-legacy-mode.ts).
  const effectiveMode: MediaCompareModeKind =
    settings.mode ??
    migrateLegacyMode({
      diffMode: settings.diffMode,
      compareMode: settings.compareMode,
      referenceMode: settings.referenceMode,
    });

  const setMode = useCallback((mode: MediaCompareModeKind) => {
    const updates: Partial<ImageSettings> = { mode };
    if (mode === "diff" && settingsRef.current.diffMode === "none") {
      updates.diffMode = "absolute";
    }
    updateSettings(updates);
  }, [updateSettings]);

  // -----------------------------------------------------------------------
  // Multi-series fetch
  // -----------------------------------------------------------------------
  const queries = useQueries({
    queries: effectiveMetrics.map((m) => ({
      queryKey: qk.sequence(m.runId ?? runId, m.name, m.context_hash),
      queryFn: () =>
        api.sequence(m.runId ?? runId, m.name, {
          context: m.context_hash || undefined,
          maxPoints: 500,
        }),
      refetchInterval: 2000,
    })),
  });

  const { perSeriesPoints, perSeriesStepMap, globalStepPoints } = useMemo(() => {
    const psp = queries.map((q) =>
      (q.data?.points ?? []).filter((p: SequencePoint) => p.artifact_hash),
    );
    const maps = psp.map((pts) => {
      const m = new Map<number, SequencePoint>();
      for (const p of pts) m.set(p.step, p);
      return m;
    });
    const stepMap = new Map<number, string | undefined>();
    for (const pts of psp) for (const p of pts) {
      if (!stepMap.has(p.step)) stepMap.set(p.step, p.wall_time ?? undefined);
    }
    const steps = Array.from(stepMap.keys()).sort((a, b) => a - b);
    const stepPts = steps.map((s) => ({ step: s, wall_time: stepMap.get(s) ?? null }));
    return { perSeriesPoints: psp, perSeriesStepMap: maps, globalStepPoints: stepPts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join("|")]);

  // Step-slider machinery is shared; artifact resolution stays specialized
  // (resolveArtifactAtStep honors missingImageMode / per-series step maps).
  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints: perSeriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });

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
  // Processing props (passed to self-contained ImagePane / compositor)
  // -----------------------------------------------------------------------
  const processing: ImageProcessing = useMemo(() => ({
    brightness: settings.brightness,
    contrast: settings.contrast,
    gamma: settings.gamma,
    exposure: settings.exposure,
    offset: settings.offset,
    flipSign: settings.flipSign,
  }), [settings.brightness, settings.contrast, settings.gamma, settings.exposure, settings.offset, settings.flipSign]);

  const handleViewportChange = useCallback((v: { zoom: number; pan: { x: number; y: number } }) => {
    updateSettings(v);
  }, [updateSettings]);

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
  // Drop target for baseline references
  // -----------------------------------------------------------------------
  const [refDropHighlight, setRefDropHighlight] = useState(false);
  const onRefDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(CAIRN_SERIES_MIME) || e.dataTransfer.types.includes(CAIRN_IMAGE_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setRefDropHighlight(true);
    }
  }, []);
  const onRefDragLeave = useCallback(() => setRefDropHighlight(false), []);
  const onRefDrop = useCallback((e: React.DragEvent) => {
    setRefDropHighlight(false);

    // Dropping a reference always lands on "diff" — the exclusive-mode
    // equivalent of the pre-refactor behavior (auto-enable diff coloring on
    // drop; see spec-visual-compare.md's "map combinable states to diff").
    const chipData = e.dataTransfer.getData(CAIRN_SERIES_MIME);
    if (chipData) {
      e.stopPropagation();
      try {
        const ref = JSON.parse(chipData) as { runId: string; name: string; context_hash: string };
        updateSettings({
          externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
          baselineIndex: undefined,
          referenceMode: "per-run",
          diffMode: settingsRef.current.diffMode === "none" ? "absolute" : settingsRef.current.diffMode,
          mode: "diff",
        });
      } catch { /* ignore */ }
      return;
    }

    const imageData = e.dataTransfer.getData(CAIRN_IMAGE_MIME);
    if (imageData) {
      e.stopPropagation();
      try {
        const ref = JSON.parse(imageData) as { runId: string; name: string; context_hash: string };
        updateSettings({
          externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
          baselineIndex: undefined,
          referenceMode: "global",
          diffMode: settingsRef.current.diffMode === "none" ? "absolute" : settingsRef.current.diffMode,
          mode: "diff",
        });
      } catch { /* ignore */ }
      return;
    }
  }, [updateSettings]);

  const onImageDragStart = useCallback((e: React.DragEvent, m: { runId?: string; name: string; context_hash: string }) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(CAIRN_IMAGE_MIME, JSON.stringify({
      runId: m.runId ?? runId,
      name: m.name,
      context_hash: m.context_hash,
    }));
    e.dataTransfer.setData("text/plain", m.name);
  }, [runId]);

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------
  const firstResolved = useMemo(() => {
    const stepMap = perSeriesStepMap[0] ?? new Map();
    const steps = perSeriesPoints[0]?.map((p) => p.step) ?? [];
    return resolveArtifactAtStep(stepMap, currentStep, steps, settings.missingImageMode);
  }, [perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode]);

  // -----------------------------------------------------------------------
  // Overlays (bounding boxes + segmentation masks)
  // -----------------------------------------------------------------------
  const ovl: ImageOverlaySettings = useMemo(
    () => ({ ...DEFAULT_OVERLAY_SETTINGS, ...(settings.overlay ?? {}) }),
    [settings.overlay],
  );

  // Overlay data for the foreground image currently shown in each pane.
  const paneOverlays = useMemo(() => {
    return effectiveMetrics.map((_, i) => {
      const stepMap = perSeriesStepMap[i] ?? new Map();
      const steps = perSeriesPoints[i]?.map((p) => p.step) ?? [];
      const { hash, fallbackStep } = resolveArtifactAtStep(stepMap, currentStep, steps, settings.missingImageMode);
      if (!hash) return null;
      const step = fallbackStep ?? currentStep;
      return parseOverlay(stepMap.get(step));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMetrics, perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode]);

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

  const autoHeight = useMemo((): string | undefined => {
    if (resolveCardHeight(settings, undefined, IMAGE_MIN_HEIGHT) != null) return undefined;
    if (!imageAspect || containerWidth <= 0) return "20rem";
    const n = effectiveMetrics.length;
    const cols = Math.min(n, Math.max(1, Math.floor(containerWidth / 200)));
    const rows = Math.ceil(n / cols);
    const paneWidth = containerWidth / cols;
    const rowHeight = paneWidth * imageAspect + 24;
    const clampedRow = Math.max(120, Math.min(500, rowHeight));
    return `${Math.round(rows * clampedRow)}px`;
  }, [settings.height, settings.height1, settings.height2, settings.colSpan, imageAspect, containerWidth, effectiveMetrics.length]);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  const anyLoading = queries.some((q) => q.isLoading);

  // External baseline
  const extBase = settings.externalBaseline;
  const refMode = settings.referenceMode ?? "global";

  const setReferenceMode = useCallback((mode: "global" | "per-run") => {
    updateSettings({ referenceMode: mode });
  }, [updateSettings]);

  // Reference resolution — the one hook/function family (see
  // card-kit/use-media-reference.ts + lib/cairn-plot/media-compare/reference.ts).
  const { globalHash: baselineHash, perPaneHash } = useMediaReference({
    runId,
    perSeriesStepMap,
    perSeriesPoints,
    seriesBaselineIndex: settings.baselineIndex,
    external: extBase,
    externalScope: refMode,
    panes: effectiveMetrics,
    currentStep,
    safeIdx,
    missingImageMode: settings.missingImageMode,
  });
  // `baselineHash` is exposed by the hook (the "global" resolution) for
  // parity with the pre-refactor API; per-pane rendering below always goes
  // through `perPaneHash`, which already encodes the global/per-run
  // dispatch, so this alias only documents the shape — silence unused-var.
  void baselineHash;

  const baselineIdx = settings.baselineIndex;
  const hasBaseline = baselineIdx != null || extBase != null;

  const cardRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Multi-pane grid
  // -----------------------------------------------------------------------
  const renderMultiPaneGrid = () => {
    const splitPos = settings.splitPosition ?? 0.5;
    const blendAlpha = settings.blendAlpha ?? 0.5;
    const diffSubmode: DiffMode = settings.diffMode === "none" ? "absolute" : settings.diffMode;
    const isOverlayMode = effectiveMode === "split" || effectiveMode === "blend";

    return (
      <div
        className="grid gap-1 flex-1 min-h-0 overflow-auto"
        style={{ gridTemplateColumns: `repeat(${settings.imageColumns ?? 2}, 1fr)` }}
      >
        {effectiveMetrics.map((m, paneIdx) => {
          if (refMode === "global" && settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
          const stepMap = perSeriesStepMap[paneIdx] ?? new Map();
          const steps = perSeriesPoints[paneIdx]?.map((p) => p.step) ?? [];
          const { hash, fallbackStep } = resolveArtifactAtStep(stepMap, currentStep, steps, settings.missingImageMode);
          const label = seriesLabel(m, runId, multipleRuns, availableRunIds)
            + (fallbackStep != null ? ` (step ${fallbackStep})` : "");
          const paneBaseline = perPaneHash(paneIdx);

          // Split/blend are explicit user choices — honor them whenever a
          // reference resolves, even when the content-addressed store deduped
          // a byte-identical prediction and reference to the same artifact
          // hash (e.g. an undistorted baseline run). Otherwise the pane
          // silently falls back to "normal" and the split handle / blend
          // slider have no visible effect. Other modes keep the inequality
          // so their fallback behavior is unchanged.
          const hasRef = !!(paneBaseline && hash && (isOverlayMode || paneBaseline !== hash));
          const imageUrl = hash ? api.artifactUrl(hash) : null;
          const baselineUrl = hasRef ? api.artifactUrl(paneBaseline!) : null;
          const paneOverlay = paneOverlays[paneIdx] ?? null;

          return (
            <div key={seriesKey(m)} className="relative overflow-hidden">
              <CompositeMediaPane
                mode={effectiveMode}
                imageUrl={imageUrl}
                baselineUrl={baselineUrl}
                isReferencePane={refMode === "global" && baselineIdx === paneIdx}
                diffSubmode={diffSubmode}
                colormap={settings.colormap ?? "none"}
                interpolation={(settings.interpolation ?? "auto") as Interpolation}
                showAxes={settings.showAxes ?? false}
                processing={processing}
                zoom={settings.zoom}
                pan={settings.pan}
                onViewportChange={handleViewportChange}
                splitPosition={splitPos}
                blendAlpha={blendAlpha}
                onSplitPositionChange={(pos) => updateSettings({ splitPosition: pos })}
                label={label}
                isDraggable
                onDragStart={(e) => onImageDragStart(e, m)}
                onNaturalSize={onImageNaturalSize}
                overlay={paneOverlay ?? undefined}
                overlaySettings={ovl}
              />
            </div>
          );
        })}
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Single-image view (uses ImagePane from library)
  // -----------------------------------------------------------------------
  const renderSingleImageView = () => (
    <ImagePane
      imageUrl={firstResolved.hash ? api.artifactUrl(firstResolved.hash) : null}
      baselineUrl={null}
      diffMode="none"
      interpolation={(settings.interpolation ?? "auto") as Interpolation}
      colormap={settings.colormap ?? "none"}
      showAxes={settings.showAxes ?? false}
      processing={processing}
      zoom={settings.zoom}
      pan={settings.pan}
      onViewportChange={handleViewportChange}
      isDraggable
      onDragStart={(e) => onImageDragStart(e, effectiveMetrics[0]!)}
      onNaturalSize={onImageNaturalSize}
      label={metric.name}
      overlay={paneOverlays[0] ?? undefined}
      overlaySettings={ovl}
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

  const imageViewModified = settings.zoom !== 1 || settings.pan.x !== 0 || settings.pan.y !== 0;
  const resetImageView = () => updateSettings({ zoom: 1, pan: { x: 0, y: 0 } });

  const headerActions = (
    <>
      {hasBaseline && (
        <select
          value={effectiveMode}
          onChange={(e) => setMode(e.target.value as MediaCompareModeKind)}
          className={`h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer ${effectiveMode !== "normal" ? "text-accent" : "text-fg-muted hover:text-fg"}`}
          title="Compare mode"
        >
          {MEDIA_COMPARE_MODE_KINDS.map((m) => (
            <option key={m} value={m}>{MEDIA_COMPARE_MODE_LABELS[m]}</option>
          ))}
        </select>
      )}
      {hasBaseline && effectiveMode === "diff" && (
        <select
          value={settings.diffMode === "none" ? "absolute" : settings.diffMode}
          onChange={(e) => updateSettings({ diffMode: e.target.value as ImageSettings["diffMode"] })}
          className="h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer text-accent"
          title="Diff sub-mode"
        >
          <option value="absolute">absolute</option>
          <option value="signed">signed</option>
          <option value="squared">squared</option>
          <option value="relative_absolute">rel. absolute</option>
          <option value="relative_signed">rel. signed</option>
          <option value="relative_squared">rel. squared</option>
        </select>
      )}
      <select
        value={settings.colormap ?? "none"}
        onChange={(e) => updateSettings({ colormap: e.target.value as Colormap })}
        className={`h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer ${(settings.colormap ?? "none") !== "none" ? "text-accent" : "text-fg-muted hover:text-fg"}`}
        title="False color map"
      >
        <option value="none">color: off</option>
        <option value="viridis">viridis</option>
        <option value="red-green">red-green</option>
        <option value="red-blue">red-blue</option>
      </select>
    </>
  );

  const settingsPanel = (
    <>
      <SettingsSection title="Image" first />
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
      <SettingsSection title="Compare" />
      <Select<MediaCompareModeKind>
        label="Mode"
        value={effectiveMode}
        onChange={(v) => setMode(v)}
        options={MEDIA_COMPARE_MODE_KINDS.map((m) => ({ value: m, label: MEDIA_COMPARE_MODE_LABELS[m] }))}
      />
      {effectiveMode === "diff" && (
        <Select
          label="Diff sub-mode"
          value={settings.diffMode === "none" ? "absolute" : settings.diffMode}
          onChange={(v) => updateSettings({ diffMode: v })}
          options={[
            { value: "signed" as const, label: "Signed Error" },
            { value: "absolute" as const, label: "Absolute Error" },
            { value: "squared" as const, label: "Squared Error" },
            { value: "relative_signed" as const, label: "Relative Signed" },
            { value: "relative_absolute" as const, label: "Relative Absolute" },
            { value: "relative_squared" as const, label: "Relative Squared" },
          ]}
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
      <div className="mt-2">
        <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
          Reference source
        </label>
        {settings.externalBaseline ? (
          <div className="flex items-center gap-1 rounded border border-accent/40 bg-accent/5 px-2 py-1 text-xs text-fg-muted">
            <span className="mono truncate flex-1">{settings.externalBaseline.name}{settings.externalBaseline.runId && settings.externalBaseline.runId !== runId ? ` · ${shortRunLabel(settings.externalBaseline.runId)}` : ""}</span>
            <button
              type="button"
              onClick={() => updateSettings({ externalBaseline: undefined, baselineIndex: undefined })}
              className="text-fg-subtle hover:text-fg shrink-0"
              title="Remove external reference"
            >{"×"}</button>
          </div>
        ) : (
          <p className="text-[10px] text-fg-subtle mb-1">
            Drag a series chip onto the card, or select a tag below.
          </p>
        )}
        <ExternalBaselinePicker
          runId={runId}
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
    <CardShell cardKind="image"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={firstResolved.hash ? () => downloadArtifact(api.artifactUrl(firstResolved.hash!), artifactFilename(metric.name, currentStep, "image/png")) : undefined}
      onScreenshot={handleScreenshot}
      addToComparisonSlot={<AddToComparisonButton cardType="image" series={compSeries} />}
      onResetView={resetImageView}
      viewModified={imageViewModified}
      headerActions={headerActions}
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
            className={`relative min-h-0 flex flex-col overflow-hidden${resolveCardHeight(settings, undefined, IMAGE_MIN_HEIGHT) != null ? " flex-1" : ""}${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
            style={{
              height: resolveCardHeight(settings, undefined, IMAGE_MIN_HEIGHT) == null ? autoHeight : undefined,
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
              {MEDIA_COMPARE_MODE_KINDS.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMode(mode)}
                  className={`rounded px-1.5 py-0.5 ${effectiveMode === mode ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg-hover hover:text-fg"}`}
                >
                  {MEDIA_COMPARE_MODE_LABELS[mode]}
                </button>
              ))}
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
              {effectiveMode === "blend" && (
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={settings.blendAlpha ?? 0.5}
                  onChange={(e) => updateSettings({ blendAlpha: Number(e.target.value) })}
                  className="w-24 accent-accent"
                  title="Blend alpha"
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
