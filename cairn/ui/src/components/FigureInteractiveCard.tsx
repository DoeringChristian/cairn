import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse, formatRelative } from "../lib/format";
import { downloadArtifact, artifactFilename, exportPlotlyChart, safeName } from "../lib/download";
import { useCardSettings, resolveCardHeight, toggleColSpanPatch, type CardSettingsKey } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
  type ComparisonSeriesRef,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SplitPane from "./SplitPane";
import SeriesChip , { type SeriesRef } from "./SeriesChip";
import CardDetailModal from "./CardDetailModal";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import StepSlider, { type XAxisMode } from "./StepSlider";

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
  height1?: number;
  height2?: number;
  colSpan?: number;
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
  xAxis?: "step" | "relative_time" | "wall_time";
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
  siblingRunIds?: string[],
): string {
  if (includeRun && runId) {
    const parts: string[] = [shortRunLabel(runId, siblingRunIds)];
    if (contextHash) parts.push(contextHash.slice(0, 6));
    return parts.join(" \u00B7 ");
  }
  const parts: string[] = [name];
  if (contextHash) parts.push(contextHash.slice(0, 6));
  return parts.join(" \u00B7 ");
}


// ---------------------------------------------------------------------------
// Shared view state synced across comparison panes.
// Captures axis ranges (2D) and camera (3D) from Plotly relayout events.
// ---------------------------------------------------------------------------

type SharedView = Record<string, unknown>;

/** Extract axis ranges + scene camera from a Plotly relayout event object. */
function extractViewState(relayoutData: Record<string, unknown>): SharedView | null {
  const view: SharedView = {};
  let any = false;
  for (const [k, v] of Object.entries(relayoutData)) {
    // 2D axis ranges: xaxis.range[0], yaxis.range[1], xaxis.autorange, etc.
    if (/^[xy]axis\d*\./.test(k)) {
      view[k] = v;
      any = true;
    }
    // 3D scene camera: both dot-path (scene.camera.eye.x) and nested object (scene)
    if (/^scene\d*\.camera/.test(k)) {
      view[k] = v;
      any = true;
    }
    // 3D scene as a nested object (Plotly sometimes sends {scene: {camera: {...}}})
    if (/^scene\d*$/.test(k) && v && typeof v === "object") {
      view[k] = v;
      any = true;
    }
    // Mapbox/geo: mapbox.center, mapbox.zoom, geo.projection, etc.
    if (/^(mapbox|geo)\d*\./.test(k)) {
      view[k] = v;
      any = true;
    }
  }
  return any ? view : null;
}

