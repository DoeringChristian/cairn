import { useMemo } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import { useSequences, useArtifacts } from "../api/hooks";
import CardGrid from "../components/CardGrid";
import type { Run, SequenceMeta } from "../api/types";

interface Ctx {
  run: Run;
}

export default function RunMetricsTab() {
  const { runId } = useParams<{ runId: string }>();
  useOutletContext<Ctx>();
  const q = useSequences(runId!);
  const artifactsQ = useArtifacts(runId!);

  // Convert named artifacts (from log_artifact) into SequenceMeta entries
  // so they appear as cards in the grid alongside sequence-based metrics.
  // Multiple log_artifact() calls with the same name (different steps) collapse
  // into ONE card — ArtifactCard renders all steps via the slider.
  const allSequences = useMemo(() => {
    const sequences: SequenceMeta[] = q.data?.sequences ?? [];
    const named = artifactsQ.data?.named ?? [];
    if (named.length === 0) return sequences;

    const seqNames = new Set(sequences.map((s) => s.name));
    // Group by name; aggregate min/max step + count.
    const byName = new Map<string, { steps: number[] }>();
    for (const a of named as any[]) {
      if (seqNames.has(a.name)) continue;
      const entry = byName.get(a.name) ?? { steps: [] };
      entry.steps.push(a.step ?? 0);
      byName.set(a.name, entry);
    }
    const artifactMetas: SequenceMeta[] = Array.from(byName.entries()).map(([name, info]) => ({
      name,
      object_type: "artifact",
      context: null,
      context_hash: "",
      min_step: Math.min(...info.steps),
      max_step: Math.max(...info.steps),
      count: info.steps.length,
    }));
    return [...sequences, ...artifactMetas];
  }, [q.data, artifactsQ.data]);

  if (q.isLoading) return <p className="text-fg-muted">Loading metrics…</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;
  return <CardGrid runId={runId!} sequences={allSequences} />;
}
