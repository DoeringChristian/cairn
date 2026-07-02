import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import { useCardDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { seriesKey } from "../lib/series-utils";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import type { BaseCardSettings } from "./card-kit";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import CardDetailModal from "./CardDetailModal";
import SplitPane from "./SplitPane";
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
  // Find point at or closest below target step.
  const safeIdx = useMemo(() => {
    let best = 0;
    for (let i = 0; i < points.length; i++) {
      if (points[i]!.step <= targetStep) best = i;
      else break;
    }
    return best;
  }, [points, targetStep]);
  const current = points[safeIdx];
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

export default function AudioPlayerCard({ runId, metric, extraSeries, controlledSeries, settingsKeyOverride, onRemove }: Props) {
  const seedMetric = useMemo(
    () => ({ name: metric.name, context_hash: metric.context_hash }),
    [metric.name, metric.context_hash],
  );

  const extraSeriesKey = useMemo(
    () => (extraSeries ?? []).map((s) => `${s.runId}::${s.name}::${s.context_hash}`).sort().join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify((extraSeries ?? []).map((s) => [s.runId, s.name, s.context_hash]).sort())],
  );

  const defaults = useMemo<AudioSettings>(() => {
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      seedMetric,
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const seen = new Set<string>();
    const unique = all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...DEFAULT_AUDIO_SETTINGS(seedMetric), metrics: unique };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMetric, extraSeriesKey]);

  const [settings, updateSettings] = useCardSettings<AudioSettings>(
    settingsKeyOverride ?? {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    defaults,
  );

  const effectiveMetrics = useMemo(() => {
    if (!controlledSeries) return settings.metrics;
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      { name: metric.name, context_hash: metric.context_hash },
      ...(extraSeries ?? []).map((s) => ({
        runId: s.runId,
        name: s.name,
        context_hash: s.context_hash,
      })),
    ];
    const seen = new Set<string>();
    return all.filter((m) => {
      const k = seriesKey(m);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSeries, settings.metrics, metric.name, metric.context_hash, extraSeriesKey]);

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

  const globalSteps = useMemo(() => {
    const stepSet = new Set<number>();
    for (const p of points) if (p.artifact_hash) stepSet.add(p.step);
    if (effectiveMetrics.length > 1) {
      for (const mq of multiQueries) {
        const pts = (mq.data as SequenceResponse | undefined)?.points ?? [];
        for (const p of pts) if (p.artifact_hash) stepSet.add(p.step);
      }
    }
    return Array.from(stepSet).sort((a, b) => a - b);
  }, [effectiveMetrics.length, points, multiQueries]);

  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const handleSliderChange = (newIdx: number) => {
    setIdx(newIdx);
    updateSettings({ sliderStep: newIdx });
  };
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, globalSteps.length - 1));
  const currentStep = globalSteps[safeIdx] ?? 0;
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

  const [expanded, setExpanded] = useState(false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );

  const allRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of effectiveMetrics) ids.add(m.runId ?? runId);
    return [...ids];
  }, [effectiveMetrics, runId]);

  const multipleRuns = allRunIds.length > 1;

  useRunMetadataVersion();

  const { selectedIds, selectedArray, toggle, clear } = useRunSelection();
  const hasSelectionProvider = useRunSelectionHasProvider();

  const runQueries = useQueries({
    queries: allRunIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 5_000,
    })),
  });

  const runInfoMap = useMemo(() => {
    const m = new Map<string, { displayName?: string; projectId?: string }>();
    allRunIds.forEach((rid, i) => {
      const d = runQueries[i]?.data;
      if (d) m.set(rid, { displayName: d.run.display_name || undefined, projectId: d.run.project_id });
    });
    return m;
  }, [allRunIds, runQueries]);

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
          onChange={handleSliderChange}
          xAxis={settings.xAxis}
          onXAxisChange={(m) => updateSettings({ xAxis: m })}
          className="mt-3"
        />
      </>
    );
  };

  const renderMultiAudio = (inModal: boolean) => (
    <>
      {inModal ? (
        <SplitPane
          widths={settings.paneWidths ?? Array(effectiveMetrics.length).fill(1 / effectiveMetrics.length)}
          onWidthsChange={(w) => updateSettings({ paneWidths: w })}
        >
          {effectiveMetrics.map((m) => (
            <AudioPane
              key={seriesKey(m)}
              runId={runId}
              m={m}
              targetStep={currentStep}
              autoplay={settings.autoplay}
            />
          ))}
        </SplitPane>
      ) : (
        <div
          className="grid gap-1 flex-1 min-h-0 overflow-auto"
          style={{ gridTemplateColumns: `repeat(${Math.min(effectiveMetrics.length, 2)}, 1fr)` }}
        >
          {effectiveMetrics.map((m) => (
            <div key={seriesKey(m)} className="relative overflow-hidden">
              <AudioPane
                runId={runId}
                m={m}
                targetStep={currentStep}
                autoplay={settings.autoplay}
              />
              {multipleRuns && (
                <span className="absolute top-1 left-1 z-10 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm">
                  {shortRunLabel(m.runId ?? runId, allRunIds)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <StepSlider
        points={points}
        currentIndex={safeIdx}
        onChange={handleSliderChange}
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

  return (
    <CardShell
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
    >
      <>
      {renderContent(false)}
      {!hasSelectionProvider && (
        <RunSelectionPanel
          selectedRunIds={selectedArray}
          allRunIds={allRunIds}
          onClear={clear}
          runInfo={runInfoMap}
          label="Audio selection"
        />
      )}
      <CardDetailModal
        open={expanded}
        onClose={() => setExpanded(false)}
        title={settings.title ?? metric.name}
        settingsContent={
          <>
            <Toggle
              label="Autoplay"
              checked={settings.autoplay}
              onChange={(v) => updateSettings({ autoplay: v })}
              description="Play the clip automatically when the card loads"
            />
          </>
        }
      >
        <div className="flex flex-col h-full">
          {renderContent(true)}
          {!hasSelectionProvider && (
            <RunSelectionPanel
              selectedRunIds={selectedArray}
              allRunIds={allRunIds}
              onClear={clear}
              runInfo={runInfoMap}
              label="Audio selection"
            />
          )}
        </div>
      </CardDetailModal>
      </>
    </CardShell>
  );
}
