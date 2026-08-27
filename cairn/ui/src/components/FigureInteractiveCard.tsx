import { useCallback, useState, useMemo, useRef } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename, exportPlotlyChart, safeName } from "../lib/download";
import { resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
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
  useContainerSize,
  type PlotlyFigureLike,
  type FigureMergeEntry,
} from "@cairn-plot/lib/cairn-plot";
import Figure, { type SharedView } from "@cairn-plot/lib/cairn-plot/renderers/Figure";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import RunSelectionPanel from "./RunSelectionPanel";
import SeriesChipStrip from "./SeriesChipStrip";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import StepSlider from "./StepSlider";

// The card's own minimum height — passed to every resolveCardHeight read so the
// inner figure agrees with CardShell's outer-box clamp (one clamp source).
const FIGURE_MIN_HEIGHT = cardMinSize("figure").minHeight;

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

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;

  if (q.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no figure logged yet</div>;
  }
  if (showPlotly) {
    return (
      <Figure
        figure={sourceQ.data!}
        settings={settings}
        viewOverrides={viewOverrides}
        onRelayout={onRelayout}
        revision={revision}
        enableLiveRelayout
      />
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
  // Falls back to the most recent point at-or-before the step (and, failing
  // that, the first point) instead of an exact-match `.find` — `currentStep`
  // comes from `useStepSlider`'s *global* step union, which in a multi-series
  // card can legitimately include steps this series has no exact point for.
  // Every other per-step card (TableCard, HistogramCard, TensorCard, etc.)
  // already uses this `resolveAtStep(...) ?? points[0]` pattern; matching it
  // here keeps this card from going blank instead of showing the last-good
  // figure.
  const current = useMemo(
    () => resolveAtStep(points, currentStep) ?? points[0],
    [points, currentStep],
  );

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
        // Bug B guard: forcing autorange on a plot whose DOM node is
        // currently 0×0 (e.g. mid step-transition, before layout settles)
        // or whose data collapses to a degenerate axis (single point / all
        // values equal / log axis with non-positive values) makes Plotly's
        // internal scale computation (`h.setScale` → `drawMarginPushers` →
        // `layoutReplot`) throw. `Plotly.relayout` returns a promise, and an
        // unhandled rejection here is exactly the "Uncaught Error:
        // Something went wrong with axis scaling" reported — so (1) skip
        // zero-size plots entirely (autorange can't do anything useful
        // there anyway) and (2) always attach a `.catch` so a bad step logs
        // a handled warning instead of crashing the card.
        const rect = plot.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        Promise.resolve(Plotly.relayout(plot, update)).catch((err) => {
          console.warn("FigureInteractiveCard: reset-view relayout failed", err);
        });
      }
    }
    setPlotRevision((r) => r + 1);
  }, []);

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

  // Measure card width for auto-sizing figure height. cardRef is also the
  // CardShell root (used for scrollIntoView + screenshot export below), so
  // this observes it directly rather than standing up a second observer on
  // a wrapper div — one ResizeObserver per card (see card-kit/index.ts).
  const cardRef = useRef<HTMLDivElement>(null);
  const { size: cardSize } = useContainerSize<HTMLDivElement>(cardRef);
  const cardWidth = cardSize.w;

  // Auto-height for figure containers
  const { figAutoHeight } = useMemo(() => {
    if (resolveCardHeight(settings, undefined, FIGURE_MIN_HEIGHT) != null) return { figAutoHeight: undefined, figRowHeight: undefined };
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
          <Figure
            figure={sourceQ.data!}
            settings={settings}
            viewOverrides={sharedView}
            onRelayout={handlePaneRelayout}
            revision={plotRevision}
            className={`rounded bg-bg ${heightClass}`}
            style={heightStyle}
          />
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
    <Figure
      figure={mergedFigure ?? { data: [], layout: {} }}
      settings={settings}
      viewOverrides={sharedView}
      onRelayout={handlePaneRelayout}
      revision={plotRevision}
    />
  );

  const renderMultiFigure = (inModal: boolean) => (
    <>
      {inModal ? (
        overlayActive ? renderOverlayPlot() : renderPaneGrid(true)
      ) : (
        <div ref={figContainerRef} className="flex-1 min-h-0 overflow-auto" style={{ height: resolveCardHeight(settings, undefined, FIGURE_MIN_HEIGHT) != null ? undefined : figAutoHeight }}>
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
      inModal ? undefined : { height: resolveCardHeight(settings, undefined, FIGURE_MIN_HEIGHT) != null ? undefined : figAutoHeight },
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
      onScreenshot={() => { if (cardRef.current) exportPlotlyChart(cardRef.current, safeName(settings.title ?? metric.name), "png"); }}
      addToComparisonSlot={<AddToComparisonButton cardType="figure" series={compSeries} />}
      onResetView={resetView}
      viewModified={viewModified}
      headerActions={<>
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
