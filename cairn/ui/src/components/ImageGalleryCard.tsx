import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useSequence, useSequences } from "../api/hooks";
import type { SequenceMeta, SequencePoint } from "../api/types";
import { useCardSettings, resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { downloadArtifact, exportImagesAsComposite, safeName, type CompositePane } from "../lib/download";
import {
  type DiffMode,
  type ImageProcessingProps,
  DIVERGING_COLORMAPS,
  getColormapLUT,
  ImagePane,
  Colorbar,
  ColormapSwatch,
  useContainerSize,
} from "../lib/cairn-plot";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import CardDetailModal from "./CardDetailModal";
import AddToComparisonButton from "./AddToComparisonButton";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import { CAIRN_SERIES_MIME } from "./SeriesChip";
import SeriesChipStrip from "./SeriesChipStrip";
const CAIRN_IMAGE_MIME = "application/x-cairn-image";
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
}

type Interpolation = "auto" | "pixelated" | "crisp-edges";
type Colormap = "none" | "viridis" | "red-green" | "red-blue";

interface ImageSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
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
  diffMode: "none" | DiffMode;
  interpolation: Interpolation;
  colormap: Colormap;
  showAxes: boolean;
  sliderStep?: number;
  height?: number;
  height1?: number;
  height2?: number;
  imageColumns?: 1 | 2;
  colSpan?: number;
  missingImageMode?: "nothing" | "last_available";
  xAxis?: "step" | "relative_time" | "wall_time";
  referenceMode?: "global" | "per-run";
  perRunBaselineStep?: number;
  compareMode?: "side-by-side" | "split" | "blend";
  splitPosition?: number;
  blendAlpha?: number;
  splitSynced?: boolean;
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

function resolveArtifact(
  stepMap: Map<number, SequencePoint>,
  targetStep: number,
  sortedSteps: number[],
  mode?: "nothing" | "last_available",
): { hash: string | undefined; fallbackStep: number | null } {
  const exact = stepMap.get(targetStep);
  if (exact?.artifact_hash) return { hash: exact.artifact_hash, fallbackStep: null };
  if (mode === "nothing") return { hash: undefined, fallbackStep: null };
  for (let i = sortedSteps.length - 1; i >= 0; i--) {
    if (sortedSteps[i]! > targetStep) continue;
    const pt = stepMap.get(sortedSteps[i]!);
    if (pt?.artifact_hash) {
      return { hash: pt.artifact_hash, fallbackStep: pt.step };
    }
  }
  return { hash: undefined, fallbackStep: null };
}

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
// OverlayComparePane — self-contained split/blend comparison
// ---------------------------------------------------------------------------

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;