/** Deep merge b into a (returns new object). */
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const result = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) {
      result[k] = deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/** Merge shared view overrides into a Plotly layout object. */
function applyViewOverrides(
  layout: Record<string, unknown>,
  overrides: SharedView,
): Record<string, unknown> {
  const result = { ...layout };
  for (const [k, v] of Object.entries(overrides)) {
    // If the value is an object and key has no dots (e.g. "scene" with nested camera),
    // deep-merge it into the layout.
    if (!k.includes(".") && !k.includes("[") && v && typeof v === "object" && !Array.isArray(v)) {
      result[k] = deepMerge((result[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>);
      continue;
    }
    // Plotly relayout keys are dot-separated paths like "xaxis.range[0]"
    const bracketMatch = k.match(/^(.+)\[(\d+)]$/);
    if (bracketMatch) {
      const [, path, idx] = bracketMatch;
      const parts = path!.split(".");
      let obj: Record<string, unknown> = result;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;
        if (i === parts.length - 1) {
          if (!Array.isArray(obj[p])) obj[p] = [];
          (obj[p] as unknown[])[Number(idx)] = v;
        } else {
          if (obj[p] == null || typeof obj[p] !== "object") obj[p] = {};
          obj = obj[p] as Record<string, unknown>;
        }
      }
    } else {
      const parts = k.split(".");
      let obj: Record<string, unknown> = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i]!;
        if (obj[p] == null || typeof obj[p] !== "object") obj[p] = {};
        obj = obj[p] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]!] = v;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Single pane: renders one figure at the given global step number.
// ---------------------------------------------------------------------------
function FigurePane({
  runId,
  m,
  targetStep,
  settings,
  viewOverrides,
  onRelayout,
  revision,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
  settings: FigureSettings;
  viewOverrides?: SharedView;
  onRelayout?: (view: SharedView) => void;
  revision?: number;
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
  // Find the point at or closest below the target step.
  const current = useMemo(() => {
    const exact = points.find((p) => p.step === targetStep);
    if (exact) return exact;
    // Fallback: closest step ≤ targetStep
    let best: (typeof points)[number] | undefined;
    for (const p of points) {
      if (p.step <= targetStep) best = p;
      else break;
    }
    return best;
  }, [points, targetStep]);

  const meta = useMemo(
    () => safeJsonParse<FigureMetadata>(current?.artifact_metadata ?? null),
    [current],
  );
  const sourceHash =
    meta?.has_source && meta?.source_format === "plotly_json"
      ? meta.source_hash ?? null
      : null;

  const sourceQ = usePlotlySource(sourceHash);

  const baseLayout = useMemo(() => {
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

  // Apply shared view overrides (synced zoom/pan/camera from other panes).
  const mergedLayout = useMemo(
    () => viewOverrides && Object.keys(viewOverrides).length > 0
      ? applyViewOverrides(baseLayout, viewOverrides)
      : baseLayout,
    [baseLayout, viewOverrides],
  );

  const handleRelayout = useCallback(
    (e: Readonly<Plotly.PlotRelayoutEvent>) => {
      if (!onRelayout) return;
      const view = extractViewState(e as unknown as Record<string, unknown>);
      if (view) onRelayout(view);
    },
    [onRelayout],
  );

  // Attach plotly_relayouting for real-time sync during 3D drag rotation.
  const plotContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onRelayout) return;
    const el = plotContainerRef.current?.querySelector(".js-plotly-plot") as Plotly.PlotlyHTMLElement | null;
    if (!el?.on) return;
    const handler = (e: Plotly.PlotRelayoutEvent) => {
      const view = extractViewState(e as unknown as Record<string, unknown>);
      if (view) onRelayout(view);
    };
    el.on("plotly_relayouting", handler);
    return () => el.removeAllListeners?.("plotly_relayouting");
  });

  const plotlyConfig = useMemo(
    () => ({
      displayModeBar: settings.displayModeBar,
      scrollZoom: settings.scrollZoom,
      responsive: true,
    }),
    [settings.displayModeBar, settings.scrollZoom],
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
      <div ref={plotContainerRef} className="rounded bg-bg h-full">
        <Plot
          data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
          layout={mergedLayout as Partial<Plotly.Layout>}
          config={plotlyConfig}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
          onRelayout={handleRelayout}
          revision={revision}
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

  // Build global steps from all series (union of step numbers).
  const globalSteps = useMemo(() => {
    const stepSet = new Set<number>();
    // Single-metric path
    for (const p of points) if (p.artifact_hash) stepSet.add(p.step);
    // Multi-metric paths
    if (effectiveMetrics.length > 1) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        for (const p of pts) if (p.artifact_hash) stepSet.add(p.step);
      }
    }
    return Array.from(stepSet).sort((a, b) => a - b);
  }, [effectiveMetrics.length, points, multiQueries]);

  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const handleSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, globalSteps.length - 1));
  const currentStep = globalSteps[safeIdx] ?? 0;
  // For the single-metric path, find the point at the current global step.
  const current = useMemo(() => points.find((p) => p.step === currentStep && p.artifact_hash), [points, currentStep]);

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

  // Shared view state for syncing zoom/pan/camera across comparison panes.
  // Also used in single-pane mode to track whether zoom has been modified.
  const [sharedView, setSharedView] = useState<SharedView>({});
  const [plotRevision, setPlotRevision] = useState(0);
  const viewModified = Object.keys(sharedView).length > 0;
  const updatingRef = useRef(false);
  const handlePaneRelayout = useCallback((view: SharedView) => {
    if (updatingRef.current) return;
    updatingRef.current = true;
    setSharedView((prev) => ({ ...prev, ...view }));
    requestAnimationFrame(() => { updatingRef.current = false; });
  }, []);
  const resetView = useCallback(() => {
    setSharedView({});
    // Bump revision to force Plotly to re-apply the base layout (with autorange).
    setPlotRevision((r) => r + 1);
  }, []);

  const mainBaseLayout = useMemo(() => {
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

  // Apply shared view (for home button reset in single-pane mode too).
  const mergedLayout = useMemo(
    () => Object.keys(sharedView).length > 0
      ? applyViewOverrides(mainBaseLayout, sharedView)
      : mainBaseLayout,
    [mainBaseLayout, sharedView],
  );

  const plotlyConfig = useMemo(
    () => ({
      displayModeBar: settings.displayModeBar,
      scrollZoom: settings.scrollZoom,
      responsive: true,
    }),
    [settings.displayModeBar, settings.scrollZoom],
  );

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;
  const allRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of effectiveMetrics) ids.add(m.runId ?? runId);
    return [...ids];
  }, [effectiveMetrics, runId]);

  const multipleRuns = allRunIds.length > 1;

  // Re-render when run metadata cache is populated so labels update.
  useRunMetadataVersion();

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
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
    if (resolveCardHeight(settings, undefined) != null) return { figAutoHeight: undefined, figRowHeight: undefined };
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
  }, [settings.height, settings.height1, settings.height2, settings.colSpan, cardWidth, effectiveMetrics.length, isMulti]);

  return (
    <div
      ref={cardRef}
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        height: settings.collapsed ? undefined : resolveCardHeight(settings, 350),
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
        onToggleFullWidth={() => updateSettings(toggleColSpanPatch(settings, cardRef.current) as Partial<typeof settings>)}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
        onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "image/png")) : undefined}
        onExport={(fmt) => { if (cardRef.current) exportPlotlyChart(cardRef.current, safeName(settings.title ?? metric.name), fmt); }}
      >
        {viewModified && (
          <button
            type="button"
            onClick={resetView}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Reset zoom and pan"
            title="Reset zoom and pan"
          >
            {"\u2302"}
          </button>
        )}
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
          <div ref={figContainerRef} className="flex-1 min-h-0 overflow-auto" style={{ height: resolveCardHeight(settings, undefined) != null ? undefined : figAutoHeight }}>
          <div
            className="grid gap-1 flex-1 min-h-0 overflow-auto"
            style={{
              gridTemplateColumns: `repeat(${Math.min(effectiveMetrics.length, 2)}, 1fr)`,
            }}
          >
            {effectiveMetrics.map((m) => (
              <div key={seriesKey(m)} className="relative overflow-hidden">
                <FigurePane
                  runId={runId}
                  m={m}
                  targetStep={currentStep}
                  settings={settings}
                  viewOverrides={sharedView}
                  onRelayout={handlePaneRelayout}
                  revision={plotRevision}
                />
                {multipleRuns && (
                  <span className="absolute top-1 left-1 z-10 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm">
                    {seriesLabel(m.name, m.context_hash, m.runId ?? runId, true, allRunIds)}
                  </span>
                )}
              </div>
            ))}
          </div>
          </div>
          <StepSlider
            points={points}
            currentIndex={safeIdx}
            onChange={handleSliderChange}
            xAxis={settings.xAxis}
            onXAxisChange={(m) => updateSettings({ xAxis: m })}
            className="mt-3"
          />
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
                    label={seriesLabel(m.name, m.context_hash, m.runId, multipleRuns, allRunIds)}
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
            <div className="rounded flex-1 min-h-0" style={{ height: resolveCardHeight(settings, undefined) != null ? undefined : figAutoHeight }}>
              <Plot
                data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
                layout={mergedLayout as Partial<Plotly.Layout>}
                config={plotlyConfig}
                useResizeHandler
                style={{ width: "100%", height: "100%" }}
                onRelayout={(e) => {
                  const view = extractViewState(e as unknown as Record<string, unknown>);
                  if (view) handlePaneRelayout(view);
                }}
                revision={plotRevision}
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
                style={{ maxHeight: resolveCardHeight(settings, undefined) != null ? undefined : "320px" }}
              />
            </div>
          )}
          <StepSlider
            points={points}
            currentIndex={safeIdx}
            onChange={handleSliderChange}
            xAxis={settings.xAxis}
            onXAxisChange={(m) => updateSettings({ xAxis: m })}
            className="mt-3"
          />
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
                    targetStep={currentStep}
                    settings={settings}
                    viewOverrides={sharedView}
                    onRelayout={handlePaneRelayout}
                    revision={plotRevision}
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
        onPerColHeightChange={(p) => updateSettings(p as Partial<typeof settings>)}
      />
    </div>
  );
}
