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
import type { SequenceMeta, SequencePoint } from "../api/types";
import { useCardSettings } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
  type ComparisonSeriesRef,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { formatRelative } from "../lib/format";
import { computeDiff, loadImageData, type DiffMode } from "../lib/image-diff";
import CardDetailModal from "./CardDetailModal";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SeriesChip , { type SeriesRef } from "./SeriesChip";
import SettingsPopover from "./SettingsPopover";
import SplitPane from "./SplitPane";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import Toggle from "./settings/Toggle";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
}

type Interpolation = "auto" | "pixelated" | "crisp-edges";

interface ImageSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  brightness: number;
  contrast: number;
  gamma: number;
  zoom: number;
  pan: { x: number; y: number };
  baselineIndex?: number;
  diffMode: "none" | DiffMode;
  interpolation: Interpolation;
  showAxes: boolean;
  sliderStep?: number;
  height?: number;
  fullWidth?: boolean;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;

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
    zoom: 1,
    pan: { x: 0, y: 0 },
    diffMode: "none",
    interpolation: "auto",
    showAxes: false,
  };
}

function isModified(s: ImageSettings): boolean {
  return (
    s.brightness !== 0 ||
    s.contrast !== 0 ||
    s.gamma !== 1 ||
    s.zoom !== 1 ||
    s.pan.x !== 0 ||
    s.pan.y !== 0 ||
    s.diffMode !== "none" ||
    (s.interpolation ?? "auto") !== "auto" ||
    s.baselineIndex != null ||
    s.title != null ||
    s.height != null
  );
}

// Palette (same as ScalarPlotCard)
const SERIES_COLORS = [
  "#0969da",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(0, 6) : id;
}

function seriesLabel(
  m: { runId?: string; name: string; context_hash: string },
  fallbackRunId: string,
  multiRun: boolean,
): string {
  const parts: string[] = [m.name];
  if (multiRun && (m.runId ?? fallbackRunId))
    parts.push(shortRunId(m.runId ?? fallbackRunId));
  if (m.context_hash) parts.push(m.context_hash.slice(0, 6));
  return parts.join(" \u00b7 ");
}

function seriesKey(m: {
  runId?: string;
  name: string;
  context_hash: string;
}): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

// ---------------------------------------------------------------------------
// PixelAxes — lightweight SVG overlay showing pixel coordinates.
// ---------------------------------------------------------------------------