function OverlayComparePane({
  predUrl,
  refUrl,
  label,
  mode,
  splitPos,
  blendAlpha,
  processing,
  zoom: zoomProp,
  pan: panProp,
  onViewportChange,
  interpolation,
  isDraggable,
  onDragStart,
  onSplitPositionChange,
}: {
  predUrl: string;
  refUrl: string;
  label: string;
  mode: "split" | "blend";
  splitPos: number;
  blendAlpha: number;
  processing: ImageProcessingProps;
  zoom: number;
  pan: { x: number; y: number };
  onViewportChange: (patch: { zoom?: number; pan?: { x: number; y: number } }) => void;
  interpolation: Interpolation;
  isDraggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onSplitPositionChange: (pos: number) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);

  const rawId = useId();
  const gammaFilterId = `cairn-gamma-overlay-${rawId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const { brightness, contrast, gamma, exposure, offset, flipSign } = processing;
  const filterStr = useMemo(
    () =>
      [
        `url(#${gammaFilterId})`,
        `brightness(${(1 + brightness) * Math.pow(2, exposure)})`,
        `contrast(${1 + contrast})`,
        ...(flipSign ? ["invert(1)"] : []),
      ].join(" "),
    [gammaFilterId, brightness, contrast, exposure, flipSign],
  );
  const transformStr = `translate(${panProp.x}px, ${panProp.y}px) scale(${zoomProp})`;
  const imgRendering = interpolation === "auto" ? undefined : interpolation;

  const [altDown, setAltDown] = useState(false);
  const altDownRef = useRef(false);
  altDownRef.current = altDown;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt" || e.key === "Control" || e.key === "Meta")
        setAltDown(e.type === "keydown");
    };
    const onBlur = () => setAltDown(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const viewportRef = useRef({ zoom: zoomProp, pan: panProp });
  viewportRef.current = { zoom: zoomProp, pan: panProp };

  const onVpChangeRef = useRef(onViewportChange);
  onVpChangeRef.current = onViewportChange;

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!altDownRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const s = viewportRef.current;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom * factor));
      if (s.zoom === nextZoom) return;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const newPanX = cx - ((cx - s.pan.x) / s.zoom) * nextZoom;
      const newPanY = cy - ((cy - s.pan.y) / s.zoom) * nextZoom;
      onVpChangeRef.current({ zoom: nextZoom, pan: { x: newPanX, y: newPanY } });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!altDownRef.current) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: viewportRef.current.pan.x,
      panY: viewportRef.current.pan.y,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    onVpChangeRef.current({ pan: { x: s.panX + (e.clientX - s.startX), y: s.panY + (e.clientY - s.startY) } });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragStateRef.current = null;
  }, []);

  return (
    <div className="relative flex flex-col h-full">
      <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
        <filter id={gammaFilterId} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude={1} exponent={1 / gamma} offset={offset} />
            <feFuncG type="gamma" amplitude={1} exponent={1 / gamma} offset={offset} />
            <feFuncB type="gamma" amplitude={1} exponent={1 / gamma} offset={offset} />
          </feComponentTransfer>
        </filter>
      </svg>

      <div
        ref={paneRef}
        className="flex-1 min-h-0 min-w-0 flex items-center justify-center overflow-hidden rounded cairn-checkerboard"
        style={{
          padding: "4px",
          cursor: altDown ? "move" : undefined,
          touchAction: altDown ? "none" : undefined,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="relative w-full h-full">
          <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
            <img
              src={predUrl}
              alt="pred"
              className="w-full h-full object-contain block"
              draggable={false}
              style={{
                filter: filterStr,
                imageRendering: imgRendering,
                ...(mode === "blend" ? { opacity: blendAlpha } : {}),
              }}
            />
          </div>
          <div
            className="absolute inset-0 overflow-hidden"
            style={mode === "split" ? { clipPath: `inset(0 ${(1 - splitPos) * 100}% 0 0)` } : undefined}
          >
            <div className="w-full h-full" style={{ transform: transformStr, transformOrigin: "0 0" }}>
              <img
                src={refUrl}
                alt="ref"
                className="w-full h-full object-contain block"
                draggable={false}
                style={{
                  filter: filterStr,
                  imageRendering: imgRendering,
                  ...(mode === "blend" ? { opacity: 1 - blendAlpha } : {}),
                }}
              />
            </div>
          </div>
          {mode === "split" && (
            <div
              className="absolute top-0 bottom-0 z-20 flex items-center"
              style={{ left: `${splitPos * 100}%`, transform: "translateX(-50%)", cursor: "col-resize" }}
              onDoubleClick={() => onSplitPositionChange(0.5)}
              onPointerDown={(ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                const container = ev.currentTarget.parentElement!;
                const rect = container.getBoundingClientRect();
                const onMoveEvt = (me: PointerEvent) => {
                  onSplitPositionChange(Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width)));
                };
                const onUpEvt = () => {
                  window.removeEventListener("pointermove", onMoveEvt);
                  window.removeEventListener("pointerup", onUpEvt);
                };
                window.addEventListener("pointermove", onMoveEvt);
                window.addEventListener("pointerup", onUpEvt);
              }}
            >
              <div className="w-1 h-full bg-accent/80 rounded-full" />
            </div>
          )}
        </div>
      </div>
      <span className="absolute top-1 left-1 z-10 rounded bg-accent/20 px-1 py-0.5 text-[10px] text-accent backdrop-blur-sm">
        REF
      </span>
      <span
        className={`absolute bottom-1 right-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${isDraggable && !altDown ? " cairn-drag-grip" : ""}`}
        draggable={isDraggable && !altDown}
        onDragStart={onDragStart}
        style={{ cursor: isDraggable && !altDown ? "grab" : undefined }}
      >
        <i className="fa-solid fa-grip-vertical text-[8px] opacity-50" />
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageGalleryCard
// ---------------------------------------------------------------------------

export default function ImageGalleryCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove }: Props) {
  useRunMetadataVersion();

  const extraSeriesKey = useMemo(
    () => (extraSeries ?? []).map((s) => `${s.runId}::${s.name}::${s.context_hash}`).sort().join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify((extraSeries ?? []).map((s) => [s.runId, s.name, s.context_hash]).sort())],
  );

  const defaults = useMemo(
    () => {
      const base = defaultImageSettings({
        name: metric.name,
        context_hash: metric.context_hash,
      });
      const all: Array<{ runId?: string; name: string; context_hash: string }> = [
        { name: metric.name, context_hash: metric.context_hash },
        ...(extraSeries ?? []).map((s) => ({
          runId: s.runId,
          name: s.name,
          context_hash: s.context_hash,
        })),
      ];
      const seen = new Set<string>();
      const unique = all.filter((m) => {
        const k = seriesKey(m);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { ...base, metrics: unique };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metric.name, metric.context_hash, extraSeriesKey],
  );

  const settingsKey = useMemo(
    () => settingsKeyOverride ?? {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings] = useCardSettings(
    settingsKey,
    defaults,
  );

  const effectiveMetrics = useMemo(() => {
    if (!controlledSeries) return settings.metrics;
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const seen = new Set<string>();
    return all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSeries, settings.metrics, metric.name, metric.context_hash, extraSeriesKey]);

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

  const { perSeriesPoints, perSeriesStepMap, globalSteps, globalStepPoints } = useMemo(() => {
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
    return { perSeriesPoints: psp, perSeriesStepMap: maps, globalSteps: steps, globalStepPoints: stepPts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.map((q) => q.dataUpdatedAt).join("|")]);

  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const handleSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, globalSteps.length - 1));
  const currentStep = globalSteps[safeIdx] ?? 0;

  const isMulti = effectiveMetrics.length > 1 || settings.externalBaseline != null;

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of effectiveMetrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [effectiveMetrics, runId]);

  const availableRunIds = useMemo(() => {
    const seen = new Set<string>();
    for (const m of effectiveMetrics) seen.add(m.runId ?? runId);
    return Array.from(seen);
  }, [effectiveMetrics, runId]);

  const runQueries = useQueries({
    queries: availableRunIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 5_000,
    })),
  });

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const runInfoMap = useMemo(() => {
    const m = new Map<string, { displayName?: string; projectId?: string }>();
    availableRunIds.forEach((rid, i) => {
      const d = runQueries[i]?.data;
      if (d) m.set(rid, { displayName: d.run.display_name || undefined, projectId: d.run.project_id });
    });
    return m;
  }, [availableRunIds, runQueries]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  const [expanded, setExpanded] = useState(false);

  const compSeries = useMemo(
    () => effectiveMetrics.map((m) => ({
      runId: m.runId ?? runId,
      name: m.name,
      context_hash: m.context_hash,
    })),
    [runId, effectiveMetrics],
  );

  // -----------------------------------------------------------------------
  // Processing props (passed to self-contained ImagePane / OverlayComparePane)
  // -----------------------------------------------------------------------
  const processing: ImageProcessingProps = useMemo(() => ({
    brightness: settings.brightness,
    contrast: settings.contrast,
    gamma: settings.gamma,
    exposure: settings.exposure,
    offset: settings.offset,
    flipSign: settings.flipSign,
  }), [settings.brightness, settings.contrast, settings.gamma, settings.exposure, settings.offset, settings.flipSign]);

  const handleViewportChange = useCallback((patch: { zoom?: number; pan?: { x: number; y: number } }) => {
    updateSettings(patch);
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
        });
      } catch { /* ignore */ }
      return;
    }

    const imageData = e.dataTransfer.getData(CAIRN_IMAGE_MIME);
    if (imageData) {
      e.stopPropagation();
      try {
        const ref = JSON.parse(imageData) as { runId: string; name: string; context_hash: string };
        const updates: Partial<ImageSettings> = {
          externalBaseline: { runId: ref.runId, name: ref.name, context_hash: ref.context_hash },
          baselineIndex: undefined,
          referenceMode: "global",
          diffMode: settingsRef.current.diffMode === "none" ? "absolute" : settingsRef.current.diffMode,
        };
        if ((settingsRef.current.compareMode ?? "side-by-side") === "side-by-side") {
          updates.compareMode = "split";
        }
        updateSettings(updates);
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
    return resolveArtifact(stepMap, currentStep, steps, settings.missingImageMode);
  }, [perSeriesStepMap, perSeriesPoints, currentStep, settings.missingImageMode]);

  const autoHeight = useMemo((): string | undefined => {
    if (resolveCardHeight(settings, undefined) != null) return undefined;
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
  const extBaseRid = extBase?.runId ?? runId;
  const extBaseName = extBase?.name ?? "";
  const extBaseCtx = extBase?.context_hash ?? "";
  const refMode = settings.referenceMode ?? "global";

  const setReferenceMode = useCallback((mode: "global" | "per-run") => {
    const updates: Partial<ImageSettings> = { referenceMode: mode };
    if (mode === "global" && (settingsRef.current.compareMode ?? "side-by-side") === "side-by-side") {
      updates.compareMode = "split";
    }
    updateSettings(updates);
  }, [updateSettings]);

  const extBaseQuery = useSequence(extBaseRid, extBaseName, {
    context: extBaseCtx || undefined,
    maxPoints: 500,
  });
  const extBasePoints = useMemo(() => {
    if (!extBase || !extBaseQuery.data) return [];
    return (extBaseQuery.data.points ?? []).filter((p: SequencePoint) => p.artifact_hash);
  }, [extBase, extBaseQuery.data]);

  const perRunRefQueries = useQueries({
    queries: extBase && refMode === "per-run"
      ? effectiveMetrics.map((m) => ({
          queryKey: qk.refSeries(m.runId ?? runId, extBase.name, extBase.context_hash),
          queryFn: () => api.sequence(m.runId ?? runId, extBase.name, {
            context: extBase.context_hash || undefined,
            maxPoints: 500,
          }),
          refetchInterval: 2000,
        }))
      : [],
  });

  const baselineIdx = settings.baselineIndex;
  const baselineHash = extBase && refMode === "global"
    ? extBasePoints[Math.min(safeIdx, Math.max(0, extBasePoints.length - 1))]?.artifact_hash ?? undefined
    : baselineIdx != null
      ? resolveArtifact(
          perSeriesStepMap[baselineIdx] ?? new Map(),
          currentStep,
          perSeriesPoints[baselineIdx]?.map((p) => p.step) ?? [],
          settings.missingImageMode,
        ).hash
      : undefined;

  const perPaneBaselineHash = useMemo(() => {
    if (refMode !== "per-run" || !extBase) return null;
    return effectiveMetrics.map((_, paneIdx) => {
      const points: SequencePoint[] = (perRunRefQueries[paneIdx]?.data?.points ?? [])
        .filter((p: SequencePoint) => p.artifact_hash);
      if (points.length === 0) return undefined;
      const stepMap = new Map<number, SequencePoint>();
      for (const p of points) stepMap.set(p.step, p);
      const seriesSteps = points.map((p) => p.step);
      return resolveArtifact(stepMap, currentStep, seriesSteps, settings.missingImageMode).hash;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refMode, extBase, effectiveMetrics, perRunRefQueries.map((q) => q.dataUpdatedAt).join("|"), currentStep, settings.missingImageMode]);

  const hasBaseline = baselineIdx != null || extBase != null;

  const cardRef = useRef<HTMLDivElement>(null);

  // -----------------------------------------------------------------------
  // Pane layout resolution
  // -----------------------------------------------------------------------
  type PaneLayout = "plain" | "side-by-side" | "split" | "blend";

  function resolvePaneLayout(
    hasRef: boolean,
    rm: "global" | "per-run",
    cm: "side-by-side" | "split" | "blend",
  ): PaneLayout {
    if (!hasRef) return "plain";
    if (cm === "split") return "split";
    if (cm === "blend") return "blend";
    return rm === "per-run" ? "side-by-side" : "plain";
  }

  // -----------------------------------------------------------------------
  // Per-pane render helpers
  // -----------------------------------------------------------------------
  const renderSideBySidePane = (
    predUrl: string,
    refUrl: string,
    m: { runId?: string; name: string; context_hash: string },
    _paneIdx: number,
    label: string,
  ) => (
    <div className="flex gap-0.5 h-full">
      <div className="relative flex-1 min-w-0 overflow-hidden border border-accent/20 rounded">
        <ImagePane
          imageUrl={refUrl}
          baselineUrl={null}
          isBaseline={true}
          diffMode="none"
          interpolation={(settings.interpolation ?? "auto") as Interpolation}
          colormap={"none"}
          showAxes={false}
          processing={processing}
          zoom={settings.zoom}
          pan={settings.pan}
          onViewportChange={handleViewportChange}
          label="REF"
        />
      </div>
      <div className="relative flex-1 min-w-0 overflow-hidden">
        <ImagePane
          imageUrl={predUrl}
          baselineUrl={refUrl}
          isBaseline={false}
          diffMode={settings.diffMode}
          interpolation={(settings.interpolation ?? "auto") as Interpolation}
          colormap={settings.colormap ?? "none"}
          showAxes={settings.showAxes ?? false}
          processing={processing}
          zoom={settings.zoom}
          pan={settings.pan}
          onViewportChange={handleViewportChange}
          isDraggable
          onDragStart={(e) => onImageDragStart(e, m)}
          onNaturalSize={onImageNaturalSize}
          label={label}
        />
      </div>
    </div>
  );

  const renderOverlayPane = (
    predUrl: string,
    refUrl: string,
    label: string,
    m: { runId?: string; name: string; context_hash: string },
    mode: "split" | "blend",
    splitPos: number,
    blendAlpha: number,
  ) => (
    <OverlayComparePane
      predUrl={predUrl}
      refUrl={refUrl}
      label={label}
      mode={mode}
      splitPos={splitPos}
      blendAlpha={blendAlpha}
      processing={processing}
      zoom={settings.zoom}
      pan={settings.pan}
      onViewportChange={handleViewportChange}
      interpolation={(settings.interpolation ?? "auto") as Interpolation}
      isDraggable
      onDragStart={(e) => onImageDragStart(e, m)}
      onSplitPositionChange={(pos) => updateSettings({ splitPosition: pos })}
    />
  );

  // -----------------------------------------------------------------------
  // Multi-pane grid
  // -----------------------------------------------------------------------
  const renderMultiPaneGrid = () => {
    const compareMode = settings.compareMode ?? "side-by-side";
    const splitPos = settings.splitPosition ?? 0.5;
    const blendAlpha = settings.blendAlpha ?? 0.5;

    return (
      <div
        className="grid gap-1 flex-1 min-h-0 overflow-auto"
        style={{ gridTemplateColumns: `repeat(${settings.imageColumns ?? 2}, 1fr)` }}
      >
        {effectiveMetrics.map((m, paneIdx) => {
          if (refMode === "global" && settings.externalBaseline && m.name === settings.externalBaseline.name && (m.runId ?? runId) === (settings.externalBaseline.runId ?? runId)) return null;
          const stepMap = perSeriesStepMap[paneIdx] ?? new Map();
          const steps = perSeriesPoints[paneIdx]?.map((p) => p.step) ?? [];
          const { hash, fallbackStep } = resolveArtifact(stepMap, currentStep, steps, settings.missingImageMode);
          const label = seriesLabel(m, runId, multipleRuns, availableRunIds)
            + (fallbackStep != null ? ` (step ${fallbackStep})` : "");
          const paneBaseline = refMode === "per-run"
            ? perPaneBaselineHash?.[paneIdx]
            : baselineHash;

          const layout = resolvePaneLayout(
            !!(paneBaseline && hash && paneBaseline !== hash),
            refMode,
            compareMode,
          );

          const imageUrl = hash ? api.artifactUrl(hash) : null;
          const baselineUrl = paneBaseline ? api.artifactUrl(paneBaseline) : null;

          let content: React.ReactNode;
          switch (layout) {
            case "side-by-side":
              content = renderSideBySidePane(imageUrl!, baselineUrl!, m, paneIdx, label);
              break;
            case "split":
            case "blend":
              content = renderOverlayPane(imageUrl!, baselineUrl!, label, m, layout, splitPos, blendAlpha);
              break;
            case "plain":
            default:
              content = (
                <ImagePane
                  imageUrl={imageUrl}
                  baselineUrl={baselineUrl}
                  isBaseline={refMode === "global" && baselineIdx === paneIdx}
                  diffMode={settings.diffMode}
                  interpolation={(settings.interpolation ?? "auto") as Interpolation}
                  colormap={settings.colormap ?? "none"}
                  showAxes={settings.showAxes ?? false}
                  processing={processing}
                  zoom={settings.zoom}
                  pan={settings.pan}
                  onViewportChange={handleViewportChange}
                  isDraggable
                  onDragStart={(e) => onImageDragStart(e, m)}
                  onNaturalSize={onImageNaturalSize}
                  label={label}
                />
              );
              break;
          }

          return (
            <div key={seriesKey(m)} className="relative overflow-hidden">
              {content}
            </div>
          );
        })}
        {compareMode === "side-by-side" && refMode === "global" && settings.externalBaseline && extBasePoints.length > 0 && (() => {
          const refPt = extBasePoints[Math.min(safeIdx, extBasePoints.length - 1)];
          const refHash = refPt?.artifact_hash ?? undefined;
          return (
            <div className="relative overflow-hidden">
              <ImagePane
                imageUrl={refHash ? api.artifactUrl(refHash) : null}
                baselineUrl={null}
                isBaseline={true}
                diffMode="none"
                interpolation={(settings.interpolation ?? "auto") as Interpolation}
                colormap={"none"}
                showAxes={settings.showAxes ?? false}
                processing={processing}
                zoom={settings.zoom}
                pan={settings.pan}
                onViewportChange={handleViewportChange}
                label={`ref: ${settings.externalBaseline!.name}`}
              />
            </div>
          );
        })()}
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
    />
  );

  const renderImageContent = () => isMulti ? renderMultiPaneGrid() : renderSingleImageView();

  return (
    <div
      ref={cardRef}
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        position: "relative",
        height: settings.collapsed ? undefined : resolveCardHeight(settings, undefined),
        gridColumn: `span ${settings.colSpan ?? 3}`,
      }}
      {...dropProps}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        subtitle={subtitle}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onRemove={onRemove}
        onDownload={firstResolved.hash ? () => downloadArtifact(api.artifactUrl(firstResolved.hash!), artifactFilename(metric.name, currentStep, "image/png")) : undefined}
        onScreenshot={() => {
          const panes: CompositePane[] = [];
          const cmap = settings.colormap ?? "none";

          if (isMulti) {
            for (let pi = 0; pi < effectiveMetrics.length; pi++) {
              const m = effectiveMetrics[pi]!;
              const stepMap = perSeriesStepMap[pi] ?? new Map();
              const steps = perSeriesPoints[pi]?.map((p) => p.step) ?? [];
              const { hash } = resolveArtifact(stepMap, currentStep, steps, settings.missingImageMode);
              const label = seriesLabel(m, runId, multipleRuns, availableRunIds);

              const paneBaseline = refMode === "per-run"
                ? perPaneBaselineHash?.[pi]
                : baselineHash;
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
        }}
        addToComparisonSlot={<AddToComparisonButton cardType="image" series={compSeries} />}
      >
        {(settings.zoom !== 1 || settings.pan.x !== 0 || settings.pan.y !== 0) && (
          <button
            type="button"
            onClick={() => updateSettings({ zoom: 1, pan: { x: 0, y: 0 } })}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset zoom and pan"
            title="Reset zoom and pan"
          >
            {"⌂"}
          </button>
        )}
        {hasBaseline && (
          <select
            value={settings.diffMode}
            onChange={(e) => updateSettings({ diffMode: e.target.value as ImageSettings["diffMode"] })}
            className={`h-[22px] rounded border border-border bg-bg-elevated px-1.5 text-[10px] mono cursor-pointer ${settings.diffMode !== "none" ? "text-accent" : "text-fg-muted hover:text-fg"}`}
            title="Diff mode"
          >
            <option value="none">diff: off</option>
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
      </CardHeader>

      {!settings.collapsed && (<>
      {anyLoading && globalSteps.length === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : globalSteps.length > 0 ? (
        <>
          <div
            ref={containerSizeRef}
            className={`relative min-h-0 flex flex-col overflow-hidden${resolveCardHeight(settings, undefined) != null ? " flex-1" : ""}${refDropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
            style={{
              height: resolveCardHeight(settings, undefined) == null ? autoHeight : undefined,
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
            <Colorbar colormap={settings.colormap as Exclude<Colormap, "none">} isDiff={settings.diffMode !== "none" && (settings.baselineIndex != null || settings.externalBaseline != null)} />
          )}
          </div>
          </div>

          {isMulti && hasBaseline && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
              {(["side-by-side", "split", "blend"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => updateSettings({ compareMode: mode })}
                  className={`rounded px-1.5 py-0.5 ${(settings.compareMode ?? "side-by-side") === mode ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-bg-hover hover:text-fg"}`}
                >
                  {mode === "side-by-side" ? (refMode === "global" ? "normal" : "side") : mode}
                </button>
              ))}
              {(settings.compareMode ?? "side-by-side") === "split" && (
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
              {(settings.compareMode ?? "side-by-side") === "blend" && (
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
            onChange={handleSliderChange}
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

      </>)}

      {(() => {
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
            <SettingsSection title="Diff" />
            <Select
              label="Diff mode"
              value={settings.diffMode}
              onChange={(v) => updateSettings({ diffMode: v })}
              options={[
                { value: "none" as const, label: "None" },
                { value: "signed" as const, label: "Signed Error" },
                { value: "absolute" as const, label: "Absolute Error" },
                { value: "squared" as const, label: "Squared Error" },
                { value: "relative_signed" as const, label: "Relative Signed" },
                { value: "relative_absolute" as const, label: "Relative Absolute" },
                { value: "relative_squared" as const, label: "Relative Squared" },
              ]}
            />
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
                    onClick={() => updateSettings({ externalBaseline: undefined, baselineIndex: undefined, diffMode: settings.diffMode === "none" ? "none" : settings.diffMode })}
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
                  });
                }}
              />
            </div>
          </>
        );
        return (
          <CardDetailModal
            open={expanded}
            onClose={() => setExpanded(false)}
            title={settings.title ?? metric.name}
            settingsContent={settingsPanel}
          >
            <div className="h-[calc(100vh-12rem)] flex flex-col">
              {renderImageContent()}
              <StepSlider
                points={globalStepPoints}
                currentIndex={safeIdx}
                onChange={handleSliderChange}
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
          </CardDetailModal>
        );
      })()}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 3}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<typeof settings>)}
      />
    </div>
  );
}
