import { useMemo, useRef, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import {
  downloadArtifact,
  artifactFilename,
  exportChartFromContainer,
  safeName,
} from "../lib/download";
import { api } from "../api/client";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import {
  HistogramPlot,
  parseNpz,
  type HistogramData,
  type ColormapName,
} from "../lib/cairn-plot";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import StepSlider from "./StepSlider";
import Select from "./settings/Select";
import Toggle from "./settings/Toggle";
import { useStepSlider, resolveAtStep, type BaseCardSettings } from "./card-kit";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface HistogramMeta {
  num_bins: number;
  min: number;
  max: number;
  count: number;
  mean: number;
}

interface HistogramSettings extends BaseCardSettings {
  viewMode: "bars" | "heatmap";
  logY: boolean;
  colormap: ColormapName;
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_HISTOGRAM_SETTINGS: HistogramSettings = {
  version: 1,
  viewMode: "bars",
  logY: false,
  colormap: "viridis",
};

const COLORMAP_OPTIONS: Array<{ value: ColormapName; label: string }> = [
  { value: "viridis", label: "Viridis" },
  { value: "red-blue", label: "Red–Blue" },
  { value: "red-green", label: "Red–Green" },
];

async function fetchNpz(
  hash: string,
): Promise<Record<string, { data: Float64Array }>> {
  const res = await fetch(api.artifactUrl(hash));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return parseNpz(await res.arrayBuffer());
}

function toHistogram(
  npz: Record<string, { data: Float64Array }> | undefined,
): HistogramData | null {
  if (!npz?.counts || !npz?.edges) return null;
  return { counts: Array.from(npz.counts.data), edges: Array.from(npz.edges.data) };
}

function fmtSig(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  return Number(n.toPrecision(sig)).toString();
}

export default function HistogramCard({
  runId,
  metric,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  const settingsKey = useMemo(
    () =>
      settingsKeyOverride ?? {
        runId,
        metricName: metric.name,
        contextHash: metric.context_hash,
      },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings] = useCardSettings(
    settingsKey,
    DEFAULT_HISTOGRAM_SETTINGS,
  );

  const { safeIdx, currentStep, onSliderChange } = useStepSlider({
    seriesPoints: [points],
    persistedIdx: settings.sliderStep,
    updateSettings,
  });
  const current = useMemo(
    () => resolveAtStep(points, currentStep) ?? points[0],
    [points, currentStep],
  );
  const meta = useMemo(
    () => safeJsonParse<HistogramMeta>(current?.artifact_metadata),
    [current],
  );

  const heatmapAvailable = points.length > 3;
  const heatmapActive = settings.viewMode === "heatmap" && heatmapAvailable;

  // Current-step blob (bars view).
  const barsQuery = useQuery({
    queryKey: ["cairn-npz", current?.artifact_hash],
    queryFn: () => fetchNpz(current!.artifact_hash!),
    enabled: !!current?.artifact_hash && !heatmapActive,
    staleTime: Infinity,
  });
  const barsData = useMemo(() => toHistogram(barsQuery.data), [barsQuery.data]);

  // All blobs (heatmap view).
  const heatQueries = useQueries({
    queries: heatmapActive
      ? points.map((p) => ({
          queryKey: ["cairn-npz", p.artifact_hash],
          queryFn: () => fetchNpz(p.artifact_hash!),
          enabled: !!p.artifact_hash,
          staleTime: Infinity,
        }))
      : [],
  });
  const heatVersion = heatQueries.map((h) => h.dataUpdatedAt).join("|");
  const perStep = useMemo(() => {
    const out: Array<{ step: number } & HistogramData> = [];
    points.forEach((p, i) => {
      const hd = toHistogram(heatQueries[i]?.data);
      if (hd) out.push({ step: p.step, ...hd });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, heatVersion]);

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const subtitle = heatmapActive
    ? `${points.length} steps`
    : points.length > 0
      ? `step ${current?.step ?? "—"} (${safeIdx + 1}/${points.length})`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const renderContent = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash || !meta) {
      return <div className="text-sm text-fg-muted">no histogram logged yet</div>;
    }

    if (heatmapActive) {
      const loading = heatQueries.some((h) => h.isLoading);
      return (
        <div className="flex-1 min-h-0">
          {perStep.length > 0 ? (
            <HistogramPlot
              view="heatmap"
              perStep={perStep}
              colormap={settings.colormap}
              logColor={settings.logY}
            />
          ) : (
            <div className="text-xs text-fg-muted motion-safe:animate-pulse">
              {loading ? "loading histograms…" : "no data"}
            </div>
          )}
        </div>
      );
    }

    return (
      <>
        <div className="flex-1 min-h-0">
          {barsQuery.isLoading ? (
            <div className="h-full motion-safe:animate-pulse rounded bg-bg-hover" />
          ) : barsData ? (
            <HistogramPlot
              view="bars"
              counts={barsData.counts}
              edges={barsData.edges}
              logY={settings.logY}
            />
          ) : (
            <div className="text-xs text-fg-muted">could not read histogram blob</div>
          )}
        </div>
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

  const settingsPanel = (
    <>
      <Select<HistogramSettings["viewMode"]>
        label="View"
        value={settings.viewMode}
        onChange={(v) => updateSettings({ viewMode: v })}
        options={
          heatmapAvailable
            ? [
                { value: "bars", label: "Bars (per step)" },
                { value: "heatmap", label: "Heatmap (over steps)" },
              ]
            : [{ value: "bars", label: "Bars (per step)" }]
        }
        description={
          heatmapAvailable ? undefined : "Heatmap needs more than 3 logged steps."
        }
      />
      <Toggle
        label={settings.viewMode === "heatmap" ? "Log color scale" : "Log Y axis"}
        checked={settings.logY}
        onChange={(v) => updateSettings({ logY: v })}
      />
      {settings.viewMode === "heatmap" && (
        <Select<ColormapName>
          label="Colormap"
          value={settings.colormap}
          onChange={(v) => updateSettings({ colormap: v })}
          options={COLORMAP_OPTIONS}
        />
      )}
      {meta && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
          <span>min</span>
          <span className="mono num">{fmtSig(meta.min)}</span>
          <span>max</span>
          <span className="mono num">{fmtSig(meta.max)}</span>
          <span>mean</span>
          <span className="mono num">{fmtSig(meta.mean)}</span>
          <span>count</span>
          <span className="mono num">{meta.count}</span>
          <span>num_bins</span>
          <span className="mono num">{meta.num_bins}</span>
        </div>
      )}
    </>
  );

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={280}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={
        current?.artifact_hash
          ? () =>
              downloadArtifact(
                api.artifactUrl(current.artifact_hash!),
                artifactFilename(metric.name, current.step, current.artifact_mime, ".npz"),
              )
          : undefined
      }
      onScreenshot={() => {
        if (cardRef.current)
          exportChartFromContainer(
            cardRef.current,
            safeName(settings.title ?? metric.name),
            "svg",
          );
      }}
      addToComparisonSlot={
        <AddToComparisonButton cardType="histogram" series={compSeries} />
      }
      settingsPanel={settingsPanel}
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex h-full flex-col">{renderContent()}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent()}</>
    </CardShell>
  );
}
