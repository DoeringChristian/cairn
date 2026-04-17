import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse, formatRelative } from "../lib/format";
import { useCardSettings } from "../lib/card-settings";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import type { SequenceMeta, SequenceResponse, SequencePoint } from "../api/types";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SplitPane from "./SplitPane";
import SeriesChip, { CAIRN_SERIES_MIME, type SeriesRef } from "./SeriesChip";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";

const Plot = createPlotlyComponent(Plotly);

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraContexts?: SequenceMeta[];
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
  "#539bf5",
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
  height?: number;
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
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
  paper_bgcolor: "#13171c",
  plot_bgcolor: "#0b0d10",
  font: { color: "#e6edf3" },
  margin: { l: 40, r: 20, t: 20, b: 40 },
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

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(0, 6) : id;
}

function seriesLabel(
  name: string,
  contextHash: string,
  runId: string | undefined,
  includeRun: boolean,
): string {
  const parts: string[] = [name];
  if (includeRun && runId) parts.push(shortRunId(runId));
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
    return {
      ...base,
      ...DARK_LAYOUT,
      font: { ...((base.font as object) ?? {}), ...(DARK_LAYOUT.font as object) },
      margin: DARK_LAYOUT.margin,
      hovermode: settings.hoverMode === "none" ? false : settings.hoverMode,
      dragmode: settings.dragMode === "none" ? false : settings.dragMode,
      showlegend: settings.showLegend,
    };
  }, [sourceQ.data, settings.hoverMode, settings.dragMode, settings.showLegend]);

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
      <div className="rounded bg-bg">
        <Plot
          data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
          layout={mergedLayout as Partial<Plotly.Layout>}
          config={plotlyConfig}
          useResizeHandler
          style={{ width: "100%", height: "320px" }}
        />
      </div>
    );
  }
  if (sourceHash && sourceQ.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="flex justify-center rounded bg-bg p-2">
      <img
        src={api.artifactUrl(current.artifact_hash)}
        alt={`${m.name} @ step ${current.step}`}
        className="max-h-64 object-contain"
      />
    </div>
  );
}

