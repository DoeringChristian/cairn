import { useMemo, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey } from "../lib/series-utils";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import {
  useCardSeries,
  useStepSlider,
  resolveAtStep,
  useRunInfo,
  MultiPaneGrid,
  type BaseCardSettings,
} from "./card-kit";
import {
  PointCloudViewer,
  type PointCloudChannels,
  type PointColorMode,
  type PointCloudBackground,
} from "../lib/cairn-plot";
import { parseNpy } from "../lib/cairn-plot/transforms/parse-npy";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import Select from "./settings/Select";
import Slider from "./settings/Slider";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import StepSlider from "./StepSlider";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface PointCloudMeta {
  n_points: number;
  channels: PointCloudChannels;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  original_count: number;
  downsampled?: boolean;
}

interface PointCloudSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
  pointSize: number;
  colorMode: PointColorMode;
  background: PointCloudBackground;
}

const DEFAULT_SETTINGS = (seed: { name: string; context_hash: string }): PointCloudSettings => ({
  version: 1,
  metrics: [seed],
  pointSize: 2.5,
  colorMode: "auto",
  background: "dark",
});

const MAX_PANES = 4;

const COLOR_MODE_OPTIONS: Array<{ value: PointColorMode; label: string }> = [
  { value: "auto", label: "Auto (rgb → category → height)" },
  { value: "rgb", label: "RGB" },
  { value: "category", label: "Category" },
  { value: "height", label: "Height (viridis)" },
];

const BACKGROUND_OPTIONS: Array<{ value: PointCloudBackground; label: string }> = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

/** Fetch + parse the .npy point-cloud blob for a given artifact hash. */
function usePointCloudBlob(hash: string | undefined) {
  return useQuery({
    queryKey: ["pointcloud-npy", hash],
    enabled: !!hash,
    staleTime: Infinity,
    queryFn: async () => {
      const res = await fetch(api.artifactUrl(hash!));
      if (!res.ok) throw new Error(`failed to fetch point cloud (${res.status})`);
      return parseNpy(await res.arrayBuffer());
    },
  });
}

interface ViewConfig {
  pointSize: number;
  colorMode: PointColorMode;
  background: PointCloudBackground;
}

