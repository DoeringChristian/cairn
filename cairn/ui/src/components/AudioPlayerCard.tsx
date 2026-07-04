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
import Toggle from "./settings/Toggle";
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

interface AudioMeta {
  sample_rate: number;
  duration: number;
  channels: number;
  peaks: number[];
  num_samples: number;
}

interface AudioSettings extends BaseCardSettings {
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  sliderStep?: number;
  autoplay: boolean;
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_AUDIO_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): AudioSettings => ({
  version: 1,
  metrics: [seed],
  autoplay: false,
});

const ACCENT = "#0969da";

function Waveform({ peaks }: { peaks: number[] }) {
  const width = 320;
  const height = 48;
  const n = peaks.length;
  if (n === 0) return null;
  const slot = width / n;
  const barW = Math.max(1, slot * 0.7);
  const mid = height / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-12 w-full"
      aria-hidden="true"
    >
      {peaks.map((p, i) => {
        const clamped = Math.max(0, Math.min(1, p));
        const h = clamped * mid;
        const x = i * slot + (slot - barW) / 2;
        return (
          <rect
            key={i}
            x={x}
            y={mid - h}
            width={barW}
            height={h * 2}
            fill={ACCENT}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Single audio pane (used in multi-series split view).
// ---------------------------------------------------------------------------
function AudioPane({
  runId,
  m,
  targetStep,
  autoplay,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  targetStep: number;
  autoplay: boolean;
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
  // Point at or closest below target step; fall back to the first point so a
  // late-starting series still shows its earliest audio (see report divergence).
  const current = useMemo(
    () => resolveAtStep(points, targetStep) ?? points[0],
    [points, targetStep],
  );
  const meta = useMemo(
    () => safeJsonParse<AudioMeta>(current?.artifact_metadata),
    [current],
  );

  if (q.isLoading) {
    return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
  }
  if (!current?.artifact_hash) {
    return <div className="text-sm text-fg-muted">no audio logged yet</div>;
  }
  return (
    <div className="rounded bg-bg p-2">
      {meta?.peaks && meta.peaks.length > 0 ? (
        <Waveform peaks={meta.peaks} />
      ) : (
        <div className="h-12" />
      )}
      <audio
        key={current.artifact_hash}
        controls
        autoPlay={autoplay}
        src={api.artifactUrl(current.artifact_hash)}
        className="mt-2 w-full"
      />
      {meta && (
        <div className="mono mt-1 text-xs text-fg-subtle">
          {`${meta.sample_rate} Hz \u00B7 ${meta.duration}s \u00B7 ${
            meta.channels === 1
              ? "mono"
              : meta.channels === 2
                ? "stereo"
                : `${meta.channels}ch`
          }`}
        </div>
      )}
    </div>
  );
}

export default function AudioPlayerCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
  const { settings, updateSettings, effectiveMetrics, allRunIds, multipleRuns } =
    useCardSeries<AudioSettings>({
      runId,
      metric,
      extraSeries,
      controlledSeries,
      settingsKeyOverride,
      makeDefaults: (seed, metrics) => ({
        ...DEFAULT_AUDIO_SETTINGS(seed),
        metrics,
      }),
    });

  const { highlight: dropHighlight, dropProps } = useCardDrop(effectiveMetrics, updateSettings);

  // Single-metric path: fetch points for the step slider.
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );

  // Multi-metric: fetch all sequences to determine max step count.
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

  const meta = useMemo(
    () => safeJsonParse<AudioMeta>(current?.artifact_metadata),
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
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const cardRef = useRef<HTMLDivElement>(null);

  const renderSingleAudio = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash) {
      return <div className="text-sm text-fg-muted">no audio logged yet</div>;
    }
    return (
      <>
        <div className="rounded bg-bg p-2">
          {meta?.peaks && meta.peaks.length > 0 ? (
            <Waveform peaks={meta.peaks} />
          ) : (
            <div className="h-12" />
          )}
          <audio
            key={current.artifact_hash}
            controls
            autoPlay={settings.autoplay}
            src={api.artifactUrl(current.artifact_hash)}
            className="mt-2 w-full"
          />
          {meta && (
            <div className="mono mt-1 text-xs text-fg-subtle">
              {`${meta.sample_rate} Hz · ${meta.duration}s · ${
                meta.channels === 1
                  ? "mono"
                  : meta.channels === 2
                    ? "stereo"
                    : `${meta.channels}ch`
              }`}
            </div>
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

  const renderMultiAudio = (inModal: boolean) => (
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
            <AudioPane
              key={key}
              runId={runId}
              m={m}
              targetStep={currentStep}
              autoplay={settings.autoplay}
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
    isMulti ? renderMultiAudio(inModal) : renderSingleAudio();

  const selectionPanel = !hasSelectionProvider && (
    <RunSelectionPanel
      selectedRunIds={selectedArray}
      allRunIds={allRunIds}
      onClear={clear}
      runInfo={runInfoMap}
      label="Audio selection"
    />
  );

  return (
    <CardShell cardKind="audio"
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "audio/wav")) : undefined}
      addToComparisonSlot={<AddToComparisonButton cardType="audio" series={compSeries} />}
      dropHighlight={dropHighlight}
      dropProps={dropProps}
      selectionPanel={selectionPanel}
      settingsPanel={
        <Toggle
          label="Autoplay"
          checked={settings.autoplay}
          onChange={(v) => updateSettings({ autoplay: v })}
          description="Play the clip automatically when the card loads"
        />
      }
      modalOpen={expanded}
      onModalClose={() => setExpanded(false)}
      modalContent={<div className="flex flex-col h-full">{renderContent(true)}</div>}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>
      {renderContent(false)}
      </>
    </CardShell>
  );
}