export default function FigureInteractiveCard({ runId, metric, extraContexts = [] }: Props) {
  const seedMetric = useMemo(
    () => ({ name: metric.name, context_hash: metric.context_hash }),
    [metric.name, metric.context_hash],
  );

  const defaults = useMemo<FigureSettings>(() => {
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      seedMetric,
      ...(extraContexts ?? []).map((e) => ({
        name: e.name,
        context_hash: e.context_hash,
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
  }, [seedMetric, extraContexts]);

  const settingsKey = {
    runId,
    metricName: metric.name,
    contextHash: metric.context_hash,
  };
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    defaults,
  );

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

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
    queries: settings.metrics.length > 1
      ? settings.metrics.map((m) => {
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
    if (settings.metrics.length <= 1) return points.length;
    let max = 0;
    for (const mq of multiQueries) {
      const pts = (mq.data as SequenceResponse | undefined)?.points?.filter(
        (p: SequencePoint) => p.artifact_hash,
      );
      if (pts && pts.length > max) max = pts.length;
    }
    return max;
  }, [settings.metrics.length, points.length, multiQueries]);

  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, maxStepCount - 1));
  const current = points[safeIdx];

  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // "Add to comparison" popover state.
  const projectId = useProjectId();
  const { comparisons, refresh: refreshComparisons } =
    useComparisons(projectId ?? "");
  const addCompBtnRef = useRef<HTMLButtonElement | null>(null);
  const [addCompOpen, setAddCompOpen] = useState(false);
  const [addCompConfirm, setAddCompConfirm] = useState<string | null>(null);
  const addCompTimer = useRef<number | null>(null);
  const [newCompName, setNewCompName] = useState("");
  const [dropHighlight, setDropHighlight] = useState(false);

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
    return {
      ...base,
      ...DARK_LAYOUT,
      font: { ...((base.font as object) ?? {}), ...(DARK_LAYOUT.font as object) },
      margin: DARK_LAYOUT.margin,
      hovermode: settings.hoverMode === "none" ? false : settings.hoverMode,
      dragmode: settings.dragMode === "none" ? false : settings.dragMode,
      showlegend: settings.showLegend,
    };
  }, [sourceQ.data, settings.hoverMode, settings.dragMode, settings.showLegend]);

  const plotlyConfig = useMemo(
    () => ({
      displayModeBar: settings.displayModeBar,
      scrollZoom: settings.scrollZoom,
      responsive: true,
    }),
    [settings.displayModeBar, settings.scrollZoom],
  );

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;
  const isDirty = settingsDifferFromDefaults(settings, defaults);

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of settings.metrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [settings.metrics, runId]);

  const subtitle =
    maxStepCount > 0
      ? `step ${current?.step ?? safeIdx} of ${maxStepCount}`
      : `${metric.count} pts`;

  const isMulti = settings.metrics.length > 1;

  return (
    <div
      className={`card p-4${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{ minHeight: settings.height ?? undefined, position: "relative" }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(CAIRN_SERIES_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes(CAIRN_SERIES_MIME)) return;
        setDropHighlight(true);
      }}
      onDragLeave={(e) => {
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        setDropHighlight(false);
      }}
      onDrop={(e) => {
        setDropHighlight(false);
        const raw = e.dataTransfer.getData(CAIRN_SERIES_MIME);
        if (!raw) return;
        e.preventDefault();
        try {
          const dropped: SeriesRef = JSON.parse(raw);
          const existing = settingsRef.current.metrics;
          const key = `${dropped.runId ?? ""}::${dropped.name}::${dropped.context_hash}`;
          const alreadyHas = existing.some(
            (m) => `${m.runId ?? ""}::${m.name}::${m.context_hash}` === key,
          );
          if (!alreadyHas) {
            updateSettings({
              metrics: [
                ...existing,
                {
                  runId: dropped.runId,
                  name: dropped.name,
                  context_hash: dropped.context_hash,
                },
              ],
            });
          }
        } catch {
          /* malformed payload, ignore */
        }
      }}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
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
        <button
          ref={settingsButtonRef}
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          aria-label="Figure settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title="Settings"
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
        >
          {"\u2699"}
        </button>
      </CardHeader>

      {isMulti ? (
        <>
          <SplitPane
            widths={settings.paneWidths ?? Array(settings.metrics.length).fill(1 / settings.metrics.length)}
            onWidthsChange={(w) => updateSettings({ paneWidths: w })}
          >
            {settings.metrics.map((m) => (
              <FigurePane
                key={seriesKey(m)}
                runId={runId}
                m={m}
                stepIdx={safeIdx}
                settings={settings}
              />
            ))}
          </SplitPane>
          {maxStepCount > 1 && (
            <input
              type="range"
              min={0}
              max={maxStepCount - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
          {/* Series chip strip */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settings.metrics.map((m, i) => {
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
                    settings.metrics.length > 1
                      ? () => {
                          const next = settings.metrics.filter((_, j) => j !== i);
                          updateSettings({ metrics: next });
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        </>
      ) : q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
        <>
          {showPlotly ? (
            <div className="rounded bg-bg">
              <Plot
                data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
                layout={mergedLayout as Partial<Plotly.Layout>}
                config={plotlyConfig}
                useResizeHandler
                style={{ width: "100%", height: "320px" }}
              />
            </div>
          ) : sourceHash && sourceQ.isLoading ? (
            <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
          ) : (
            <div className="flex justify-center rounded bg-bg p-2">
              <img
                src={api.artifactUrl(current.artifact_hash)}
                alt={`${metric.name} @ step ${current.step}`}
                className="max-h-64 object-contain"
              />
            </div>
          )}
          {points.length > 1 && (
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no figure logged yet</div>
      )}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsButtonRef}
        title="Figure"
      >
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
      </SettingsPopover>

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
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
      />
    </div>
  );
}