/** Renders a single resolved point-cloud point (blob + metadata). */
function PointCloudBody({
  hash,
  meta,
  view,
}: {
  hash: string | undefined;
  meta: PointCloudMeta | null | undefined;
  view: ViewConfig;
}) {
  const blob = usePointCloudBlob(hash);

  if (!hash) {
    return <div className="text-sm text-fg-muted">no point cloud logged yet</div>;
  }
  if (blob.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (blob.isError || !blob.data || !meta) {
    return <div className="text-sm text-fg-muted">failed to load point cloud</div>;
  }

  const nPoints = meta.n_points ?? blob.data.shape[0] ?? 0;
  return (
    <div className="flex flex-col">
      <div className="h-64 overflow-hidden rounded bg-bg">
        <PointCloudViewer
          data={blob.data.data}
          channels={meta.channels}
          nPoints={nPoints}
          bounds={meta.bounds}
          colorMode={view.colorMode}
          pointSize={view.pointSize}
          background={view.background}
        />
      </div>
      <div className="mono mt-1 text-xs text-fg-subtle">
        {`${nPoints.toLocaleString()} pts · ${meta.channels}`}
        {meta.downsampled
          ? ` · downsampled from ${meta.original_count.toLocaleString()}`
          : ""}
        {" · double-click to re-fit"}
      </div>
    </div>
  );
}

/** A pane in the multi-run grid: fetches its own sequence + blob at the step. */
function PointCloudPane({
  runId,
  m,
  targetStep,
  view,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
  view: ViewConfig;
}) {
  const rid = m.runId ?? runId;
  const q = useSequence(rid, m.name, {
    context: m.context_hash || undefined,
    maxPoints: 500,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const current = useMemo(
    () => resolveAtStep(points, targetStep) ?? points[0],
    [points, targetStep],
  );
  const meta = useMemo(
    () => safeJsonParse<PointCloudMeta>(current?.artifact_metadata),
    [current],
  );

  if (q.isLoading) {
    return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  return (
    <div className="rounded bg-bg p-2">
      <PointCloudBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
    </div>
  );
}

export default function PointCloudCard({
  runId,
  metric,
  extraSeries,
  controlledSeries,
  settingsKeyOverride,
  onRemove,
  autoOpenSettings,
}: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<PointCloudSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_SETTINGS(seed),
        metrics,
      }),
    });

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  const view: ViewConfig = {
    pointSize: settings.pointSize,
    colorMode: settings.colorMode,
    background: settings.background,
  };

  // Single-metric path: fetch points for the step slider.
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 500,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // Multi-metric: fetch all sequences to determine max step count.
  const multiQueries = useQueries({
    queries:
      effectiveMetrics.length > 1
        ? effectiveMetrics.map((m) => {
            const rid = m.runId ?? runId;
            return {
              queryKey: qk.sequence(rid, m.name, m.context_hash),
              queryFn: () =>
                api.sequence(rid, m.name, {
                  context: m.context_hash || undefined,
                  maxPoints: 500,
                }),
              refetchInterval: 2_000,
              staleTime: 2_000,
            };
          })
        : [],
  });

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

  const current = useMemo(() => {
    const exact = points.find((p) => p.step === currentStep && p.artifact_hash);
    if (exact) return exact;
    let best: (typeof points)[number] | undefined;
    for (const p of points) {
      if (p.step <= currentStep && p.artifact_hash) best = p;
      else if (p.step > currentStep) break;
    }
    return best;
  }, [points, currentStep]);

  const meta = useMemo(
    () => safeJsonParse<PointCloudMeta>(current?.artifact_metadata),
    [current],
  );

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const runMetaVersion = useRunMetadataVersion();

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();
  const { runInfoMap } = useRunInfo(allRunIds);

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : meta
        ? `${meta.n_points.toLocaleString()} pts · ${meta.channels}`
        : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const cardRef = useRef<HTMLDivElement>(null);

  // Cap panes (each is its own WebGL context).
  const shownMetrics = useMemo(
    () => effectiveMetrics.slice(0, MAX_PANES),
    [effectiveMetrics],
  );
  const paneKeys = useMemo(() => shownMetrics.map(seriesKey), [shownMetrics]);
  const paneLabels = useMemo(() => {
    const map = new Map<string, string>();
    if (multipleRuns) {
      for (const m of shownMetrics) {
        map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multipleRuns, shownMetrics, allRunIds, runId, runMetaVersion]);

  const renderSingle = () => {
    if (q.isLoading) {
      return <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    return (
      <>
        <PointCloudBody hash={current?.artifact_hash ?? undefined} meta={meta} view={view} />
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

  const renderMulti = (inModal: boolean) => (
    <>
      {effectiveMetrics.length > MAX_PANES && (
        <div className="mono mb-2 text-xs text-fg-subtle">
          {`showing ${MAX_PANES} of ${effectiveMetrics.length}`}
        </div>
      )}
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={paneLabels}
        inModal={inModal}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateSettings({ paneWidths: w })}
        renderPane={(key, i) => {
          const m = shownMetrics[i]!;
          return (
            <PointCloudPane
              key={key}
              runId={runId}
              m={m}
              targetStep={currentStep}
              view={view}
            />
          );
        }}
      />
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

  const renderContent = (inModal: boolean) =>
    isMulti ? renderMulti(inModal) : renderSingle();

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Point cloud selection"
    />
  );

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={
        current?.artifact_hash
          ? () =>
              downloadArtifact(
                api.artifactUrl(current.artifact_hash!),
                artifactFilename(metric.name, current.step, current.artifact_mime ?? "application/octet-stream"),
              )
          : undefined
      }
      addToComparisonSlot={<AddToComparisonButton cardType="pointcloud" series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={
        <>
          <Slider
            label="Point size"
            value={settings.pointSize}
            onChange={(v) => updateSettings({ pointSize: v })}
            min={0.5}
            max={8}
            step={0.5}
            format={(v) => v.toFixed(1)}
            description="Point radius in pixels"
          />
          <Select
            label="Color mode"
            value={settings.colorMode}
            onChange={(v) => updateSettings({ colorMode: v })}
            options={COLOR_MODE_OPTIONS}
            description="Falls back to an available channel when the chosen one is absent"
          />
          <Select
            label="Background"
            value={settings.background}
            onChange={(v) => updateSettings({ background: v })}
            options={BACKGROUND_OPTIONS}
          />
        </>
      }
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex flex-col h-full">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>{renderContent(false)}</>
    </CardShell>
  );
}
