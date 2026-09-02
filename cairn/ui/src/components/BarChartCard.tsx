import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useCardSettings } from "../lib/card-settings";
import {
  BarChart,
  SERIES_COLORS,
  type BarDatum,
  type BarCompareMode,
} from "../lib/public-plot";
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

interface MetricDef {
  key: string;
  source: "param" | "metric";
}

type Aggregation = "last" | "min" | "max" | "mean";
type SortBy = "value" | "name";

interface BarSettings extends BaseCardSettings {
  metric: MetricDef | null;
  aggregation: Aggregation;
  sortBy: SortBy;
  sortDesc?: boolean;
  logX?: boolean;
  /**
   * How to compose multiple runs' bars against each other. Only surfaced in
   * settings (and only affects rendering) when the card has more than one
   * run; single-run cards always render a single bar regardless of this
   * setting. Undefined == "grouped" (today's one-row-per-run layout), so
   * existing persisted cards are unaffected by this key's introduction.
   */
  compareMode?: BarCompareMode;
}

const DEFAULT_SETTINGS: BarSettings = {
  version: 1,
  metric: null,
  aggregation: "last",
  sortBy: "value",
  sortDesc: true,
};

function aggregate(values: number[], mode: Aggregation): number | null {
  const vals = values.filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  switch (mode) {
    case "min":
      return Math.min(...vals);
    case "max":
      return Math.max(...vals);
    case "mean":
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "last":
    default:
      return vals[vals.length - 1]!;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  runIds: string[];
  settingsKey: { runId: string; metricName: string; contextHash: string };
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

export default function BarChartCard({
  runIds,
  settingsKey,
  onRemove,
  autoOpenSettings,
}: Props) {
  const runMetaVersion = useRunMetadataVersion();
  const [settings, updateSettings] = useCardSettings(settingsKey, DEFAULT_SETTINGS);
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  // Run details (for params + labels).
  const runQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 30_000,
    })),
  });

  const metric = settings.metric;
  const needsMetricFetch = metric?.source === "metric";

  const metricQueries = useQueries({
    queries: needsMetricFetch
      ? runIds.map((rid) => ({
          queryKey: qk.sequence(rid, metric!.key, ""),
          queryFn: () => api.sequence(rid, metric!.key, {}),
          staleTime: 30_000,
        }))
      : [],
  });

  // Stable per-run color: index in the original runIds list.
  const colorByRun = useMemo(() => {
    const m = new Map<string, string>();
    runIds.forEach((rid, i) => m.set(rid, SERIES_COLORS[i % SERIES_COLORS.length]!));
    return m;
  }, [runIds]);

  const bars = useMemo<BarDatum[]>(() => {
    if (!metric) return [];
    const resolve = (rid: string): number | null => {
      if (metric.source === "param") {
        const rq = runQueries[runIds.indexOf(rid)];
        const p = (rq?.data?.params ?? []).find((pp) => pp.key === metric.key);
        if (!p) return null;
        const n = Number(p.value);
        return Number.isFinite(n) ? n : null;
      }
      const mq = metricQueries[runIds.indexOf(rid)];
      const pts = mq?.data?.points;
      if (!pts?.length) return null;
      const scalars = pts
        .map((pt) => pt.scalar_value)
        .filter((v): v is number => v != null);
      return aggregate(scalars, settings.aggregation);
    };

    const out: BarDatum[] = [];
    for (const rid of runIds) {
      const value = resolve(rid);
      if (value == null) continue;
      out.push({
        id: rid,
        label: shortRunLabel(rid, runIds),
        value,
        color: colorByRun.get(rid),
      });
    }

    // This card only ever plots one metric (one "category" in the
    // grouped/stacked/overlay sense — see BarChart's compareMode doc), so
    // sorting the runs directly here *is* "sort by [the metric's] value":
    // the degenerate case of "sort categories by first run's value" when
    // there's exactly one category. Grouped mode renders `bars` in this
    // order; stacked mode ignores it deliberately (segments stack in
    // `runOrderIds`/original run order instead, per spec) and overlay mode
    // uses it for z-order (last drawn = on top).
    out.sort((a, b) => {
      if (settings.sortBy === "name") return a.label.localeCompare(b.label);
      return a.value - b.value;
    });
    if (settings.sortDesc ?? true) out.reverse();
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    metric,
    settings.aggregation,
    settings.sortBy,
    settings.sortDesc,
    runIds,
    colorByRun,
    runQueries.map((q) => q.dataUpdatedAt).join("|"),
    metricQueries.map((q) => q.dataUpdatedAt).join("|"),
    runMetaVersion,
  ]);

  // Stack segment order is intentionally independent of the sort setting
  // (spec: "stacked ... in run order") — this is the original runIds order,
  // filtered down to runs that actually resolved a value.
  const runOrderIds = useMemo(() => {
    const present = new Set(bars.map((b) => b.id));
    return runIds.filter((rid) => present.has(rid));
  }, [runIds, bars]);

  // Available axes for the picker.
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

  const axisOptions = useMemo(() => {
    const opts: Array<{ key: string; source: "param" | "metric"; label: string }> = [];
    for (const k of availableMetrics) opts.push({ key: k, source: "metric", label: `[M] ${k}` });
    for (const k of availableParams) opts.push({ key: k, source: "param", label: `[P] ${k}` });
    return opts;
  }, [availableParams, availableMetrics]);

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const runInfoMap = useMemo(
    () => buildRunInfoMap(runIds, runQueries),
    [runIds, runQueries],
  );

  // ---------------------------------------------------------------------------
  // Settings panel
  // ---------------------------------------------------------------------------
  const settingsPanel = (
    <>
      <div className="mb-2">
        <label className="block text-[10px] uppercase tracking-wide text-fg-muted mb-1">
          Metric
        </label>
        <select
          value={metric ? `${metric.source}:${metric.key}` : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) { updateSettings({ metric: null }); return; }
            const [source, ...rest] = v.split(":");
            updateSettings({ metric: { key: rest.join(":"), source: source as "param" | "metric" } });
          }}
          className="input w-full text-xs"
        >
          <option value="">-- select metric --</option>
          {axisOptions.map((o) => (
            <option key={`${o.source}:${o.key}`} value={`${o.source}:${o.key}`}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <Select<Aggregation>
        label="Aggregation"
        value={settings.aggregation}
        onChange={(v) => updateSettings({ aggregation: v })}
        options={[
          { value: "last", label: "Last" },
          { value: "min", label: "Min" },
          { value: "max", label: "Max" },
          { value: "mean", label: "Mean" },
        ]}
      />
      <Select<SortBy>
        label="Sort by"
        value={settings.sortBy}
        onChange={(v) => updateSettings({ sortBy: v })}
        options={[
          { value: "value", label: "Value" },
          { value: "name", label: "Name" },
        ]}
      />
      <div className="mt-2 flex flex-col gap-1">
        <Toggle
          label="Descending"
          checked={settings.sortDesc ?? true}
          onChange={(v) => updateSettings({ sortDesc: v })}
        />
        <Toggle
          label="Log value axis"
          checked={!!settings.logX}
          onChange={(v) => updateSettings({ logX: v })}
        />
      </div>
      {/* Comparison mode only makes sense with more than one run — a
          single-run card always has exactly one bar. */}
      {runIds.length > 1 && (
        <Select<BarCompareMode>
          label="Compare runs"
          value={settings.compareMode ?? "grouped"}
          onChange={(v) => updateSettings({ compareMode: v })}
          options={[
            { value: "grouped", label: "Grouped (one row per run)" },
            {
              value: "stacked",
              label: "Stacked (summed total)",
              disabled: !!settings.logX,
            },
            { value: "overlay", label: "Overlay (translucent, superimposed)" },
          ]}
          description={
            settings.logX
              ? "Stacked totals are misleading on a log axis, so it's disabled while log axis is on."
              : (settings.compareMode ?? "grouped") === "stacked"
                ? "Bars stack in run order (not the sort setting); tooltip shows each run's share of the total."
                : (settings.compareMode ?? "grouped") === "overlay"
                  ? "Bars are superimposed with transparency, drawn in sorted order (last drawn is on top)."
                  : undefined
          }
        />
      )}
    </>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const cardRef = useRef<HTMLDivElement>(null);
  const noMetric = !metric;

  const plotProps = {
    bars,
    valueLabel: metric?.key,
    logX: settings.logX,
    compareMode: settings.compareMode ?? "grouped",
    runOrder: runOrderIds,
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
        const bar = bars.find((b) => b.id === rid);
        return bar ? (
          <span className="ml-2 text-fg-subtle">{metric?.key}: {bar.value.toPrecision(4)}</span>
        ) : null;
      }}
      label="Bar selection"
    />
  );

  return (
    <CardShell cardKind="bar"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title="Bar Chart"
      subtitle={`${bars.length} run${bars.length === 1 ? "" : "s"}`}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={() => {
        const headers = ["run_id", "label", metric?.key ?? "value"];
        const rows: (string | number)[][] = bars.map((b) => [b.id, b.label, b.value]);
        downloadCsv(headers, rows, safeName(settings.title ?? "bar_chart") + ".csv");
      }}
      onScreenshot={() => { if (cardRef.current) exportChartPng(cardRef.current, safeName(settings.title ?? "bar_chart")); }}
      selectionPanel={selectionPanel}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={
        <div className="flex flex-col h-[calc(100vh-12rem)]">
          {noMetric ? (
            <div className="flex items-center justify-center flex-1 text-sm text-fg-muted">
              Select a metric in settings to create the bar chart.
            </div>
          ) : (
            <BarChart {...plotProps} className="flex-1 min-h-0" />
          )}
        </div>
      }
    >
      <>
        {noMetric ? (
          <div className="flex items-center justify-center flex-1 min-h-0 text-sm text-fg-muted">
            Select a metric in settings to create the bar chart.
          </div>
        ) : bars.length === 0 ? (
          <div className="flex items-center justify-center flex-1 min-h-0 text-sm text-fg-muted">
            No values for this metric across the runs.
          </div>
        ) : (
          <BarChart {...plotProps} className="rounded bg-bg flex-1 min-h-0" />
        )}
      </>
    </CardShell>
  );
}
