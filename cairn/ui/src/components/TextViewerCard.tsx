import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useSequence } from "../api/hooks";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import {
  addCardToComparison,
  createComparison,
  useComparisons,
} from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { formatRelative } from "../lib/format";
import type { SequenceMeta } from "../api/types";
import CardDetailModal from "./CardDetailModal";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import SettingsPopover from "./SettingsPopover";
import Select from "./settings/Select";
import Toggle from "./settings/Toggle";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
}

interface TextSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  height?: number;
  colSpan?: number;
  fontSize: "xs" | "sm" | "base";
  wordWrap: boolean;
}

const DEFAULT_TEXT_SETTINGS: TextSettings = {
  version: 1,
  fontSize: "xs",
  wordWrap: true,
};

const FONT_SIZE_CLASS: Record<TextSettings["fontSize"], string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

export default function TextViewerCard({ runId, metric, settingsKeyOverride, onRemove }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(() => q.data?.points ?? [], [q.data]);
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
  const [content, setContent] = useState<string>("");

  // Fetch the artifact's bytes lazily when the index changes.
  useMemo(() => {
    if (!current?.artifact_hash) {
      setContent("");
      return;
    }
    fetch(`/api/artifacts/${current.artifact_hash}`)
      .then((r) => r.text())
      .then(setContent)
      .catch((e) => setContent(`<fetch error: ${e.message}>`));
  }, [current?.artifact_hash]);

  const settingsKey = useMemo(
    () => settingsKeyOverride ?? {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    DEFAULT_TEXT_SETTINGS,
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
        type: "text",
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
      ? `step ${current?.step ?? "\u2014"}`
      : `${metric.count} pts`;

  const wrapClass = settings.wordWrap
    ? "whitespace-pre-wrap"
    : "whitespace-pre overflow-x-auto";

  const settingsPanel = (
    <>
      <Select
        label="Font size"
        value={settings.fontSize}
        onChange={(v) => updateSettings({ fontSize: v })}
        options={[
          { value: "xs", label: "Extra small" },
          { value: "sm", label: "Small" },
          { value: "base", label: "Base" },
        ]}
      />
      <Toggle
        label="Word wrap"
        checked={settings.wordWrap}
        onChange={(v) => updateSettings({ wordWrap: v })}
        description="Wrap long lines to card width. Off = horizontal scroll."
      />
      <button
        type="button"
        className="btn w-full mt-2"
        onClick={resetSettings}
      >
        Reset to defaults
      </button>
    </>
  );

  return (
    <div className="card p-4 flex flex-col" style={{ height: settings.collapsed ? undefined : (settings.height ?? 250), position: "relative", gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined }}>
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onToggleFullWidth={() => updateSettings({ colSpan: (settings.colSpan ?? 1) > 1 ? 1 : 2 })}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
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
      <pre
        className={`mono flex-1 min-h-0 overflow-auto ${wrapClass} rounded bg-bg p-3 ${FONT_SIZE_CLASS[settings.fontSize]} text-fg-muted`}
        style={{ maxHeight: undefined }}
      >
        {content}
      </pre>
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

      <CardDetailModal
        open={expanded}
        onClose={() => setExpanded(false)}
        title={settings.title ?? metric.name}
        settingsContent={settingsPanel}
      >
        <pre
          className={`mono flex-1 min-h-0 overflow-auto ${wrapClass} rounded bg-bg p-3 ${FONT_SIZE_CLASS[settings.fontSize]} text-fg-muted`}
        >
          {content}
        </pre>
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
      />
    </div>
  );
}
