import { useEffect, useState, useMemo, useRef } from "react";
import { useSequence } from "../api/hooks";
import { useCardSettings, resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import {  } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";
import CardDetailModal from "./CardDetailModal";
import AddToComparisonButton from "./AddToComparisonButton";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import Select from "./settings/Select";
import Toggle from "./settings/Toggle";
import StepSlider, { type XAxisMode } from "./StepSlider";

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
  height1?: number;
  height2?: number;
  colSpan?: number;
  fontSize: "xs" | "sm" | "base";
  wordWrap: boolean;
  xAxis?: "step" | "relative_time" | "wall_time";
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

  // Fetch the artifact's bytes lazily when the hash changes.
  useEffect(() => {
    if (!current?.artifact_hash) {
      setContent("");
      return;
    }
    let cancelled = false;
    fetch(`/api/artifacts/${current.artifact_hash}`)
      .then((r) => r.text())
      .then((text) => { if (!cancelled) setContent(text); })
      .catch((e) => { if (!cancelled) setContent(`<fetch error: ${e.message}>`); });
    return () => { cancelled = true; };
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

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );


  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"}`
      : `${metric.count} pts`;

  const wrapClass = settings.wordWrap
    ? "whitespace-pre-wrap break-all"
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
    </>
  );

  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={cardRef} className="card p-4 flex flex-col" style={{ height: resolveCardHeight(settings, 250), position: "relative", gridColumn: `span ${settings.colSpan ?? 3}` }}>
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={() => setExpanded(true)}
        onRemove={onRemove}
        onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current?.step ?? 0, "text/plain")) : undefined}
        addToComparisonSlot={<AddToComparisonButton cardType="text" series={compSeries} />}
      />
      {!settings.collapsed && (<>
      <pre
        className={`mono flex-1 min-h-0 overflow-auto ${wrapClass} rounded bg-bg p-3 ${FONT_SIZE_CLASS[settings.fontSize]} text-fg-muted`}
        style={{ maxHeight: undefined }}
      >
        {content}
      </pre>
      <StepSlider
        points={points}
        currentIndex={safeIdx}
        onChange={setIdx}
        xAxis={settings.xAxis}
        onXAxisChange={(m) => updateSettings({ xAxis: m })}
        className="mt-3"
      />

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

      </>)}
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 3}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<TextSettings>)}
      />
    </div>
  );
}
