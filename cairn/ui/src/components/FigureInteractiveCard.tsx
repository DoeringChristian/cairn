import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename, exportPlotlyChart, safeName } from "../lib/download";
import { resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { useRunMetadataVersion, shortRunLabel } from "../lib/run-label";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import { seriesKey, seriesLabel } from "../lib/series-utils";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid, type BaseCardSettings } from "./card-kit";
import {
  checkFigureMergeable,
  mergeFigures,
  type PlotlyFigureLike,
  type FigureMergeEntry,
} from "../lib/cairn-plot";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import RunSelectionPanel from "./RunSelectionPanel";
import SeriesChipStrip from "./SeriesChipStrip";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import StepSlider from "./StepSlider";

const Plot = createPlotlyComponent(Plotly);

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface FigureMetadata {
  has_source?: boolean;
  source_format?: string | null;
  source_hash?: string | null;
}

// Structural alias: the card-local name for cairn-plot's minimal Plotly
// figure JSON shape (kept so the rest of this file's `PlotlyFigure` usages
// stay unchanged).
type PlotlyFigure = PlotlyFigureLike;

type HoverMode = "closest" | "x unified" | "y unified" | "none";
type DragMode = "zoom" | "pan" | "select" | "lasso" | "none";

/**
 * Multi-run figure display mode:
 * - "panes": one figure per (run, metric) side by side (default, unchanged).
 * - "overlay": every run's figure traces merged into a single plot — only
 *   available when `checkFigureMergeable` passes (see figure-merge.ts).
 */
type FigureCompareMode = "panes" | "overlay";

const FIGURE_COMPARE_OPTIONS: Array<{ value: FigureCompareMode; label: string }> = [
  { value: "panes", label: "Panes (side by side)" },
  { value: "overlay", label: "Overlay (merged)" },
];

interface FigureSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
  xAxis?: "step" | "relative_time" | "wall_time";
  /** Multi-run display mode. Defaults to "panes" — behavior-preserving. */
  figureCompare?: FigureCompareMode;
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
    queryKey: qk.plotlySource(sourceHash),
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
  const current = useMemo(() => resolveAtStep(points, targetStep), [points, targetStep]);

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

