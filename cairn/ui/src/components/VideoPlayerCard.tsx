import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
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
import { useCardSeries, useStepSlider, resolveAtStep, useRunInfo, MultiPaneGrid, type BaseCardSettings } from "./card-kit";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import SeriesChipStrip from "./SeriesChipStrip";
import { useRunSelection, useRunSelectionHasProvider } from "../lib/use-run-selection";
import RunSelectionPanel from "./RunSelectionPanel";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import StepSlider from "./StepSlider";

interface VideoMetadata {
  fps: number;
  num_frames: number;
  width: number;
  height: number;
  channels: number;
  preview?: string;
}

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface VideoSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  preload: "metadata" | "auto" | "none";
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_VIDEO_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): VideoSettings => ({
  version: 1,
  metrics: [seed],
  autoplay: false,
  loop: false,
  muted: false,
  preload: "metadata",
});

// ---------------------------------------------------------------------------
// Single video pane (used in multi-series split view).
// ---------------------------------------------------------------------------
function VideoPane({
  runId,
  m,
  targetStep,
  settings,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
  settings: VideoSettings;
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
  const current = useMemo(() => resolveAtStep(points, targetStep), [points, targetStep]);
  const meta = safeJsonParse<VideoMetadata>(current?.artifact_metadata);

  if (q.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no video logged yet</div>;
  }
  return (
    <div className="flex flex-col rounded bg-bg p-2">
      <div className="flex justify-center">
        <video
          key={current.artifact_hash}
          controls
          autoPlay={settings.autoplay}
          loop={settings.loop}
          muted={settings.muted}
          preload={settings.preload}
          src={api.artifactUrl(current.artifact_hash)}
          poster={meta?.preview}
          className="max-h-64 object-contain"
        />
      </div>
      {meta && (
        <div className="mono mt-2 text-xs text-fg-subtle">
          {meta.width}\u00D7{meta.height} \u00B7 {meta.num_frames} frames @ {meta.fps} fps
        </div>
      )}
    </div>
  );
}

export default function VideoPlayerCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<VideoSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_VIDEO_SETTINGS(seed),
        metrics,
      }),
    });

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  // Single-metric path.
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // Multi-metric: fetch all sequences.
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
    for (const p of points) { if (p.step <= currentStep && p.artifact_hash) best = p; else if (p.step > currentStep) break; }
    return best;
  }, [points, currentStep]);
  const meta = safeJsonParse<VideoMetadata>(current?.artifact_metadata);

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
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const cardRef = useRef<HTMLDivElement>(null);

  const renderSingleVideo = (maxH: string) => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no video logged yet</div>;
    }
    return (
      <>
        <div className="flex justify-center rounded bg-bg p-2 flex-1 min-h-0">
          <video
            key={current.artifact_hash}
            controls
            autoPlay={settings.autoplay}
            loop={settings.loop}
            muted={settings.muted}
            preload={settings.preload}
            src={api.artifactUrl(current.artifact_hash)}
            poster={meta?.preview}
            className={`${maxH} object-contain`}
          />
        </div>
        {meta && (
          <div className="mono mt-2 text-xs text-fg-subtle">
            {meta.width}{"×"}{meta.height} {"·"} {meta.num_frames} frames @ {meta.fps} fps
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
        map.set(seriesKey(m), shortRunLabel(m.runId ?? runId, allRunIds));
      }
    }
    return map;
  }, [multipleRuns, effectiveMetrics, allRunIds, runId, runMetaVersion]);

  const renderMultiVideo = (inModal: boolean) => (
    <>
      <MultiPaneGrid
        paneKeys={paneKeys}
        labels={paneLabels}
        inModal={inModal}
        paneWidths={settings.paneWidths}
        onPaneWidthsChange={(w) => updateSettings({ paneWidths: w })}
        renderPane={(key, i) => {
          const m = effectiveMetrics[i]!;
          return (
            <VideoPane
              key={key}
              runId={runId}
              m={m}
              targetStep={currentStep}
              settings={settings}
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
      {!hasSelectionProvider && (
        <RunSelectionPanel
          selectedRunIds={selectedArray}
          allRunIds={allRunIds}
          onClear={clear}
          runInfo={runInfoMap}
          label="Video selection"
        />
      )}
    </>
  );

  const renderContent = (inModal: boolean) =>
    isMulti ? renderMultiVideo(inModal) : renderSingleVideo(inModal ? "max-h-[70vh]" : "max-h-64");

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={350}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "video/mp4")) : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType="video" series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      settingsPanel={
        <>
          <Toggle
            label="Autoplay"
            checked={settings.autoplay}
            onChange={(v) => updateSettings({ autoplay: v })}
          />
          <Toggle
            label="Loop"
            checked={settings.loop}
            onChange={(v) => updateSettings({ loop: v })}
          />
          <Toggle
            label="Muted"
            checked={settings.muted}
            onChange={(v) => updateSettings({ muted: v })}
          />
          <Select<VideoSettings["preload"]>
            label="Preload"
            value={settings.preload}
            onChange={(v) => updateSettings({ preload: v })}
            options={[
              { value: "metadata", label: "Metadata" },
              { value: "auto", label: "Auto (full)" },
              { value: "none", label: "None" },
            ]}
          />
        </>
      }
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      scrollIntoViewOnMount={autoOpenSettings}
      modalContent={
        <div className="flex flex-col h-full">
          {renderContent(true)}
          {!hasSelectionProvider && (
            <RunSelectionPanel
              selectedRunIds={selectedArray}
              allRunIds={allRunIds}
              onClear={clear}
              runInfo={runInfoMap}
              label="Video selection"
            />
          )}
        </div>
      }
    >
      <>
      {renderContent(false)}
      </>
    </CardShell>
  );
}
