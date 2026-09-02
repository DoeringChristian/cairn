import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { useCardSettings } from "../lib/card-settings";
import { formatNum } from "../lib/public-plot";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import CardShell from "./CardShell";
import Select from "./settings/Select";
import { type BaseCardSettings } from "./card-kit";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

interface MetricDef {
  key: string;
  source: "param" | "metric";
}

type Reduce = "best" | "mean" | "latest";
type BestDir = "max" | "min";

interface TileSettings extends BaseCardSettings {
  metric: MetricDef | null;
  reduce: Reduce;
  bestDir: BestDir;
}

const DEFAULT_SETTINGS: TileSettings = {
  version: 1,
  metric: null,
  reduce: "best",
  bestDir: "max",
  colSpan: 1,
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

interface PerRun {
  runId: string;
  value: number;
  prev: number | null;
  createdAt: number;
}

export default function ScalarTileCard({
  runIds,
  settingsKey,
  onRemove,
  autoOpenSettings,
}: Props) {
  const runMetaVersion = useRunMetadataVersion();
  const [settings, updateSettings] = useCardSettings(settingsKey, DEFAULT_SETTINGS);
  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

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

  // Per-run last value (+ previous step for the delta) and creation time.
  const perRun = useMemo<PerRun[]>(() => {
    if (!metric) return [];
    const out: PerRun[] = [];
    runIds.forEach((rid, i) => {
      const createdRaw = runQueries[i]?.data?.run.created_at;
      const createdAt = createdRaw ? new Date(createdRaw).getTime() : 0;
      let value: number | null = null;
      let prev: number | null = null;
      if (metric.source === "param") {
        const p = (runQueries[i]?.data?.params ?? []).find((pp) => pp.key === metric.key);
        const n = p ? Number(p.value) : NaN;
        value = Number.isFinite(n) ? n : null;
      } else {
        const pts = (metricQueries[i]?.data?.points ?? [])
          .map((pt) => pt.scalar_value)
          .filter((v): v is number => v != null);
        if (pts.length) {
          value = pts[pts.length - 1]!;
          prev = pts.length >= 2 ? pts[pts.length - 2]! : null;
        }
      }
      if (value != null) out.push({ runId: rid, value, prev, createdAt });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    metric,
    runIds,
    runQueries.map((q) => q.dataUpdatedAt).join("|"),
    metricQueries.map((q) => q.dataUpdatedAt).join("|"),
    runMetaVersion,
  ]);

  // Reduce across runs to the single displayed tile value.
  const tile = useMemo(() => {
    if (!perRun.length) return null;
    if (settings.reduce === "mean") {
      const mean = perRun.reduce((a, b) => a + b.value, 0) / perRun.length;
      return { value: mean, runId: null as string | null, prev: null as number | null, count: perRun.length };
    }
    let chosen: PerRun;
    if (settings.reduce === "latest") {
      chosen = perRun.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    } else {
      // best
      chosen = perRun.reduce((a, b) => {
        if (settings.bestDir === "min") return b.value < a.value ? b : a;
        return b.value > a.value ? b : a;
      });
    }
    return { value: chosen.value, runId: chosen.runId, prev: chosen.prev, count: perRun.length };
  }, [perRun, settings.reduce, settings.bestDir]);

  const delta = tile && tile.prev != null ? tile.value - tile.prev : null;

  // ---------------------------------------------------------------------------
  // Settings options
  // ---------------------------------------------------------------------------
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

  const availableParams = useMemo(() => {
    const keys = new Set<string>();
    for (const q of runQueries) for (const p of q.data?.params ?? []) keys.add(p.key);
    return Array.from(keys).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const axisOptions = useMemo(() => {
    const opts: Array<{ key: string; source: "param" | "metric"; label: string }> = [];
    for (const k of availableMetrics) opts.push({ key: k, source: "metric", label: `[M] ${k}` });
    for (const k of availableParams) opts.push({ key: k, source: "param", label: `[P] ${k}` });
    return opts;
  }, [availableParams, availableMetrics]);

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
      <Select<Reduce>
        label="Across runs"
        value={settings.reduce}
        onChange={(v) => updateSettings({ reduce: v })}
        options={[
          { value: "best", label: "Best" },
          { value: "mean", label: "Mean" },
          { value: "latest", label: "Latest run" },
        ]}
      />
      {settings.reduce === "best" && (
        <Select<BestDir>
          label="Best is"
          value={settings.bestDir}
          onChange={(v) => updateSettings({ bestDir: v })}
          options={[
            { value: "max", label: "Maximum" },
            { value: "min", label: "Minimum" },
          ]}
        />
      )}
    </>
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const cardRef = useRef<HTMLDivElement>(null);

  const runLabel = tile?.runId
    ? shortRunLabel(tile.runId, runIds)
    : settings.reduce === "mean"
      ? `mean of ${tile?.count ?? 0} runs`
      : null;

  const body = (
    <div className="flex flex-1 min-h-0 flex-col justify-center gap-1 py-1">
      {!metric ? (
        <div className="text-sm text-fg-muted">Select a metric in settings.</div>
      ) : !tile ? (
        <div className="text-sm text-fg-muted">No values for this metric.</div>
      ) : (
        <>
          <div className="mono text-3xl font-semibold leading-tight text-fg tabular-nums">
            {formatNum(tile.value)}
          </div>
          <div className="text-xs text-fg-muted truncate">{metric.key}</div>
          {runLabel && (
            <div className="mono text-[11px] text-fg-subtle truncate">{runLabel}</div>
          )}
          {delta != null && (
            <div
              className={`mono text-[11px] ${
                delta > 0
                  ? "text-status-completed"
                  : delta < 0
                    ? "text-status-failed"
                    : "text-fg-subtle"
              }`}
              title="Change vs previous step"
            >
              {delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {formatNum(Math.abs(delta))}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <CardShell cardKind="tile"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title="Scalar Tile"
      subtitle={metric?.key}
      defaultHeight={170}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={<div className="flex h-64 flex-col">{body}</div>}
    >
      {body}
    </CardShell>
  );
}
