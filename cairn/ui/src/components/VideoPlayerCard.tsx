import { useCallback, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { useCardSettings, resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import type { ComparisonSeriesRef } from "../lib/comparisons";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import { SERIES_COLORS } from "../lib/colors";
import { seriesKey, seriesLabel } from "../lib/series-utils";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import AddToComparisonButton from "./AddToComparisonButton";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import CardDetailModal from "./CardDetailModal";
import SplitPane from "./SplitPane";
import SeriesChip , { type SeriesRef } from "./SeriesChip";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";
import StepSlider, { type XAxisMode } from "./StepSlider";

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
  extraContexts?: SequenceMeta[];
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
}

interface VideoSettings {
  version: 1;
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  title?: string;
  collapsed?: boolean;
  sliderStep?: number;
  height?: number;
  height1?: number;
  height2?: number;
  colSpan?: number;
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
  const current = useMemo(() => {
    const exact = points.find((p) => p.step === targetStep);
    if (exact) return exact;
    let best: (typeof points)[number] | undefined;
    for (const p of points) { if (p.step <= targetStep) best = p; else break; }
    return best;
  }, [points, targetStep]);
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

export default function VideoPlayerCard({ runId, metric, extraContexts = [], extraSeries, controlledSeries, settingsKeyOverride, onRemove }: Props) {
  const seedMetric = useMemo(
    () => ({ name: metric.name, context_hash: metric.context_hash }),
    [metric.name, metric.context_hash],
  );

  const extraSeriesKey = useMemo(
    () => (extraSeries ?? []).map((s) => `${s.runId}::${s.name}::${s.context_hash}`).sort().join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify((extraSeries ?? []).map((s) => [s.runId, s.name, s.context_hash]).sort())],
  );

  const defaults = useMemo<VideoSettings>(() => {
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      seedMetric,
      ...(extraContexts ?? []).map((e) => ({
        name: e.name,
        context_hash: e.context_hash,
      })),
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
    return { ...DEFAULT_VIDEO_SETTINGS(seedMetric), metrics: unique };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMetric, extraContexts, extraSeriesKey]);

  const [settings, updateSettings, resetSettings] = useCardSettings<VideoSettings>(
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
      ...(extraContexts ?? []).map((e) => ({
        name: e.name,
        context_hash: e.context_hash,
      })),
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
  }, [controlledSeries, settings.metrics, metric.name, metric.context_hash, extraContexts, extraSeriesKey]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const metricsRef = useRef(effectiveMetrics);
  metricsRef.current = effectiveMetrics;

  const { highlight: dropHighlight, dropProps } = useSeriesDrop({
    metricsRef,
    onMetricsChange: useCallback(
      (next) => updateSettings({ metrics: next }),
      [updateSettings],
    ),
  });

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
  const meta = safeJsonParse<VideoMetadata>(current?.artifact_metadata);

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

  const subtitle =
    globalSteps.length > 0
      ? `step ${currentStep} (${safeIdx + 1}/${globalSteps.length})`
      : `${metric.count} pts`;

  const isMulti = effectiveMetrics.length > 1;
  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        minHeight: resolveCardHeight(settings, 350),
        position: "relative",
        gridColumn: `span ${settings.colSpan ?? 3}`,
      }}
      {...dropProps}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onRemove={onRemove}
        onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "video/mp4")) : undefined}
        addToComparisonSlot={<AddToComparisonButton cardType="video" series={compSeries} />}
      />

      {!settings.collapsed && (<>
      {isMulti ? (
        <>
          <div
            className="grid gap-1 flex-1 min-h-0 overflow-auto"
            style={{ gridTemplateColumns: `repeat(${Math.min(effectiveMetrics.length, 2)}, 1fr)` }}
          >
            {effectiveMetrics.map((m) => (
              <div key={seriesKey(m)} className="relative overflow-hidden">
                <VideoPane
                  runId={runId}
                  m={m}
                  targetStep={currentStep}
                  settings={settings}
                />
                {multipleRuns && (
                  <span className="absolute top-1 left-1 z-10 rounded bg-bg/80 px-1.5 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm">
                    {shortRunLabel(m.runId ?? runId, allRunIds)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <StepSlider
            points={points}
            currentIndex={safeIdx}
            onChange={handleSliderChange}
            xAxis={settings.xAxis}
            onXAxisChange={(m) => updateSettings({ xAxis: m })}
            className="mt-3"
          />
          {/* Series chip strip */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {controlledSeries ? (
              /* Tag-level chips in workspace/comparison mode */
              (() => {
                const seen = new Set<string>();
                const tags: Array<{ name: string; color: string; firstIdx: number }> = [];
                for (let i = 0; i < effectiveMetrics.length; i++) {
                  const m = effectiveMetrics[i]!;
                  if (seen.has(m.name)) continue;
                  seen.add(m.name);
                  tags.push({ name: m.name, color: SERIES_COLORS[tags.length % SERIES_COLORS.length]!, firstIdx: i });
                }
                return tags.map((tag) => {
                  const m = effectiveMetrics[tag.firstIdx]!;
                  const ref: SeriesRef = { runId: m.runId, name: m.name, context_hash: m.context_hash };
                  return (
                    <SeriesChip
                      key={tag.name}
                      series={ref}
                      color={tag.color}
                      label={tag.name}
                      runId={runId}
                      onRemove={
                        tags.length > 1
                          ? () => {
                              const next = effectiveMetrics.filter((x) => x.name !== tag.name);
                              updateSettings({ metrics: next });
                            }
                          : undefined
                      }
                    />
                  );
                });
              })()
            ) : (
              /* Per-run series chips */
              effectiveMetrics.map((m, i) => {
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
                    label={seriesLabel(m.name, m.context_hash, m.runId, multipleRuns, allRunIds)}
                    runId={runId}
                    onRemove={
                      effectiveMetrics.length > 1
                        ? () => {
                            const next = effectiveMetrics.filter((_, j) => j !== i);
                            updateSettings({ metrics: next });
                          }
                        : undefined
                    }
                  />
                );
              })
            )}
          </div>
        </>
      ) : q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
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
              className="max-h-64 object-contain"
            />
          </div>
          {meta && (
            <div className="mono mt-2 text-xs text-fg-subtle">
              {meta.width}{"\u00D7"}{meta.height} {"\u00B7"} {meta.num_frames} frames @ {meta.fps}
              fps
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
        </>
      ) : (
        <div className="text-sm text-fg-muted">no video logged yet</div>
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
      >
        <div className="flex flex-col h-full">
          {isMulti ? (
            <>
              <SplitPane
                widths={settings.paneWidths ?? Array(effectiveMetrics.length).fill(1 / effectiveMetrics.length)}
                onWidthsChange={(w) => updateSettings({ paneWidths: w })}
              >
                {effectiveMetrics.map((m) => (
                  <VideoPane
                    key={seriesKey(m)}
                    runId={runId}
                    m={m}
                    targetStep={currentStep}
                    settings={settings}
                  />
                ))}
              </SplitPane>
              <StepSlider
                points={points}
                currentIndex={safeIdx}
                onChange={handleSliderChange}
                xAxis={settings.xAxis}
                onXAxisChange={(m) => updateSettings({ xAxis: m })}
                className="mt-3"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {controlledSeries ? (
                  (() => {
                    const seen = new Set<string>();
                    const tags: Array<{ name: string; color: string; firstIdx: number }> = [];
                    for (let i = 0; i < effectiveMetrics.length; i++) {
                      const m = effectiveMetrics[i]!;
                      if (seen.has(m.name)) continue;
                      seen.add(m.name);
                      tags.push({ name: m.name, color: SERIES_COLORS[tags.length % SERIES_COLORS.length]!, firstIdx: i });
                    }
                    return tags.map((tag) => {
                      const m = effectiveMetrics[tag.firstIdx]!;
                      const ref: SeriesRef = { runId: m.runId, name: m.name, context_hash: m.context_hash };
                      return (
                        <SeriesChip
                          key={tag.name}
                          series={ref}
                          color={tag.color}
                          label={tag.name}
                          runId={runId}
                          onRemove={
                            tags.length > 1
                              ? () => {
                                  const next = effectiveMetrics.filter((x) => x.name !== tag.name);
                                  updateSettings({ metrics: next });
                                }
                              : undefined
                          }
                        />
                      );
                    });
                  })()
                ) : (
                  effectiveMetrics.map((m, i) => {
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
                        label={seriesLabel(m.name, m.context_hash, m.runId, multipleRuns, allRunIds)}
                        runId={runId}
                        onRemove={
                          effectiveMetrics.length > 1
                            ? () => {
                                const next = effectiveMetrics.filter((_, j) => j !== i);
                                updateSettings({ metrics: next });
                              }
                            : undefined
                        }
                      />
                    );
                  })
                )}
              </div>
            </>
          ) : q.isLoading ? (
            <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
          ) : current?.artifact_hash ? (
            <>
              <div className="flex justify-center rounded bg-bg p-2">
                <video
                  key={current.artifact_hash}
                  controls
                  autoPlay={settings.autoplay}
                  loop={settings.loop}
                  muted={settings.muted}
                  preload={settings.preload}
                  src={api.artifactUrl(current.artifact_hash)}
                  poster={meta?.preview}
                  className="max-h-[70vh] object-contain"
                />
              </div>
              {meta && (
                <div className="mono mt-2 text-xs text-fg-subtle">
                  {meta.width}{"\u00D7"}{meta.height} {"\u00B7"} {meta.num_frames} frames @ {meta.fps} fps
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
            </>
          ) : (
            <div className="text-sm text-fg-muted">no video logged yet</div>
          )}
        </div>
      </CardDetailModal>

      </>)}
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 3}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<VideoSettings>)}
      />
    </div>
  );
}
