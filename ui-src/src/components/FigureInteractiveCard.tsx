import { useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { useCardSettings } from "../lib/card-settings";
import CardHeader from "./CardHeader";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import type { SequenceMeta } from "../api/types";

const Plot = createPlotlyComponent(Plotly);

interface Props {
  runId: string;
  metric: SequenceMeta;
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

interface FigureSettings {
  version: 1;
  displayModeBar: boolean;
  scrollZoom: boolean;
  hoverMode: HoverMode;
  dragMode: DragMode;
  showLegend: boolean;
}

const DEFAULT_FIGURE_SETTINGS: FigureSettings = {
  version: 1,
  displayModeBar: false,
  scrollZoom: true,
  hoverMode: "closest",
  dragMode: "zoom",
  showLegend: true,
};

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

function settingsDifferFromDefaults(s: FigureSettings): boolean {
  return (
    s.displayModeBar !== DEFAULT_FIGURE_SETTINGS.displayModeBar ||
    s.scrollZoom !== DEFAULT_FIGURE_SETTINGS.scrollZoom ||
    s.hoverMode !== DEFAULT_FIGURE_SETTINGS.hoverMode ||
    s.dragMode !== DEFAULT_FIGURE_SETTINGS.dragMode ||
    s.showLegend !== DEFAULT_FIGURE_SETTINGS.showLegend
  );
}

export default function FigureInteractiveCard({ runId, metric }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];

  const settingsKey = {
    runId,
    metricName: metric.name,
    contextHash: metric.context_hash,
  };
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    DEFAULT_FIGURE_SETTINGS,
  );

  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    // Start from the source JSON's layout, then overlay dark-theme overrides
    // so our bg/font/margin always win. Settings are applied last so the
    // user's choices override both the source and any theme defaults.
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
  const isDirty = settingsDifferFromDefaults(settings);

  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "—"} of ${points.length}`
      : `${metric.count} pts`;

  return (
    <div className="card p-4">
      <CardHeader title={metric.name} subtitle={subtitle}>
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
            ↺
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
          ⚙
        </button>
      </CardHeader>
      {q.isLoading ? (
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
    </div>
  );
}
