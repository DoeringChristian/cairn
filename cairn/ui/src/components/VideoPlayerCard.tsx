import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse, formatRelative } from "../lib/format";
import { useCardSettings } from "../lib/card-settings";
import { useSeriesDrop } from "../lib/use-series-drop";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import type { SequenceMeta, SequenceResponse, SequencePoint } from "../api/types";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SplitPane from "./SplitPane";
import SeriesChip , { type SeriesRef } from "./SeriesChip";
import SettingsPopover from "./SettingsPopover";
import Toggle from "./settings/Toggle";
import Select from "./settings/Select";

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
}

interface VideoSettings {
  version: 1;
  metrics: Array<{ runId?: string; name: string; context_hash: string }>;
  paneWidths?: number[];
  title?: string;
  height?: number;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  preload: "metadata" | "auto" | "none";
}

const SERIES_COLORS = [
  "#0969da",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

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

function seriesKey(m: { runId?: string; name: string; context_hash: string }): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

function shortRunId(id: string): string {
  return id.length > 6 ? id.slice(0, 6) : id;
}

function seriesLabel(
  name: string,
  contextHash: string,
  runId: string | undefined,
  includeRun: boolean,
): string {
  const parts: string[] = [name];
  if (includeRun && runId) parts.push(shortRunId(runId));
  if (contextHash) parts.push(contextHash.slice(0, 6));
  return parts.join(" \u00B7 ");
}

// ---------------------------------------------------------------------------
// Single video pane (used in multi-series split view).
// ---------------------------------------------------------------------------
function VideoPane({
  runId,
  m,
  stepIdx,
  settings,
}: {
  runId: string;
  m: { runId?: string; name: string; context_hash: string };
  stepIdx: number;
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
  const safeIdx = Math.min(Math.max(0, stepIdx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
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

export default function VideoPlayerCard({ runId, metric, extraContexts = [] }: Props) {
  const seedMetric = useMemo(
    () => ({ name: metric.name, context_hash: metric.context_hash }),
    [metric.name, metric.context_hash],
  );

  const defaults = useMemo<VideoSettings>(() => {
    const all: Array<{ runId?: string; name: string; context_hash: string }> = [
      seedMetric,
      ...(extraContexts ?? []).map((e) => ({
        name: e.name,
        context_hash: e.context_hash,
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
  }, [seedMetric, extraContexts]);

  const [settings, updateSettings, resetSettings] = useCardSettings<VideoSettings>(
    {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    defaults,
  );

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const metricsRef = useRef(settings.metrics);
  metricsRef.current = settings.metrics;

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
    queries: settings.metrics.length > 1
      ? settings.metrics.map((m) => {
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

  const maxStepCount = useMemo(() => {
    if (settings.metrics.length <= 1) return points.length;
    let max = 0;
    for (const mq of multiQueries) {
      const pts = (mq.data as SequenceResponse | undefined)?.points?.filter(
        (p: SequencePoint) => p.artifact_hash,
      );
      if (pts && pts.length > max) max = pts.length;
    }
    return max;
  }, [settings.metrics.length, points.length, multiQueries]);

  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, maxStepCount - 1));
  const current = points[safeIdx];
  const meta = safeJsonParse<VideoMetadata>(current?.artifact_metadata);

  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
        type: "video",
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

  const multipleRuns = useMemo(() => {
    const seen = new Set<string>();
    for (const m of settings.metrics) seen.add(m.runId ?? runId);
    return seen.size > 1;
  }, [settings.metrics, runId]);

  const subtitle =
    maxStepCount > 0
      ? `step ${current?.step ?? safeIdx} of ${maxStepCount}`
      : `${metric.count} pts`;

  const isMulti = settings.metrics.length > 1;

  return (
    <div
      className={`card p-4${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{ minHeight: settings.height ?? undefined, position: "relative" }}
      {...dropProps}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
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
        <button
          ref={settingsBtnRef}
          type="button"
          aria-label="Card settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((v) => !v)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
        >
          {"\u2699"}
        </button>
      </CardHeader>

      {isMulti ? (
        <>
          <SplitPane
            widths={settings.paneWidths ?? Array(settings.metrics.length).fill(1 / settings.metrics.length)}
            onWidthsChange={(w) => updateSettings({ paneWidths: w })}
          >
            {settings.metrics.map((m) => (
              <VideoPane
                key={seriesKey(m)}
                runId={runId}
                m={m}
                stepIdx={safeIdx}
                settings={settings}
              />
            ))}
          </SplitPane>
          {maxStepCount > 1 && (
            <input
              type="range"
              min={0}
              max={maxStepCount - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
          {/* Series chip strip */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {settings.metrics.map((m, i) => {
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
                  label={seriesLabel(m.name, m.context_hash, m.runId, multipleRuns)}
                  runId={runId}
                  onRemove={
                    settings.metrics.length > 1
                      ? () => {
                          const next = settings.metrics.filter((_, j) => j !== i);
                          updateSettings({ metrics: next });
                        }
                      : undefined
                  }
                />
              );
            })}
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
              className="max-h-64 object-contain"
            />
          </div>
          {meta && (
            <div className="mono mt-2 text-xs text-fg-subtle">
              {meta.width}{"\u00D7"}{meta.height} {"\u00B7"} {meta.num_frames} frames @ {meta.fps}
              fps
            </div>
          )}
          {points.length > 1 && (
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no video logged yet</div>
      )}
      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Video"
      >
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
        <button
          type="button"
          onClick={() => resetSettings()}
          className="btn w-full mt-2"
        >
          Reset to defaults
        </button>
      </SettingsPopover>

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
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
      />
    </div>
  );
}
