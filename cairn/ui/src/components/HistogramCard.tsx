import { useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename, exportChartFromContainer, safeName } from "../lib/download";
import { api } from "../api/client";
import { useCardSettings, type CardSettingsKey } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import AddToComparisonButton from "./AddToComparisonButton";
import CardShell from "./CardShell";
import CardDetailModal from "./CardDetailModal";
import StepSlider from "./StepSlider";
import type { BaseCardSettings } from "./card-kit";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
  autoOpenSettings?: boolean;
}

interface HistogramMeta {
  num_bins: number;
  min: number;
  max: number;
  count: number;
  mean: number;
}

interface HistogramSettings extends BaseCardSettings {
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_HISTOGRAM_SETTINGS: HistogramSettings = { version: 1 };

function fmtSig(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return "0";
  return Number(n.toPrecision(sig)).toString();
}

export default function HistogramCard({ runId, metric, settingsKeyOverride, onRemove, autoOpenSettings }: Props) {
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

  const [expanded, setExpanded] = useState(autoOpenSettings ?? false);

  const compSeries = useMemo(
    () => [{ runId, name: metric.name, context_hash: metric.context_hash }],
    [runId, metric.name, metric.context_hash],
  );


  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"} of ${points.length}`
      : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  const renderContent = () => {
    if (q.isLoading) {
      return <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />;
    }
    if (!current?.artifact_hash || !meta) {
      return <div className="text-sm text-fg-muted">no histogram logged yet</div>;
    }
    return (
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
    );
  };

  return (
    <CardShell
      cardRef={cardRef}
      settings={settings}
      updateSettings={updateSettings}
      title={metric.name}
      subtitle={subtitle}
      defaultHeight={250}
      onSettings={() => setExpanded(true)}
      onRemove={onRemove}
      onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, current.artifact_mime)) : undefined}
      onScreenshot={() => { if (cardRef.current) exportChartFromContainer(cardRef.current, safeName(settings.title ?? metric.name), "svg"); }}
      addToComparisonSlot={<AddToComparisonButton cardType="histogram" series={compSeries} />}
      scrollIntoViewOnMount={autoOpenSettings}
    >
      <>
      {renderContent()}

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
        <div className="flex flex-col h-full">
          {renderContent()}
        </div>
      </CardDetailModal>
      </>
    </CardShell>
  );
}
