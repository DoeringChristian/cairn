import { useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename, exportChartFromContainer, safeName } from "../lib/download";
import { api } from "../api/client";
import { useCardSettings, resolveCardHeight, type CardSettingsKey } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import AddToComparisonButton from "./AddToComparisonButton";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import CardDetailModal from "./CardDetailModal";
import StepSlider, { type XAxisMode } from "./StepSlider";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
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
  height1?: number;
  height2?: number;
  colSpan?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_HISTOGRAM_SETTINGS: HistogramSettings = { version: 1 };

function fmtSig(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  return Number(n.toPrecision(sig)).toString();
}

export default function HistogramCard({ runId, metric, settingsKeyOverride, onRemove }: Props) {
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
    () => settingsKeyOverride ?? {
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    },
    [settingsKeyOverride, runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings] = useCardSettings(settingsKey, DEFAULT_HISTOGRAM_SETTINGS);

  const [expanded, setExpanded] = useState(false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );


  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"} of ${points.length}`
      : `${metric.count} pts`;

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
        onDownload={() => { if (cardRef.current) exportChartFromContainer(cardRef.current, safeName(settings.title ?? metric.name), "svg"); }}
      >
        <AddToComparisonButton cardType="histogram" series={compSeries} />
      </CardHeader>
      {!settings.collapsed && (<>
      {q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash && meta ? (
        <>
          <div className="flex-1 min-h-0 overflow-auto">
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
          </div>
          <StepSlider
            points={points}
            currentIndex={safeIdx}
            onChange={setIdx}
            xAxis={settings.xAxis}
            onXAxisChange={(m) => updateSettings({ xAxis: m })}
            className="mt-3"
          />
        </>
      ) : (
        <div className="text-sm text-fg-muted">no histogram logged yet</div>
      )}

      <CardDetailModal
        open={expanded}
        onClose={() => setExpanded(false)}
        title={settings.title ?? metric.name}
        settingsContent={
          <p className="text-xs text-fg-subtle">
            No settings yet. Full histogram visualization (bin counts + axis
            scale) is coming in a later pass.
          </p>
        }
      >
        {q.isLoading ? (
          <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
        ) : current?.artifact_hash && meta ? (
          <div className="flex flex-col h-full">
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
            <StepSlider
              points={points}
              currentIndex={safeIdx}
              onChange={setIdx}
              xAxis={settings.xAxis}
              onXAxisChange={(m) => updateSettings({ xAxis: m })}
              className="mt-3"
            />
          </div>
        ) : (
          <div className="text-sm text-fg-muted">no histogram logged yet</div>
        )}
      </CardDetailModal>

      </>)}
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 3}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<HistogramSettings>)}
      />
    </div>
  );
}
