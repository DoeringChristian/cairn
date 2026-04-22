import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse, formatRelative } from "../lib/format";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
  type ComparisonSeriesRef,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { shortRunLabel } from "../lib/run-label";
import type { SequenceMeta, SequenceResponse, SequencePoint } from "../api/types";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SplitPane from "./SplitPane";
import SeriesChip , { type SeriesRef } from "./SeriesChip";
import CardDetailModal from "./CardDetailModal";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";

const Plot = createPlotlyComponent(Plotly);

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraContexts?: SequenceMeta[];
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
}

interface FigureMetadata {
  has_source?: boolean;
  source_format?: string | null;
  source_hash?: string | null;
}

interface PlotlyFigure {
  data?: unknown[];
  layout?: Record<string, unknown>;
}

type HoverMode = "closest" | "x unified" | "y unified" | "none";
type DragMode = "zoom" | "pan" | "select" | "lasso" | "none";

const SERIES_COLORS = [
  "#0969da",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

interface FigureSettings {
  version: 1;
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  title?: string;
  collapsed?: boolean;
  sliderStep?: number;
  height?: number;
  colSpan?: number;
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
  viewportSize?: { w: number; h: number };
}

const DEFAULT_FIGURE_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): FigureSettings => ({
  version: 1,
  metrics: [seed],
  displayModeBar: false,
  scrollZoom: true,
  hoverMode: "closest",
  dragMode: "zoom",
  showLegend: true,
});

const HOVER_OPTIONS: Array<{ value: HoverMode; label: string }> = [
  { value: "closest", label: "Closest" },
  { value: "x unified", label: "X unified" },
  { value: "y unified", label: "Y unified" },
  { value: "none", label: "None" },
];

const DRAG_OPTIONS: Array<{ value: DragMode; label: string }> = [
  { value: "zoom", label: "Zoom" },
  { value: "pan", label: "Pan" },
  { value: "select", label: "Select" },
  { value: "lasso", label: "Lasso" },
  { value: "none", label: "None" },
];

const DARK_LAYOUT: Record<string, unknown> = {
  paper_bgcolor: "transparent",
  plot_bgcolor: "transparent",
  font: { color: "#1f2328" },
  autosize: true,
};

function usePlotlySource(sourceHash: string | null | undefined) {
  return useQuery({
    queryKey: ["plotly-source", sourceHash],
    queryFn: async (): Promise<PlotlyFigure> => {
      const res = await fetch(api.artifactUrl(sourceHash as string));
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return (await res.json()) as PlotlyFigure;
    },
    enabled: !!sourceHash,
    staleTime: 60_000,
    retry: false,
  });
}

function seriesKey(m: { runId?: string; name: string; context_hash: string }): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

function seriesLabel(
  name: string,
  contextHash: string,
  runId: string | undefined,
  includeRun: boolean,
): string {
  const parts: string[] = [name];
  if (includeRun && runId) parts.push(shortRunLabel(runId));
  if (contextHash) parts.push(contextHash.slice(0, 6));
  return parts.join(" \u00B7 ");
}

function settingsDifferFromDefaults(s: FigureSettings, d: FigureSettings): boolean {
  return (
    s.displayModeBar !== d.displayModeBar ||
    s.scrollZoom !== d.scrollZoom ||
    s.hoverMode !== d.hoverMode ||
    s.dragMode !== d.dragMode ||
    s.showLegend !== d.showLegend
  );
}

