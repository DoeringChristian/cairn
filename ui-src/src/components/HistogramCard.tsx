import { useMemo, useRef, useState } from "react";
import { useSequence } from "../api/hooks";
import { safeJsonParse } from "../lib/format";
import { useCardSettings } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import CardHeader from "./CardHeader";
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
  // Scaffolding only: settings aren't read anywhere yet.
  useCardSettings(settingsKey, DEFAULT_HISTOGRAM_SETTINGS);

  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"} of ${points.length}`
      : `${metric.count} pts`;

  return (
    <div className="card p-4">
      <CardHeader title={metric.name} subtitle={subtitle}>
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
    </div>
  );
}
