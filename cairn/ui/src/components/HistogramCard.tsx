import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { safeJsonParse, formatRelative } from "../lib/format";
import { useCardSettings } from "../lib/card-settings";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import type { SequenceMeta } from "../api/types";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SettingsPopover from "./SettingsPopover";

interface Props {
  runId: string;
  metric: SequenceMeta;
}

interface HistogramMeta {
  num_bins: number;
  min: number;
  max: number;
  count: number;
  mean: number;
}

interface HistogramSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  height?: number;
  fullWidth?: boolean;
}

const DEFAULT_HISTOGRAM_SETTINGS: HistogramSettings = { version: 1 };

function fmtSig(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  return Number(n.toPrecision(sig)).toString();
}

export default function HistogramCard({ runId, metric }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
  const meta = useMemo(
    () => safeJsonParse<HistogramMeta>(current?.artifact_metadata),
    [current],
  );

  const settingsKey = useMemo(
    () => ({
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    }),
    [runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings] = useCardSettings(settingsKey, DEFAULT_HISTOGRAM_SETTINGS);

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
        type: "histogram",
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

  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"} of ${points.length}`
      : `${metric.count} pts`;

  return (
    <div className="card p-4" style={{ minHeight: settings.height ?? undefined, position: "relative", gridColumn: settings.fullWidth ? "1 / -1" : undefined }}>
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
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
          onClick={() => setSettingsOpen((v) => !v)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
          aria-label="Histogram settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title="Histogram settings"
        >
          {"\u2699"}
        </button>
      </CardHeader>
      {!settings.collapsed && (<>
      {q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash && meta ? (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-muted">
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
          <p className="text-xs text-fg-subtle mt-2">
            Bin counts available in the raw artifact blob.
          </p>
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
        <div className="text-sm text-fg-muted">no histogram logged yet</div>
      )}

      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Histogram"
      >
        <p className="text-xs text-fg-subtle">
          No settings yet. Full histogram visualization (bin counts + axis
          scale) is coming in a later pass.
        </p>
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
      </>)}
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        fullWidth={settings.fullWidth ?? false}
        onFullWidthToggle={() => updateSettings({ fullWidth: !settings.fullWidth })}
      />
    </div>
  );
}