// ---------------------------------------------------------------------------
// Single pane: renders one figure (by metric index) at the shared step index.
// ---------------------------------------------------------------------------
function FigurePane({
  runId,
  m,
  stepIdx,
  settings,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  stepIdx: number;
  settings: FigureSettings;
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name, {
    context: m.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const safeIdx = Math.min(Math.max(0, stepIdx), Math.max(0, points.length - 1));
  const current = points[safeIdx];

  const meta = useMemo(
    () => safeJsonParse<FigureMetadata>(current?.artifact_metadata ?? null),
    [current],
  );
  const sourceHash =
    meta?.has_source && meta?.source_format === "plotly_json"
      ? meta.source_hash ?? null
      : null;

  const sourceQ = usePlotlySource(sourceHash);

  const mergedLayout = useMemo(() => {
    const base = (sourceQ.data?.layout ?? {}) as Record<string, unknown>;
    const layout: Record<string, unknown> = {
      ...base,
      ...DARK_LAYOUT,
      font: { ...((base.font as object) ?? {}), ...(DARK_LAYOUT.font as object) },
      hovermode: settings.hoverMode === "none" ? false : settings.hoverMode,
      dragmode: settings.dragMode === "none" ? false : settings.dragMode,
      showlegend: settings.showLegend,
    };
    // Remove fixed dimensions so Plotly uses container size with autosize
    delete layout.width;
    delete layout.height;
    return layout;
  }, [sourceQ.data, settings.hoverMode, settings.dragMode, settings.showLegend]);

  // Plotly zoom/pan only while Alt is held (consistent with scalar plots).
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

  const plotlyConfig = useMemo(
    () => ({
      displayModeBar: settings.displayModeBar,
      scrollZoom: altDown && settings.scrollZoom,
      responsive: true,
      staticPlot: !altDown && !settings.displayModeBar,
    }),
    [settings.displayModeBar, settings.scrollZoom, altDown],
  );

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;

  if (q.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no figure logged yet</div>;
  }
  if (showPlotly) {
    return (
      <div className="rounded bg-bg h-full">
        <Plot
          data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
          layout={mergedLayout as Partial<Plotly.Layout>}
          config={plotlyConfig}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
        />
      </div>
    );
  }
  if (sourceHash && sourceQ.isLoading) {
    return <div className="h-full min-h-[12rem] motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="flex h-full justify-center items-center rounded bg-bg p-2 overflow-hidden">
      <img
        src={api.artifactUrl(current.artifact_hash)}
        alt={`${m.name} @ step ${current.step}`}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}

export default function FigureInteractiveCard({ runId, metric, extraContexts = [], extraSeries, controlledSeries, settingsKeyOverride, onRemove }: Props) {
  const seedMetric = useMemo(
    () => ({ name: metric.name, context_hash: metric.context_hash }),
    [metric.name, metric.context_hash],
  );

  const extraSeriesKey = useMemo(
    () => (extraSeries ?? []).map((s) => `${s.runId}::${s.name}::${s.context_hash}`).sort().join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify((extraSeries ?? []).map((s) => [s.runId, s.name, s.context_hash]).sort())],
  );

  const defaults = useMemo<FigureSettings>(() => {
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      seedMetric,
      ...(extraContexts ?? []).map((e) => ({
        name: e.name,
        context_hash: e.context_hash,
      })),
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
    return { ...DEFAULT_FIGURE_SETTINGS(seedMetric), metrics: unique };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMetric, extraContexts, extraSeriesKey]);

  const settingsKey = settingsKeyOverride ?? {
    runId,
    metricName: metric.name,
    contextHash: metric.context_hash,
  };
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    defaults,
  );

  const effectiveMetrics = useMemo(() => {
    if (!controlledSeries) return settings.metrics;
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraContexts ?? []).map((e) => ({
        name: e.name,
        context_hash: e.context_hash,
      })),
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
  }, [controlledSeries, settings.metrics, metric.name, metric.context_hash, extraContexts, extraSeriesKey]);

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

  // For the single-metric path, fetch points to drive the step slider.
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // For multi-metric, fetch all sequences to determine max step count.
  const multiQueries = useQueries({
    queries: effectiveMetrics.length > 1
      ? effectiveMetrics.map((m) => {
          const rid = m.runId ?? runId;
          return {
            queryKey: ["sequence", rid, m.name, m.context_hash],
            queryFn: () =>
              api.sequence(rid, m.name, {
                context: m.context_hash || undefined,
                maxPoints: 200,
              }),
            refetchInterval: 2_000,
            staleTime: 2_000,
          };
        })
      : [],
  });

  const maxStepCount = useMemo(() => {
    if (effectiveMetrics.length <= 1) return points.length;
    let max = 0;
    for (const mq of multiQueries) {
      const pts = (mq.data as SequenceResponse | undefined)?.points?.filter(
        (p: SequencePoint) => p.artifact_hash,
      );
      if (pts && pts.length > max) max = pts.length;
    }
    return max;
  }, [effectiveMetrics.length, points.length, multiQueries]);

  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const handleSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, maxStepCount - 1));
  const current = points[safeIdx];

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
        type: "figure",
        series: [{ runId, name: metric.name, context_hash: metric.context_hash }],
      });
      refreshComparisons();
      if (addCompTimer.current != null) window.clearTimeout(addCompTimer.current);
      setAddCompConfirm(`Added to ${compName}`);
      addCompTimer.current = window.setTimeout(() => {
        setAddCompConfirm(null);
        setAddCompOpen(false);
      }, 1500);
    },
    [projectId, runId, metric.name, metric.context_hash, refreshComparisons],
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
      if (addCompTimer.current != null) window.clearTimeout(addCompTimer.current);
    };
  }, []);

  // Single-metric path: Plotly source for the current figure.
  const meta = useMemo(
    () => safeJsonParse<FigureMetadata>(current?.artifact_metadata ?? null),
    [current],
  );
  const sourceHash =
    meta?.has_source && meta?.source_format === "plotly_json"
      ? meta.source_hash ?? null
      : null;

  const sourceQ = usePlotlySource(sourceHash);

  const mergedLayout = useMemo(() => {
    const base = (sourceQ.data?.layout ?? {}) as Record<string, unknown>;
    const layout: Record<string, unknown> = {
      ...base,
      ...DARK_LAYOUT,
      font: { ...((base.font as object) ?? {}), ...(DARK_LAYOUT.font as object) },
      hovermode: settings.hoverMode === "none" ? false : settings.hoverMode,
      dragmode: settings.dragMode === "none" ? false : settings.dragMode,
      showlegend: settings.showLegend,
    };
    // Remove fixed dimensions so Plotly uses container size with autosize
    delete layout.width;
    delete layout.height;
    return layout;
  }, [sourceQ.data, settings.hoverMode, settings.dragMode, settings.showLegend]);

  // Plotly zoom/pan only while Alt is held (consistent with scalar plots).
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

  const plotlyConfig = useMemo(
    () => ({
      displayModeBar: settings.displayModeBar,
      scrollZoom: altDown && settings.scrollZoom,
      responsive: true,
      staticPlot: !altDown && !settings.displayModeBar,
    }),
    [settings.displayModeBar, settings.scrollZoom, altDown],
  );

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;
  const isDirty = settingsDifferFromDefaults(settings, defaults);

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of effectiveMetrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [effectiveMetrics, runId]);

  const subtitle =
    maxStepCount > 0
      ? `step ${current?.step ?? safeIdx} of ${maxStepCount}`
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const figContainerRef = useRef<HTMLDivElement | null>(null);

  // Measure card width for auto-sizing figure height
  const [cardWidth, setCardWidth] = useState(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setCardWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setCardWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Auto-height for figure containers
  const { figAutoHeight, figRowHeight } = useMemo(() => {
    if (settings.height) return { figAutoHeight: undefined, figRowHeight: undefined };
    if (cardWidth <= 0) return { figAutoHeight: "320px", figRowHeight: undefined };
    if (!isMulti) {
      const h = Math.max(200, Math.min(500, Math.round(cardWidth * 0.75)));
      return { figAutoHeight: `${h}px`, figRowHeight: undefined };
    }
    const n = effectiveMetrics.length;
    const minPaneW = 200;
    const cols = Math.min(n, Math.max(1, Math.floor(cardWidth / minPaneW)));
    const rows = Math.ceil(n / cols);
    const paneW = cardWidth / cols;
    // 4:3 landscape ratio per row
    const rowH = Math.max(150, Math.min(400, Math.round(paneW * 0.75)));
    const total = Math.min(800, rows * rowH);
    return { figAutoHeight: `${total}px`, figRowHeight: `${rowH}px` };
  }, [settings.height, cardWidth, effectiveMetrics.length, isMulti]);

  return (
    <div
      ref={cardRef}
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        height: settings.collapsed ? undefined : (settings.height ?? 350),
        position: "relative",
        gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined,
      }}
      {...dropProps}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onToggleFullWidth={() => updateSettings({ colSpan: (settings.colSpan ?? 1) > 1 ? 1 : 2 })}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
      >
        <button
          type="button"
          onClick={() => updateSettings({ displayModeBar: !settings.displayModeBar })}
          aria-label={settings.displayModeBar ? "Hide modebar" : "Show modebar"}
          aria-pressed={settings.displayModeBar}
          title={settings.displayModeBar ? "Hide modebar" : "Show modebar"}
          className={`h-5 inline-flex items-center justify-center rounded px-1.5 text-[10px] hover:bg-bg-hover text-fg-muted hover:text-fg${
            settings.displayModeBar ? " text-accent" : ""
          }`}
        >
          bar
        </button>
        {isDirty && (
          <button
            type="button"
            onClick={() => resetSettings()}
            aria-label="Reset settings"
            title="Reset settings"
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
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
      </CardHeader>

      {!settings.collapsed && (<>
      {isMulti ? (
        <>
          <div ref={figContainerRef} className="flex-1 min-h-0 overflow-auto" style={{ height: settings.height ? undefined : figAutoHeight }}>
          <div
            className="grid gap-1 h-full"
            style={{
              gridTemplateColumns: settings.viewportSize
                ? `repeat(auto-fill, ${settings.viewportSize.w}px)`
                : `repeat(auto-fill, minmax(200px, 1fr))`,
              gridAutoRows: settings.viewportSize ? `${settings.viewportSize.h}px` : (figRowHeight ?? "1fr"),
            }}
          >
            {effectiveMetrics.map((m, idx) => (
              <div key={seriesKey(m)} className="relative overflow-hidden" style={settings.viewportSize ? { width: settings.viewportSize.w, height: settings.viewportSize.h } : undefined}>
                <FigurePane
                  runId={runId}
                  m={m}
                  stepIdx={safeIdx}
                  settings={settings}
                />
                {idx === 0 && (
                  <div
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end text-fg-muted hover:text-fg z-10"
                    style={{ touchAction: "none" }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const pEl = e.currentTarget.parentElement!;
                      const startW = settings.viewportSize?.w ?? pEl.getBoundingClientRect().width;
                      const startH = settings.viewportSize?.h ?? pEl.getBoundingClientRect().height;
                      const onMove = (ev: PointerEvent) => {
                        const w = Math.max(80, Math.round(startW + (ev.clientX - startX)));
                        const h = Math.max(80, Math.round(startH + (ev.clientY - startY)));
                        updateSettings({ viewportSize: { w, h } });
                      };
                      const onUp = () => {
                        window.removeEventListener("pointermove", onMove);
                        window.removeEventListener("pointerup", onUp);
                      };
                      window.addEventListener("pointermove", onMove);
                      window.addEventListener("pointerup", onUp);
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none"><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.5"/><line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="1.5"/></svg>
                  </div>
                )}
              </div>
            ))}
          </div>
          </div>
          {maxStepCount > 1 && (
            <input
              type="range"
              min={0}
              max={maxStepCount - 1}
              value={safeIdx}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
          {/* Series chip strip */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {controlledSeries ? (
              /* Tag-level chips in workspace/comparison mode */
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
                              updateSettings({ metrics: next });
                            }
                          : undefined
                      }
                    />
                  );
                });
              })()
            ) : (
              /* Per-run series chips */
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
                    label={seriesLabel(m.name, m.context_hash, m.runId, multipleRuns)}
                    runId={runId}
                    onRemove={
                      effectiveMetrics.length > 1
                        ? () => {
                            const next = effectiveMetrics.filter((_, j) => j !== i);
                            updateSettings({ metrics: next });
                          }
                        : undefined
                    }
                  />
                );
              })
            )}
          </div>
        </>
      ) : q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
        <>
          {showPlotly ? (
            <div className="rounded flex-1 min-h-0" style={{ height: settings.height ? undefined : figAutoHeight }}>
              <Plot
                data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
                layout={mergedLayout as Partial<Plotly.Layout>}
                config={plotlyConfig}
                useResizeHandler
                style={{ width: "100%", height: "100%" }}
              />
            </div>
          ) : sourceHash && sourceQ.isLoading ? (
            <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
          ) : (
            <div className="flex justify-center items-center rounded bg-bg p-2 flex-1 min-h-0">
              <img
                src={api.artifactUrl(current.artifact_hash)}
                alt={`${metric.name} @ step ${current.step}`}
                className="max-w-full max-h-full object-contain"
                style={{ maxHeight: settings.height ? undefined : "320px" }}
              />
            </div>
          )}
          {points.length > 1 && (
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={safeIdx}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no figure logged yet</div>
      )}
      {(() => {
        const settingsPanel = (
          <>
            <Toggle
              label="Show modebar"
              checked={settings.displayModeBar}
              onChange={(v) => updateSettings({ displayModeBar: v })}
              description="Plotly's zoom/pan/camera/save toolbar"
            />
            <Toggle
              label="Scroll to zoom"
              checked={settings.scrollZoom}
              onChange={(v) => updateSettings({ scrollZoom: v })}
            />
            <Select<HoverMode>
              label="Hover mode"
              value={settings.hoverMode}
              onChange={(v) => updateSettings({ hoverMode: v })}
              options={HOVER_OPTIONS}
            />
            <Select<DragMode>
              label="Drag mode"
              value={settings.dragMode}
              onChange={(v) => updateSettings({ dragMode: v })}
              options={DRAG_OPTIONS}
            />
            <Toggle
              label="Show legend"
              checked={settings.showLegend}
              onChange={(v) => updateSettings({ showLegend: v })}
            />
            <button
              type="button"
              onClick={() => resetSettings()}
              className="btn w-full mt-2"
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
            {isMulti ? (
              <SplitPane
                widths={settings.paneWidths ?? Array(effectiveMetrics.length).fill(1 / effectiveMetrics.length)}
                onWidthsChange={(w) => updateSettings({ paneWidths: w })}
              >
                {effectiveMetrics.map((m) => (
                  <FigurePane
                    key={seriesKey(m)}
                    runId={runId}
                    m={m}
                    stepIdx={safeIdx}
                    settings={settings}
                  />
                ))}
              </SplitPane>
            ) : showPlotly ? (
              <div className="rounded bg-bg h-[calc(100vh-12rem)]">
                <Plot
                  data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
                  layout={mergedLayout as Partial<Plotly.Layout>}
                  config={plotlyConfig}
                  useResizeHandler
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            ) : current?.artifact_hash ? (
              <div className="flex h-[calc(100vh-12rem)] justify-center items-center rounded bg-bg p-2 overflow-hidden">
                <img
                  src={api.artifactUrl(current.artifact_hash)}
                  alt={`${metric.name} @ step ${current.step}`}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="text-sm text-fg-muted">no figure logged yet</div>
            )}
          </CardDetailModal>
        );
      })()}

      <SettingsPopover
        open={addCompOpen && projectId != null}
        onClose={() => { setAddCompOpen(false); setAddCompConfirm(null); }}
        anchorRef={addCompBtnRef}
        title="Add to comparison"
      >
        {addCompConfirm ? (
          <p className="text-xs text-accent">{addCompConfirm}</p>
        ) : (
          <>
            {comparisons.length === 0 ? (
              <p className="text-xs text-fg-subtle mb-2">No comparisons yet.</p>
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
                      {c.cards.length} card(s) · {formatRelative(c.createdAt)}
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
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createAndAdd(); } }}
                  placeholder="Name"
                  className="input flex-1 text-xs"
                />
                <button type="button" onClick={createAndAdd} className="btn text-xs px-2">
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
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 1}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
      />
    </div>
  );
}
