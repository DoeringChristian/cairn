import { useState, useMemo } from "react";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import type { SequenceMeta } from "../api/types";

interface Props {
  runId: string;
  metric: SequenceMeta;
}

export default function ImageGalleryCard({ runId, metric }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 500,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];

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
        <div className="h-48 animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
        <>
          <div className="flex justify-center rounded bg-bg p-2">
            <img
              src={api.artifactUrl(current.artifact_hash)}
              alt={`${metric.name} @ step ${current.step}`}
              className="max-h-64 object-contain"
            />
          </div>
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
        <div className="text-sm text-fg-muted">no image logged yet</div>
      )}
    </div>
  );
}
