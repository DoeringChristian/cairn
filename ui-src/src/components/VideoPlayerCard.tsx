import { useState, useMemo } from "react";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import type { SequenceMeta } from "../api/types";

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
}

export default function VideoPlayerCard({ runId, metric }: Props) {
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
  const meta = safeJsonParse<VideoMetadata>(current?.artifact_metadata);

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="mono text-sm font-semibold">{metric.name}</h3>
        <span className="text-xs text-fg-subtle">
          {points.length > 0
            ? `step ${current?.step ?? "—"} of ${points.length}`
            : `${metric.count} pts`}
        </span>
      </div>
      {q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
        <>
          <div className="flex justify-center rounded bg-bg p-2">
            <video
              key={current.artifact_hash}
              controls
              preload="metadata"
              src={api.artifactUrl(current.artifact_hash)}
              poster={meta?.preview}
              className="max-h-64 object-contain"
            />
          </div>
          {meta && (
            <div className="mono mt-2 text-xs text-fg-subtle">
              {meta.width}×{meta.height} · {meta.num_frames} frames @ {meta.fps}
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
    </div>
  );
}
