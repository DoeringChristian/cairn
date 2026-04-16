import { useState, useMemo } from "react";
import { useSequence } from "../api/hooks";
import type { SequenceMeta } from "../api/types";

interface Props {
  runId: string;
  metric: SequenceMeta;
}

export default function TextViewerCard({ runId, metric }: Props) {
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

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="mono text-sm font-semibold">{metric.name}</h3>
        <span className="text-xs text-fg-subtle">
          {points.length > 0 ? `step ${current?.step ?? "—"}` : `${metric.count} pts`}
        </span>
      </div>
      <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg p-3 text-xs text-fg-muted">
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
    </div>
  );
}
