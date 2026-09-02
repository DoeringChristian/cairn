import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useCardSettings } from "../lib/card-settings";
import { ScatterPlot, type ScatterPoint, type ParetoDirection } from "../lib/public-plot";
import { downloadCsv, exportChartPng, safeName } from "../lib/download";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import CardShell from "./CardShell";
import RunSelectionPanel from "./RunSelectionPanel";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import { buildRunInfoMap, type BaseCardSettings } from "./card-kit";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface AxisDef {
  key: string;
  source: "param" | "metric";
}

interface ScatterSettings extends BaseCardSettings {
  xAxis: AxisDef | null;
  yAxis: AxisDef | null;
  colorAxis: AxisDef | null;
  xLog?: boolean;
  yLog?: boolean;
  showPareto?: boolean;
  paretoDirection?: ParetoDirection;
}

const DEFAULT_SETTINGS: ScatterSettings = {
  version: 1,
  xAxis: null,
  yAxis: null,
  colorAxis: null,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string; contextHash: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

export default function ScatterPlotCard({
  runIds,
  settingsKey,
  onRemove,
  autoOpenSettings,
}: Props) {
  const runMetaVersion = useRunMetadataVersion();

  const [settings, updateSettings] = useCardSettings(settingsKey, DEFAULT_SETTINGS);
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  // Fetch run details (params)
  const runQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 30_000,
    })),
  });

  // Collect all axes that need metric fetches
  const metricAxes = useMemo(() => {
    const axes: AxisDef[] = [];
    const seen = new Set<string>();
    for (const a of [settings.xAxis, settings.yAxis, settings.colorAxis]) {
      if (a && a.source === "metric" && !seen.has(a.key)) {
        axes.push(a);
        seen.add(a.key);
      }
    }
    return axes;
  }, [settings.xAxis, settings.yAxis, settings.colorAxis]);

  const metricQueries = useQueries({
    queries: runIds.flatMap((rid) =>
      metricAxes.map((ax) => ({
        queryKey: qk.sequence(rid, ax.key, ""),
        queryFn: () => api.sequence(rid, ax.key, {}),
        staleTime: 30_000,
      })),
    ),
  });

  // Build scatter data
  const scatterPoints = useMemo(() => {
    const resolve = (rid: string, axis: AxisDef | null): number | null => {
      if (!axis) return null;
      if (axis.source === "param") {
        const rq = runQueries[runIds.indexOf(rid)];
        const params = rq?.data?.params ?? [];
        const p = params.find((pp) => pp.key === axis.key);
        if (!p) return null;
        const n = Number(p.value);
        return Number.isFinite(n) ? n : null;
      }
      const axIdx = metricAxes.findIndex((a) => a.key === axis.key);
      if (axIdx < 0) return null;
      const qIdx = runIds.indexOf(rid) * metricAxes.length + axIdx;
      const mq = metricQueries[qIdx];
      const pts = mq?.data?.points;
      if (!pts?.length) return null;
      return pts[pts.length - 1]?.scalar_value ?? null;
    };

    const pts: ScatterPoint[] = [];
    for (const rid of runIds) {
      const x = resolve(rid, settings.xAxis);
      const y = resolve(rid, settings.yAxis);
      if (x == null || y == null) continue;
      const c = resolve(rid, settings.colorAxis);
      pts.push({ id: rid, x, y, color: c, label: shortRunLabel(rid, runIds) });
    }
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.xAxis, settings.yAxis, settings.colorAxis,
    runIds,
    metricAxes,
    runQueries.map((q) => q.dataUpdatedAt).join("|"),
    metricQueries.map((q) => q.dataUpdatedAt).join("|"),
    runMetaVersion,
  ]);

  // Available options
  const availableParams = useMemo(() => {
    const keys = new Set<string>();
    for (const q of runQueries) for (const p of q.data?.params ?? []) keys.add(p.key);
    return Array.from(keys).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const seqQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.sequences(rid),
      queryFn: () => api.sequences(rid),
      staleTime: 30_000,
    })),
  });

  const availableMetrics = useMemo(() => {
    const names = new Set<string>();
    for (const q of seqQueries) for (const seq of q.data?.sequences ?? []) {
      if (seq.object_type === "scalar") names.add(seq.name);
    }
    return Array.from(names).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const runInfoMap = useMemo(
    () => buildRunInfoMap(runIds, runQueries),
    [runIds, runQueries],
  );

  // ---------------------------------------------------------------------------
  // Settings panel
  // ---------------------------------------------------------------------------
  const axisOptions = useMemo(() => {
    const opts: Array<{ key: string; source: "param" | "metric"; label: string }> = [];
    for (const k of availableParams) opts.push({ key: k, source: "param", label: `[P] ${k}` });
    for (const k of availableMetrics) opts.push({ key: k, source: "metric", label: `[M] ${k}` });
    return opts;
  }, [availableParams, availableMetrics]);

  const AxisSelect = ({ label, value, onChange }: { label: string; value: AxisDef | null; onChange: (v: AxisDef | null) => void }) => (
    <div className="mb-2">
      <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">{label}</label>
      <select
        value={value ? `${value.source}:${value.key}` : ""}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) { onChange(null); return; }
          const [source, ...rest] = v.split(":");
          onChange({ key: rest.join(":"), source: source as "param" | "metric" });
        }}
        className="input w-full text-xs"
      >
        <option value="">-- none --</option>
        {axisOptions.map((o) => (
          <option key={`${o.source}:${o.key}`} value={`${o.source}:${o.key}`}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  const settingsPanel = (
    <>
      <AxisSelect label="X Axis" value={settings.xAxis} onChange={(v) => updateSettings({ xAxis: v })} />
      <AxisSelect label="Y Axis" value={settings.yAxis} onChange={(v) => updateSettings({ yAxis: v })} />
      <AxisSelect label="Color" value={settings.colorAxis} onChange={(v) => updateSettings({ colorAxis: v })} />
      <div className="mt-2 flex flex-col gap-1">
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input type="checkbox" checked={!!settings.xLog} onChange={(e) => updateSettings({ xLog: e.target.checked })} />
          X log scale
        </label>
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input type="checkbox" checked={!!settings.yLog} onChange={(e) => updateSettings({ yLog: e.target.checked })} />
          Y log scale
        </label>
      </div>
      <div className="mt-3 border-t border-border-subtle pt-3">
        <Toggle
          label="Pareto front"
          checked={!!settings.showPareto}
          onChange={(v) => updateSettings({ showPareto: v })}
        />
        {settings.showPareto && (
          <Select<ParetoDirection>
            label="Direction"
            value={settings.paretoDirection ?? "min-min"}
            onChange={(v) => updateSettings({ paretoDirection: v })}
            options={[
              { value: "min-min", label: "Min X, Min Y" },
              { value: "min-max", label: "Min X, Max Y" },
              { value: "max-min", label: "Max X, Min Y" },
              { value: "max-max", label: "Max X, Max Y" },
            ]}
          />
        )}
      </div>
    </>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const cardRef = useRef<HTMLDivElement>(null);

  const noAxes = !settings.xAxis || !settings.yAxis;

  const plotProps = {
    points: scatterPoints,
    xLabel: settings.xAxis?.key,
    yLabel: settings.yAxis?.key,
    colorLabel: settings.colorAxis?.key,
    xLog: settings.xLog,
    yLog: settings.yLog,
    pareto: settings.showPareto
      ? { show: true, direction: settings.paretoDirection ?? ("min-min" as ParetoDirection) }
      : undefined,
    selectedIds,
    onClick: (id: string) => toggle(id),
    onBackgroundClick: clear,
  };

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={runIds}
      onClear={clear}
      runInfo={runInfoMap}
      renderExtra={(rid) => {
        const pt = scatterPoints.find((p) => p.id === rid);
        return pt ? (
          <>
            <span className="ml-2 text-fg-subtle">{settings.xAxis?.key}: {pt.x.toPrecision(4)}</span>
            <span className="ml-2 text-fg-subtle">{settings.yAxis?.key}: {pt.y.toPrecision(4)}</span>
          </>
        ) : null;
      }}
      label="Scatter selection"
    />
  );

  return (
    <CardShell cardKind="scatter"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title="Scatter Plot"
      subtitle={`${scatterPoints.length} points`}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["run_id", settings.xAxis?.key ?? "x", settings.yAxis?.key ?? "y"];
        if (settings.colorAxis) headers.push(settings.colorAxis.key);
        const rows: (string | number)[][] = scatterPoints.map((pt) => {
          const row: (string | number)[] = [pt.id, pt.x, pt.y];
          if (settings.colorAxis) row.push(pt.color ?? "");
          return row;
        });
        downloadCsv(headers, rows, safeName(settings.title ?? "scatter_plot") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? "scatter_plot")); }}
      selectionPanel={selectionPanel}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={
        <div className="flex flex-col h-[calc(100vh-12rem)]">
          {noAxes ? (
            <div className="flex items-center justify-center flex-1 text-sm text-fg-muted">
              Select X and Y axes in settings to create the scatter plot.
            </div>
          ) : (
            <ScatterPlot {...plotProps} className="flex-1 min-h-0" />
          )}
        </div>
      }
    >
      <>
        {noAxes ? (
          <div className="flex items-center justify-center flex-1 min-h-0 text-sm text-fg-muted">
            Select X and Y axes in settings to create the scatter plot.
          </div>
        ) : (
          <ScatterPlot {...plotProps} className="rounded bg-bg flex-1 min-h-0" />
        )}
      </>
    </CardShell>
  );
}