export default function FigureInteractiveCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<FigureSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_FIGURE_SETTINGS(seed),
        metrics,
      }),
    });

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

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
            queryKey: qk.sequence(rid, m.name, m.context_hash),
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

  // Points per series feeding the step slider: single-metric primary plus any
  // extra multi-metric series (all pre-filtered to points with an artifact).
  const seriesPoints = useMemo(() => {
    const arr: Array<Array<{ step: number }>> = [points];
    if (effectiveMetrics.length > 1) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        arr.push(pts.filter((p) => p.artifact_hash));
      }
    }
    return arr;
  }, [effectiveMetrics.length, points, multiQueries]);

  const { globalSteps, safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints,
    persistedIdx: settings.sliderStep,
    updateSettings,
  });
  // For the single-metric path, find the point at the current global step.
  const current = useMemo(() => points.find((p) => p.step === currentStep && p.artifact_hash), [points, currentStep]);

  // -------------------------------------------------------------------------
  // Overlay merge (multi-run "overlay" compare mode).
  //
  // For each effective metric, resolve the Plotly source at the *current*
  // step (reusing multiQueries' already-fetched sequence points, which are
  // in the same order as effectiveMetrics) and fetch its plotly-source JSON
  // via the same `qk.plotlySource` query key FigurePane uses, so react-query
  // dedupes the network fetch when panes mode is also mounted.
  // -------------------------------------------------------------------------
  const paneCurrents = useMemo(() => {
    if (effectiveMetrics.length <= 1) return [];
    return effectiveMetrics.map((m, idx) => {
      const rid = m.runId ?? runId;
      const pts = (multiQueries[idx]?.data as SequenceResponse | undefined)?.points ?? [];
      const filtered = pts.filter((p) => p.artifact_hash);
      const paneCurrent = resolveAtStep(filtered, currentStep);
      const paneMeta = safeJsonParse<FigureMetadata>(paneCurrent?.artifact_metadata ?? null);
      const paneSourceHash =
        paneMeta?.has_source && paneMeta?.source_format === "plotly_json"
          ? paneMeta.source_hash ?? null
          : null;
      return { m, runId: rid, sourceHash: paneSourceHash };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveMetrics,
    currentStep,
    runId,
    multiQueries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  const overlaySourceQueries = useQueries({
    queries: paneCurrents.map((p) => ({
      queryKey: qk.plotlySource(p.sourceHash),
      queryFn: async (): Promise<PlotlyFigure> => {
        const res = await fetch(api.artifactUrl(p.sourceHash as string));
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return (await res.json()) as PlotlyFigure;
      },
      enabled: !!p.sourceHash,
      staleTime: 60_000,
      retry: false,
    })),
  });

  // Every pane has a resolved Plotly source and its fetch has settled
  // (success or error) — the point at which mergeability can be evaluated
  // instead of transiently reporting "unavailable" while sources load.
  const overlaySourcesSettled =
    paneCurrents.length > 1 &&
    paneCurrents.every((p) => !!p.sourceHash) &&
    overlaySourceQueries.every((q) => q.isSuccess || q.isError);

  const overlayMergeEntries = useMemo<FigureMergeEntry[]>(() => {
    if (!overlaySourcesSettled) return [];
    const entries: FigureMergeEntry[] = [];
    paneCurrents.forEach((p, idx) => {
      const fig = overlaySourceQueries[idx]?.data;
      if (fig) entries.push({ runId: p.runId, runLabel: shortRunLabel(p.runId, allRunIds), figure: fig });
    });
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overlaySourcesSettled,
    paneCurrents,
    allRunIds,
    overlaySourceQueries.map((q) => q.dataUpdatedAt).join("|"),
  ]);

  const figureMergeCheck = useMemo(() => {
    if (paneCurrents.length < 2) {
      return { mergeable: false, reason: "need at least 2 series" };
    }
    // Distinguish a permanent gap (some run's current-step figure has no
    // interactive plotly_json source — e.g. an artifact-only image) from a
    // transient one (sources are still being fetched), so the settings-panel
    // note doesn't get stuck on "loading…" forever.
    if (!paneCurrents.every((p) => !!p.sourceHash)) {
      return { mergeable: false, reason: "not every run has an interactive Plotly source" };
    }
    if (!overlaySourcesSettled) return { mergeable: false, reason: "loading…" };
    if (overlayMergeEntries.length < 2) {
      return { mergeable: false, reason: "not every run has an interactive Plotly source" };
    }
    return checkFigureMergeable(overlayMergeEntries.map((e) => e.figure));
  }, [paneCurrents, overlaySourcesSettled, overlayMergeEntries]);

  // (effectiveMetrics.length > 1, i.e. `isMulti` below — spelled out here
  // since `isMulti` isn't declared until later in this component.)
  const overlayActive =
    effectiveMetrics.length > 1 &&
    (settings.figureCompare ?? "panes") === "overlay" &&
    figureMergeCheck.mergeable;

  const mergedFigure = useMemo(
    () => (overlayActive ? mergeFigures(overlayMergeEntries) : null),
    [overlayActive, overlayMergeEntries],
  );

  const overlayBaseLayout = useMemo(() => {
    if (!mergedFigure) return null;
    const base = mergedFigure.layout ?? {};
    const layout: Record<string, unknown> = {
      ...base,
      ...DARK_LAYOUT,
      font: { ...((base.font as object) ?? {}), ...(DARK_LAYOUT.font as object) },
      hovermode: settings.hoverMode === "none" ? false : settings.hoverMode,
      dragmode: settings.dragMode === "none" ? false : settings.dragMode,
      showlegend: settings.showLegend,
    };
    delete layout.width;
    delete layout.height;
    return layout;
  }, [mergedFigure, settings.hoverMode, settings.dragMode, settings.showLegend]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );


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
    // Force Plotly to autorange all axes via relayout on every plot in the card.
    const container = cardRef.current;
    if (container) {
      const plots = container.querySelectorAll<Plotly.PlotlyHTMLElement>(".js-plotly-plot");
      const update: Record<string, boolean> = {};
      for (const plot of plots) {
        // Discover all axes on the plot and set autorange for each.
        const layout = (plot as any)?.layout as Record<string, unknown> | undefined;
        if (layout) {
          for (const key of Object.keys(layout)) {
            if (/^[xy]axis\d*$/.test(key)) {
              update[`${key}.autorange`] = true;
            }
          }
        }
      }
      // Fallback: always include at least the default axes.
      if (!update["xaxis.autorange"]) update["xaxis.autorange"] = true;
      if (!update["yaxis.autorange"]) update["yaxis.autorange"] = true;
      for (const plot of plots) {
        Plotly.relayout(plot, update);
      }
    }
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

  // Same shared-view sync applied to the merged overlay figure (see
  // `overlayBaseLayout` above), so zoom/pan and the header "reset view"
  // button behave the same whether the card is showing one pane or the
  // merged overlay plot.
  const overlayViewLayout = useMemo(
    () => overlayBaseLayout && Object.keys(sharedView).length > 0
      ? applyViewOverrides(overlayBaseLayout, sharedView)
      : overlayBaseLayout,
    [overlayBaseLayout, sharedView],
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

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const { runInfoMap } = useRunInfo(allRunIds);

  // Re-render when run metadata cache is populated so labels update.
  const runMetaVersion = useRunMetadataVersion();

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const figContainerRef = useRef<HTMLDivElement | null>(null);

  // Measure card width for auto-sizing figure height
  const [cardWidth, setCardWidth] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
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
  const { figAutoHeight } = useMemo(() => {
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

  const renderSingleFigure = (heightClass: string, heightStyle?: React.CSSProperties) => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no figure logged yet</div>;
    }
    return (
      <>
        {showPlotly ? (
          <div className={`rounded bg-bg ${heightClass}`} style={heightStyle}>
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
          <div className={`flex justify-center items-center rounded bg-bg p-2 ${heightClass}`}>
            <img
              src={api.artifactUrl(current.artifact_hash)}
              alt={`${metric.name} @ step ${current.step}`}
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )}
        <StepSlider
          points={points}
          currentIndex={safeIdx}
          onChange={onSliderChange}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => updateSettings({ xAxis: m })}
          className="mt-3"
        />
      </>
    );
  };

  const paneKeys = useMemo(() => effectiveMetrics.map(seriesKey), [effectiveMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of effectiveMetrics) {
        map.set(seriesKey(m), seriesLabel(m.name, m.context_hash, m.runId ?? runId, true, allRunIds));
      }
    }
    return map;
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);

  const renderPaneGrid = (inModal: boolean) => (
    <MultiPaneGrid
      paneKeys={paneKeys}
      labels={paneLabels}
      inModal={inModal}
      paneWidths={settings.paneWidths}
      onPaneWidthsChange={(w) => updateSettings({ paneWidths: w })}
      renderPane={(key, i) => {
        const m = effectiveMetrics[i]!;
        return (
          <FigurePane
            key={key}
            runId={runId}
            m={m}
            targetStep={currentStep}
            settings={settings}
            viewOverrides={sharedView}
            onRelayout={handlePaneRelayout}
            revision={plotRevision}
          />
        );
      }}
    />
  );

  // Single merged plot for the "overlay" compare mode — every run's traces
  // in one figure, layout from the first run with fixed ranges dropped (see
  // mergeFigures/checkFigureMergeable in lib/cairn-plot).
  const renderOverlayPlot = () => (
    <div className="rounded bg-bg h-full">
      <Plot
        data={(mergedFigure?.data ?? []) as Plotly.Data[]}
        layout={(overlayViewLayout ?? {}) as Partial<Plotly.Layout>}
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
  );

  const renderMultiFigure = (inModal: boolean) => (
    <>
      {inModal ? (
        overlayActive ? renderOverlayPlot() : renderPaneGrid(true)
      ) : (
        <div ref={figContainerRef} className="flex-1 min-h-0 overflow-auto" style={{ height: resolveCardHeight(settings, undefined) != null ? undefined : figAutoHeight }}>
          {overlayActive ? renderOverlayPlot() : renderPaneGrid(false)}
        </div>
      )}
      <StepSlider
        points={points}
        currentIndex={safeIdx}
        onChange={onSliderChange}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateSettings({ xAxis: m })}
        className="mt-3"
      />
      <SeriesChipStrip
        metrics={effectiveMetrics}
        controlledSeries={controlledSeries}
        runId={runId}
        allRunIds={allRunIds}
        onMetricsChange={(next) => updateSettings({ metrics: next })}
        onClick={multipleRuns ? toggle : undefined}
        selectedIds={selectedIds}
      />
    </>
  );

  const renderContent = (inModal: boolean) => {
    if (isMulti) return renderMultiFigure(inModal);
    return renderSingleFigure(
      inModal ? "h-[calc(100vh-12rem)]" : "flex-1 min-h-0",
      inModal ? undefined : { height: resolveCardHeight(settings, undefined) != null ? undefined : figAutoHeight },
    );
  };

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Figure selection"
    />
  );

  const settingsPanel = (
    <>
      {isMulti && (
        <Select<FigureCompareMode>
          label="Compare mode"
          value={settings.figureCompare ?? "panes"}
          onChange={(v) => updateSettings({ figureCompare: v })}
          options={FIGURE_COMPARE_OPTIONS}
          description={
            (settings.figureCompare ?? "panes") === "overlay" && !figureMergeCheck.mergeable
              ? `Overlay unavailable for this figure type${figureMergeCheck.reason ? ` (${figureMergeCheck.reason})` : ""} — showing panes.`
              : "Overlay merges every run's figure into one plot; panes show them side by side."
          }
        />
      )}
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
    <CardShell cardKind="figure"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "image/png")) : undefined}
      onScreenshot={() => { if (cardRef.current) exportPlotlyChart(cardRef.current, safeName(settings.title ?? metric.name), "svg"); }}
      addToComparisonSlot={<AddToComparisonButton cardType="figure" series={compSeries} />}
      headerActions={<>
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
      </>}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={renderContent(true)}
    >
      <>
      {renderContent(false)}
      </>
    </CardShell>
  );
}