function PixelAxes({
  naturalWidth,
  naturalHeight,
}: {
  naturalWidth: number;
  naturalHeight: number;
}) {
  // We overlay the axes as absolutely-positioned elements around the image.
  // The tick interval adapts to image size.
  const tickInterval = (dim: number) => {
    if (dim <= 32) return 4;
    if (dim <= 128) return 16;
    if (dim <= 512) return 64;
    if (dim <= 2048) return 256;
    return 512;
  };

  const xInterval = tickInterval(naturalWidth);
  const yInterval = tickInterval(naturalHeight);

  const xTicks: number[] = [];
  for (let x = 0; x <= naturalWidth; x += xInterval) xTicks.push(x);

  const yTicks: number[] = [];
  for (let y = 0; y <= naturalHeight; y += yInterval) yTicks.push(y);

  return (
    <>
      {/* Top axis */}
      <div className="absolute top-0 left-0 right-0 flex justify-between px-0 text-[8px] text-fg-muted leading-none pointer-events-none select-none" style={{ transform: "translateY(-12px)" }}>
        {xTicks.map((x) => (
          <span key={x} className="mono" style={{ position: "absolute", left: `${(x / naturalWidth) * 100}%`, transform: "translateX(-50%)" }}>{x}</span>
        ))}
      </div>
      {/* Left axis */}
      <div className="absolute top-0 left-0 bottom-0 flex flex-col justify-between py-0 text-[8px] text-fg-muted leading-none pointer-events-none select-none" style={{ transform: "translateX(-2px)" }}>
        {yTicks.map((y) => (
          <span key={y} className="mono" style={{ position: "absolute", top: `${(y / naturalHeight) * 100}%`, transform: "translate(-100%, -50%)", paddingRight: "3px" }}>{y}</span>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// ImagePane — renders a single image or canvas diff inside a split pane.
// ---------------------------------------------------------------------------

interface ImagePaneProps {
  metricEntry: { runId?: string; name: string; context_hash: string };
  paneIndex: number;
  artifactHash: string | undefined;
  baselineHash: string | undefined;
  isBaseline: boolean;
  diffMode: ImageSettings["diffMode"];
  interpolation: Interpolation;
  showAxes: boolean;
  transformStr: string;
  filterStr: string;
  onSetBaseline: () => void;
  onNaturalSize?: (w: number, h: number) => void;
  label: string;
}

function ImagePane({
  artifactHash,
  baselineHash,
  isBaseline,
  diffMode,
  interpolation,
  showAxes,
  transformStr,
  filterStr,
  onSetBaseline,
  onNaturalSize,
  label,
}: ImagePaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [diffReady, setDiffReady] = useState(false);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);

  const showDiff =
    !isBaseline &&
    diffMode !== "none" &&
    baselineHash != null &&
    artifactHash != null;


  useEffect(() => {
    if (!showDiff) {
      setDiffReady(false);
      return;
    }
    let cancelled = false;
    setDiffReady(false);

    (async () => {
      const [baseData, otherData] = await Promise.all([
        loadImageData(api.artifactUrl(baselineHash!)),
        loadImageData(api.artifactUrl(artifactHash!)),
      ]);
      if (cancelled) return;
      if (!baseData || !otherData) return;
      const diffData = computeDiff(
        baseData,
        otherData,
        diffMode as DiffMode,
      );
      const canvas = canvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = diffData.width;
      canvas.height = diffData.height;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(diffData, 0, 0);
      setNaturalDims({ w: diffData.width, h: diffData.height });
      onNaturalSize?.(diffData.width, diffData.height);
      setDiffReady(true);
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineHash, artifactHash, diffMode, showDiff, onNaturalSize]);

  return (
    <div className="flex flex-col h-full">
      {/* Pane header */}
      <div className="flex items-center gap-1 px-1 py-0.5 text-[10px] text-fg-muted">
        <button
          type="button"
          onClick={onSetBaseline}
          className={`inline-flex items-center justify-center h-4 w-4 rounded text-xs hover:bg-bg-hover ${
            isBaseline ? "text-accent" : "text-fg-subtle"
          }`}
          title={isBaseline ? "Baseline" : "Set as baseline"}
          aria-label={isBaseline ? "Baseline" : "Set as baseline"}
        >
          {"\u2605"}
        </button>
        <span className="truncate">{label}</span>
      </div>

      {/* Image / diff canvas */}
      <div className="flex-1 flex items-center justify-center overflow-hidden rounded bg-bg" style={{ padding: showAxes && naturalDims ? "16px 4px 4px 28px" : "4px" }}>
        <div className="relative max-h-full max-w-full">
          {!artifactHash ? (
            <span className="text-xs text-fg-muted">no image</span>
          ) : showDiff ? (
            <>
              {!diffReady && (
                <span className="text-xs text-fg-muted motion-safe:animate-pulse">
                  computing diff...
                </span>
              )}
              <canvas
                ref={canvasRef}
                className="max-h-full max-w-full object-contain block"
                style={{ display: diffReady ? "block" : "none", imageRendering: interpolation === "auto" ? undefined : interpolation, transform: transformStr, transformOrigin: "center center" }}
              />
            </>
          ) : (
            <img
              src={api.artifactUrl(artifactHash)}
              alt={label}
              className="max-h-full max-w-full object-contain block"
              draggable={false}
              style={{ filter: filterStr, imageRendering: interpolation === "auto" ? undefined : interpolation, transform: transformStr, transformOrigin: "center center" }}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
                onNaturalSize?.(img.naturalWidth, img.naturalHeight);
              }}
            />
          )}
          {showAxes && naturalDims && (
            <PixelAxes naturalWidth={naturalDims.w} naturalHeight={naturalDims.h} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageGalleryCard
// ---------------------------------------------------------------------------

export default function ImageGalleryCard({ runId, metric, extraSeries, controlledSeries }: Props) {
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
    () => ({
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    }),
    [runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings, resetSettings] = useCardSettings(
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
      queryKey: ["sequence", m.runId ?? runId, m.name, m.context_hash],
      queryFn: () =>
        api.sequence(m.runId ?? runId, m.name, {
          context: m.context_hash || undefined,
          maxPoints: 500,
        }),
      refetchInterval: 2000,
    })),
  });

  // Per-series points that have artifacts.
  const perSeriesPoints = useMemo(
    () =>
      queries.map((q) =>
        (q.data?.points ?? []).filter(
          (p: SequencePoint) => p.artifact_hash,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queries.map((q) => q.dataUpdatedAt).join("|")],
  );

  // Shared step slider
  const maxLen = Math.max(...perSeriesPoints.map((pts) => pts.length), 0);
  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const handleSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, maxLen - 1));

  const isMulti = effectiveMetrics.length > 1;

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of effectiveMetrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [effectiveMetrics, runId]);

  // -----------------------------------------------------------------------
  // Settings refs for non-passive handlers
  // -----------------------------------------------------------------------
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const metricsRef = useRef(effectiveMetrics);
  metricsRef.current = effectiveMetrics;

  const { highlight: dropHighlight, dropProps } = useSeriesDrop({
    metricsRef,
    onMetricsChange: useCallback(
      (next) => updateSettings({ metrics: next }),
      [updateSettings],
    ),
  });

  const [expanded, setExpanded] = useState(false);

  // "Add to comparison" popover state.
  const projectId = useProjectId();
  const { comparisons, refresh: refreshComparisons } =
    useComparisons(projectId ?? "");
  const addCompBtnRef = useRef<HTMLButtonElement | null>(null);
  const [addCompOpen, setAddCompOpen] = useState(false);
  const [addCompConfirm, setAddCompConfirm] = useState<string | null>(null);
  const addCompTimer = useRef<number | null>(null);
  const [newCompName, setNewCompName] = useState("");

  const addToComp = useCallback(
    (comparisonId: string, compName: string) => {
      if (!projectId) return;
      addCardToComparison(projectId, comparisonId, {
        type: "image",
        series: effectiveMetrics.map((m) => ({
          runId: m.runId ?? runId,
          name: m.name,
          context_hash: m.context_hash,
        })),
      });
      refreshComparisons();
      if (addCompTimer.current != null)
        window.clearTimeout(addCompTimer.current);
      setAddCompConfirm(`Added to ${compName}`);
      addCompTimer.current = window.setTimeout(() => {
        setAddCompConfirm(null);
        setAddCompOpen(false);
      }, 1500);
    },
    [projectId, runId, effectiveMetrics, refreshComparisons],
  );

  const createAndAdd = useCallback(() => {
    if (!projectId) return;
    const name = newCompName.trim() || "New comparison";
    const cmp = createComparison(projectId, name);
    addToComp(cmp.id, cmp.name);
    setNewCompName("");
  }, [projectId, newCompName, addToComp]);

  useEffect(() => {
    return () => {
      if (addCompTimer.current != null)
        window.clearTimeout(addCompTimer.current);
    };
  }, []);

  // -----------------------------------------------------------------------
  // SVG gamma filter
  // -----------------------------------------------------------------------
  const rawId = useId();
  const gammaFilterId = `cairn-gamma-${rawId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  const filterStr = [
    `url(#${gammaFilterId})`,
    `brightness(${1 + settings.brightness})`,
    `contrast(${1 + settings.contrast})`,
  ].join(" ");

  const transformStr = `translate(${settings.pan.x}px, ${settings.pan.y}px) scale(${settings.zoom})`;

  // -----------------------------------------------------------------------
  // Single-image zoom/pan (disabled in multi-pane)
  // -----------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Alt key tracking — zoom/pan only while Alt is held (consistent with scalar plots).
  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") setAltDown(e.type === "keydown");
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

  const altDownRef = useRef(altDown);
  altDownRef.current = altDown;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!altDownRef.current) return; // Let page scroll through
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const cur = settingsRef.current.zoom;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur * factor));
      updateSettings({ zoom: nextZoom });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => {
      el.removeEventListener("wheel", handler);
    };
  }, [updateSettings]);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!altDownRef.current) return; // Only pan with Alt held
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: settingsRef.current.pan.x,
        panY: settingsRef.current.pan.y,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const dx = e.clientX - s.startX;
      const dy = e.clientY - s.startY;
      updateSettings({ pan: { x: s.panX + dx, y: s.panY + dy } });
    },
    [updateSettings],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragStateRef.current = null;
    },
    [],
  );

  // -----------------------------------------------------------------------
  // Drop target
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Derived
  // -----------------------------------------------------------------------
  const canPan = altDown;
  const modified = isModified(settings);
  const [singleNaturalDims, setSingleNaturalDims] = useState<{ w: number; h: number } | null>(null);

  // Auto-height: compute from first image's aspect ratio so images fill panes.
  const [imageAspect, setImageAspect] = useState<number | null>(null); // h/w
  const [containerWidth, setContainerWidth] = useState(0);
  const onImageNaturalSize = useCallback((w: number, h: number) => {
    setImageAspect((prev) => prev ?? h / w);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // When no user-set height and we know the aspect, compute ideal height.
  const autoHeight = useMemo(() => {
    if (settings.height != null) return undefined; // user has set a height
    if (!imageAspect || containerWidth <= 0) return "20rem"; // fallback
    const n = effectiveMetrics.length;
    // In grid mode (SplitPane), each pane gets ~containerWidth/n.
    // Account for pane header (~20px) + some padding.
    const paneWidth = containerWidth / Math.min(n, Math.max(1, Math.floor(containerWidth / 200)));
    const imgHeight = paneWidth * imageAspect;
    // Add space for pane header + padding.
    const total = Math.round(Math.min(800, Math.max(120, imgHeight + 28)));
    return `${total}px`;
  }, [settings.height, imageAspect, containerWidth, effectiveMetrics.length]);

  // First series' points for subtitle
  const firstPoints = perSeriesPoints[0] ?? [];
  const firstCurrent = firstPoints[safeIdx];

  const subtitle =
    maxLen > 0
      ? `step ${firstCurrent?.step ?? "\u2014"} of ${maxLen}`
      : `${metric.count} pts`;

  const anyLoading = queries.some((q) => q.isLoading);

  // Baseline hash for diff
  const baselineIdx = settings.baselineIndex;
  const baselineHash =
    baselineIdx != null
      ? perSeriesPoints[baselineIdx]?.[safeIdx]?.artifact_hash ?? undefined
      : undefined;

  return (
    <div
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        position: "relative",
        height: settings.collapsed ? undefined : (settings.height ?? undefined),
        gridColumn: settings.fullWidth ? "1 / -1" : undefined,
      }}
      {...dropProps}
    >
      {/* SVG gamma filter */}
      <svg
        aria-hidden="true"
        style={{ position: "absolute", width: 0, height: 0 }}
      >
        <filter id={gammaFilterId} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
            <feFuncG
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
            <feFuncB
              type="gamma"
              amplitude={1}
              exponent={1 / settings.gamma}
              offset={0}
            />
          </feComponentTransfer>
        </filter>
      </svg>

      <CardHeader
        title={settings.title ?? metric.name}
        subtitle={subtitle}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
      >
        {modified && (
          <button
            type="button"
            onClick={() => resetSettings()}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset image settings"
            title="Reset image settings"
          >
            {"\u21BA"}
          </button>
        )}
        {projectId && (
          <button
            ref={addCompBtnRef}
            type="button"
            onClick={() => setAddCompOpen((v) => !v)}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Add to comparison"
            aria-haspopup="dialog"
            aria-expanded={addCompOpen}
            title="Add to comparison"
          >
            {"\u002B"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
          aria-label="Image settings"
          title="Image settings"
        >
          {"\u2699"}
        </button>
      </CardHeader>

      {!settings.collapsed && (<>
      {anyLoading && maxLen === 0 ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : maxLen > 0 ? (
        <>
          <div
            ref={containerRef}
            className={`min-h-0 flex flex-col overflow-hidden${settings.height != null ? " flex-1" : ""}`}
            style={{
              height: settings.height == null ? autoHeight : undefined,
              cursor: canPan ? "move" : "default",
              touchAction: canPan ? "none" : undefined,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
          {isMulti ? (
            /* ---------- Multi-pane layout ---------- */
            <SplitPane
              widths={
                settings.paneWidths ??
                Array(effectiveMetrics.length).fill(
                  1 / effectiveMetrics.length,
                )
              }
              onWidthsChange={(w) => updateSettings({ paneWidths: w })}
            >
              {effectiveMetrics.map((m, paneIdx) => {
                const pts = perSeriesPoints[paneIdx] ?? [];
                const pCurrent = pts[safeIdx];
                const hash = pCurrent?.artifact_hash ?? undefined;
                return (
                  <ImagePane
                    key={seriesKey(m)}
                    metricEntry={m}
                    paneIndex={paneIdx}
                    artifactHash={hash}
                    baselineHash={baselineHash}
                    isBaseline={baselineIdx === paneIdx}
                    diffMode={settings.diffMode}
                    interpolation={settings.interpolation ?? "auto"}
                    showAxes={settings.showAxes ?? false}
                    transformStr={transformStr}
                    filterStr={filterStr}
                    onNaturalSize={onImageNaturalSize}
                    onSetBaseline={() => {
                      const isUnsetting = settings.baselineIndex === paneIdx;
                      updateSettings({
                        baselineIndex: isUnsetting ? undefined : paneIdx,
                        // Auto-enable diff when setting baseline for the first time.
                        diffMode: isUnsetting
                          ? "none"
                          : settings.diffMode === "none"
                            ? "absolute"
                            : settings.diffMode,
                      });
                    }}
                    label={seriesLabel(m, runId, multipleRuns)}
                  />
                );
              })}
            </SplitPane>
          ) : (
            /* ---------- Single-image layout (original) ---------- */
            <div
              className="flex flex-1 min-h-0 justify-center items-center rounded bg-bg"
              style={{
                overflow: "hidden",
                padding: settings.showAxes && singleNaturalDims ? "16px 4px 4px 28px" : "8px",
              }}
            >
              <div className="relative max-h-full max-w-full">
              {firstCurrent?.artifact_hash ? (
                <img
                  src={api.artifactUrl(firstCurrent.artifact_hash)}
                  alt={`${metric.name} @ step ${firstCurrent.step}`}
                  className="max-h-full max-w-full object-contain block"
                  draggable={false}
                  style={{
                    filter: filterStr,
                    transform: transformStr,
                    transformOrigin: "center center",
                    imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setSingleNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
                    onImageNaturalSize(img.naturalWidth, img.naturalHeight);
                  }}
                />
              ) : (
                <span className="text-sm text-fg-muted">no image</span>
              )}
              {settings.showAxes && singleNaturalDims && (
                <PixelAxes naturalWidth={singleNaturalDims.w} naturalHeight={singleNaturalDims.h} />
              )}
              </div>
            </div>
          )}
          </div>

          {/* Shared step slider */}
          {maxLen > 1 && (
            <input
              type="range"
              min={0}
              max={maxLen - 1}
              value={safeIdx}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no image logged yet</div>
      )}

      {/* Series chip strip */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {controlledSeries ? (
          /* Tag-level draggable chips in workspace/comparison mode */
          (() => {
            const seen = new Set<string>();
            const tags: Array<{ name: string; color: string; firstIdx: number }> = [];
            for (let i = 0; i < effectiveMetrics.length; i++) {
              const m = effectiveMetrics[i]!;
              if (seen.has(m.name)) continue;
              seen.add(m.name);
              tags.push({ name: m.name, color: SERIES_COLORS[tags.length % SERIES_COLORS.length]!, firstIdx: i });
            }
            return tags.map((tag) => {
              const m = effectiveMetrics[tag.firstIdx]!;
              const ref: SeriesRef = { runId: m.runId, name: m.name, context_hash: m.context_hash };
              return (
                <SeriesChip
                  key={tag.name}
                  series={ref}
                  color={tag.color}
                  label={tag.name}
                  runId={runId}
                  onRemove={
                    tags.length > 1
                      ? () => {
                          const next = effectiveMetrics.filter((x) => x.name !== tag.name);
                          updateSettings({ metrics: next, baselineIndex: undefined, paneWidths: undefined });
                        }
                      : undefined
                  }
                />
              );
            });
          })()
        ) : (
          effectiveMetrics.map((m, i) => {
            const ref: SeriesRef = {
              runId: m.runId,
              name: m.name,
              context_hash: m.context_hash,
            };
            return (
              <SeriesChip
                key={seriesKey(m)}
                series={ref}
                color={SERIES_COLORS[i % SERIES_COLORS.length]!}
                label={seriesLabel(m, runId, multipleRuns)}
                runId={runId}
                onRemove={
                  effectiveMetrics.length > 1
                    ? () => {
                        const next = effectiveMetrics.filter(
                          (_, idx2) => idx2 !== i,
                        );
                        let newBaseline = settings.baselineIndex;
                        if (newBaseline != null) {
                          if (newBaseline === i) newBaseline = undefined;
                          else if (newBaseline > i) newBaseline -= 1;
                        }
                        updateSettings({
                          metrics: next,
                          baselineIndex: newBaseline,
                          paneWidths: undefined,
                        });
                      }
                    : undefined
                }
              />
            );
          })
        )}
      </div>

      {/* Add to comparison popover */}
      <SettingsPopover
        open={addCompOpen && projectId != null}
        onClose={() => {
          setAddCompOpen(false);
          setAddCompConfirm(null);
        }}
        anchorRef={addCompBtnRef}
        title="Add to comparison"
      >
        {addCompConfirm ? (
          <p className="text-xs text-accent">{addCompConfirm}</p>
        ) : (
          <>
            {comparisons.length === 0 ? (
              <p className="text-xs text-fg-subtle mb-2">
                No comparisons yet.
              </p>
            ) : (
              <div className="flex flex-col gap-1 mb-2 max-h-48 overflow-y-auto">
                {comparisons.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addToComp(c.id, c.name)}
                    className="text-left text-xs text-fg-muted hover:bg-bg-hover rounded px-2 py-1.5 border border-border-subtle"
                  >
                    <div className="truncate">{c.name}</div>
                    <div className="text-[10px] text-fg-subtle">
                      {c.cards.length} card(s) ·{" "}
                      {formatRelative(c.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-border-subtle pt-2 mt-1">
              <label className="text-[10px] uppercase tracking-wide text-fg-muted block mb-1">
                Create new comparison
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newCompName}
                  onChange={(e) => setNewCompName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      createAndAdd();
                    }
                  }}
                  placeholder="Name"
                  className="input flex-1 text-xs"
                />
                <button
                  type="button"
                  onClick={createAndAdd}
                  className="btn text-xs px-2"
                >
                  Create
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAddCompOpen(false)}
              className="btn w-full mt-2 text-xs"
            >
              Cancel
            </button>
          </>
        )}
      </SettingsPopover>
      </>)}

      {(() => {
        const settingsPanel = (
          <>
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
              label="Zoom"
              value={settings.zoom}
              onChange={(v) => updateSettings({ zoom: v })}
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              format={(v) => `${v.toFixed(2)}x`}
              description="Alt+scroll to zoom; Alt+drag to pan."
            />
            <Select<Interpolation>
              label="Interpolation"
              value={settings.interpolation ?? "auto"}
              onChange={(v) => updateSettings({ interpolation: v })}
              options={[
                { value: "auto", label: "Smooth (bilinear)" },
                { value: "pixelated", label: "Nearest (pixelated)" },
                { value: "crisp-edges", label: "Crisp edges" },
              ]}
            />
            <Toggle
              label="Pixel axes"
              checked={settings.showAxes ?? false}
              onChange={(v) => updateSettings({ showAxes: v })}
              description="Show pixel coordinate ticks along edges"
            />
            {isMulti && (
              <>
                <h4 className="text-xs uppercase tracking-wide text-fg-muted mt-4 mb-2">
                  Diff
                </h4>
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
              </>
            )}
            <button
              type="button"
              className="btn w-full mt-2"
              onClick={() => {
                resetSettings();
                setExpanded(false);
              }}
            >
              Reset to defaults
            </button>
          </>
        );
        return (
          <CardDetailModal
            open={expanded}
            onClose={() => setExpanded(false)}
            title={settings.title ?? metric.name}
            settingsContent={settingsPanel}
          >
            <div
              className="h-[calc(100vh-12rem)] flex flex-col"
              style={{ cursor: canPan ? "move" : "default", touchAction: canPan ? "none" : undefined }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {isMulti ? (
                <SplitPane
                  widths={
                    settings.paneWidths ??
                    Array(effectiveMetrics.length).fill(
                      1 / effectiveMetrics.length,
                    )
                  }
                  onWidthsChange={(w) => updateSettings({ paneWidths: w })}
                >
                  {effectiveMetrics.map((m, paneIdx) => {
                    const pts = perSeriesPoints[paneIdx] ?? [];
                    const pCurrent = pts[safeIdx];
                    const hash = pCurrent?.artifact_hash ?? undefined;
                    return (
                      <ImagePane
                        key={seriesKey(m)}
                        metricEntry={m}
                        paneIndex={paneIdx}
                        artifactHash={hash}
                        baselineHash={baselineHash}
                        isBaseline={baselineIdx === paneIdx}
                        diffMode={settings.diffMode}
                        interpolation={settings.interpolation ?? "auto"}
                        showAxes={settings.showAxes ?? false}
                        transformStr={transformStr}
                        filterStr={filterStr}
                        onNaturalSize={onImageNaturalSize}
                        onSetBaseline={() => {
                          const isUnsetting = settings.baselineIndex === paneIdx;
                          updateSettings({
                            baselineIndex: isUnsetting ? undefined : paneIdx,
                            diffMode: isUnsetting
                              ? "none"
                              : settings.diffMode === "none"
                                ? "absolute"
                                : settings.diffMode,
                          });
                        }}
                        label={seriesLabel(m, runId, multipleRuns)}
                      />
                    );
                  })}
                </SplitPane>
              ) : (
                <div
                  className="flex flex-1 min-h-0 justify-center items-center rounded bg-bg"
                  style={{
                    overflow: "hidden",
                    padding: settings.showAxes && singleNaturalDims ? "16px 4px 4px 28px" : "8px",
                  }}
                >
                  <div className="relative max-h-full max-w-full">
                    {firstCurrent?.artifact_hash ? (
                      <img
                        src={api.artifactUrl(firstCurrent.artifact_hash)}
                        alt={`${metric.name} @ step ${firstCurrent.step}`}
                        className="max-h-full max-w-full object-contain block"
                        draggable={false}
                        style={{
                          filter: filterStr,
                          transform: transformStr,
                          transformOrigin: "center center",
                          imageRendering: settings.interpolation === "auto" ? undefined : settings.interpolation,
                        }}
                      />
                    ) : (
                      <span className="text-sm text-fg-muted">no image</span>
                    )}
                    {settings.showAxes && singleNaturalDims && (
                      <PixelAxes naturalWidth={singleNaturalDims.w} naturalHeight={singleNaturalDims.h} />
                    )}
                  </div>
                </div>
              )}
              {maxLen > 1 && (
                <input
                  type="range"
                  min={0}
                  max={maxLen - 1}
                  value={safeIdx}
                  onChange={(e) => handleSliderChange(Number(e.target.value))}
                  className="mt-3 w-full accent-accent"
                />
              )}
            </div>
          </CardDetailModal>
        );
      })()}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        fullWidth={settings.fullWidth ?? false}
        onFullWidthToggle={() => updateSettings({ fullWidth: !settings.fullWidth })}
      />
    </div>
  );
}
