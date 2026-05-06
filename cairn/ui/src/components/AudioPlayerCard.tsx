import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse, formatRelative } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { useCardSettings, resolveCardHeight, toggleColSpanPatch, type CardSettingsKey } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
  type ComparisonSeriesRef,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import type { SequenceMeta, SequenceResponse } from "../api/types";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import CardDetailModal from "./CardDetailModal";
import SplitPane from "./SplitPane";
import SeriesChip , { type SeriesRef } from "./SeriesChip";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import StepSlider, { type XAxisMode } from "./StepSlider";

interface Props {
  runId: string;
  metric: SequenceMeta;
  extraContexts?: SequenceMeta[];
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

interface AudioSettings {
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
  xAxis?: "step" | "relative_time" | "wall_time";
}

const SERIES_COLORS = [
  "#0969da",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

const DEFAULT_AUDIO_SETTINGS = (seed: {
  name: string;
  context_hash: string;
}): AudioSettings => ({
  version: 1,
  metrics: [seed],
  autoplay: false,
});

function seriesKey(m: { runId?: string; name: string; context_hash: string }): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

function seriesLabel(
  name: string,
  contextHash: string,
  runId: string | undefined,
  includeRun: boolean,
  siblingRunIds?: string[],
): string {
  if (includeRun && runId) {
    const parts: string[] = [shortRunLabel(runId, siblingRunIds)];
    if (contextHash) parts.push(contextHash.slice(0, 6));
    return parts.join(" \u00B7 ");
  }
  const parts: string[] = [name];
  if (contextHash) parts.push(contextHash.slice(0, 6));
  return parts.join(" \u00B7 ");
}

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

export default function AudioPlayerCard({ runId, metric, extraContexts = [], extraSeries, controlledSeries, settingsKeyOverride, onRemove }: Props) {
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
    return { ...DEFAULT_AUDIO_SETTINGS(seedMetric), metrics: unique };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedMetric, extraContexts, extraSeriesKey]);

  const [settings, updateSettings, resetSettings] = useCardSettings<AudioSettings>(
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
            queryKey: ["sequence", rid, m.name, m.context_hash],
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

  // "Add to comparison" popover state.
  const projectId = useProjectId();
  const { comparisons, refresh: refreshComparisons } =
    useComparisons(projectId ?? "");
  const addCompBtnRef = useRef<HTMLButtonElement | null>(null);
  const [addCompOpen, setAddCompOpen] = useState(false);
  const [addCompConfirm, setAddCompConfirm] = useState<string | null>(null);
  const addCompTimer = useRef<number | null>(null);
  const [newCompName, setNewCompName] = useState("");

  const addToComp = useCallback(
    (comparisonId: string, compName: string) => {
      if (!projectId) return;
      addCardToComparison(projectId, comparisonId, {
        type: "audio",
        series: [{ runId, name: metric.name, context_hash: metric.context_hash }],
      });
      refreshComparisons();
      if (addCompTimer.current != null) window.clearTimeout(addCompTimer.current);
      setAddCompConfirm(`Added to ${compName}`);
      addCompTimer.current = window.setTimeout(() => {
        setAddCompConfirm(null);
        setAddCompOpen(false);
      }, 1500);
    },
    [projectId, runId, metric.name, metric.context_hash, refreshComparisons],
  );

  const createAndAdd = useCallback(() => {
    if (!projectId) return;
    const name = newCompName.trim() || "New comparison";
    const cmp = createComparison(projectId, name);
    addToComp(cmp.id, cmp.name);
    setNewCompName("");
  }, [projectId, newCompName, addToComp]);

  useEffect(() => {
    return () => {
      if (addCompTimer.current != null) window.clearTimeout(addCompTimer.current);
    };
  }, []);

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
        height: resolveCardHeight(settings, undefined),
        position: "relative",
        gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined,
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
        onToggleFullWidth={() => updateSettings(toggleColSpanPatch(settings, cardRef.current) as Partial<AudioSettings>)}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
        onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime ?? "audio/wav")) : undefined}
      >
        {projectId && (
          <button
            ref={addCompBtnRef}
            type="button"
            onClick={() => setAddCompOpen((v) => !v)}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Add to comparison"
            aria-haspopup="dialog"
            aria-expanded={addCompOpen}
            title="Add to comparison"
          >
            {"\u002B"}
          </button>
        )}
      </CardHeader>

      {!settings.collapsed && (<>
      {isMulti ? (
        <>
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
        <div className="text-sm text-fg-muted">no audio logged yet</div>
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
          {isMulti ? (
            <>
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
            <div className="text-sm text-fg-muted">no audio logged yet</div>
          )}
        </div>
      </CardDetailModal>

      <SettingsPopover
        open={addCompOpen && projectId != null}
        onClose={() => { setAddCompOpen(false); setAddCompConfirm(null); }}
        anchorRef={addCompBtnRef}
        title="Add to comparison"
      >
        {addCompConfirm ? (
          <p className="text-xs text-accent">{addCompConfirm}</p>
        ) : (
          <>
            {comparisons.length === 0 ? (
              <p className="text-xs text-fg-subtle mb-2">No comparisons yet.</p>
            ) : (
              <div className="flex flex-col gap-1 mb-2 max-h-48 overflow-y-auto">
                {comparisons.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addToComp(c.id, c.name)}
                    className="text-left text-xs text-fg-muted hover:bg-bg-hover rounded px-2 py-1.5 border border-border-subtle"
                  >
                    <div className="truncate">{c.name}</div>
                    <div className="text-[10px] text-fg-subtle">
                      {c.cards.length} card(s) · {formatRelative(c.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-border-subtle pt-2 mt-1">
              <label className="text-[10px] uppercase tracking-wide text-fg-muted block mb-1">
                Create new comparison
              </label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={newCompName}
                  onChange={(e) => setNewCompName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createAndAdd(); } }}
                  placeholder="Name"
                  className="input flex-1 text-xs"
                />
                <button type="button" onClick={createAndAdd} className="btn text-xs px-2">
                  Create
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAddCompOpen(false)}
              className="btn w-full mt-2 text-xs"
            >
              Cancel
            </button>
          </>
        )}
      </SettingsPopover>
      </>)}
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 1}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<AudioSettings>)}
      />
    </div>
  );
}
