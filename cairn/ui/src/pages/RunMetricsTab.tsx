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
  const allSequences = useMemo(() => {
    const sequences: SequenceMeta[] = q.data?.sequences ?? [];
    const named = artifactsQ.data?.named ?? [];
    if (named.length === 0) return sequences;

    const seqNames = new Set(sequences.map((s) => s.name));
    const artifactMetas: SequenceMeta[] = named
      .filter((a: any) => !seqNames.has(a.name))
      .map((a: any) => ({
        name: a.name,
        object_type: "artifact",
        context: null,
        context_hash: "",
        min_step: a.step ?? 0,
        max_step: a.step ?? 0,
        count: 1,
      }));
    return [...sequences, ...artifactMetas];
  }, [q.data, artifactsQ.data]);

  if (q.isLoading) return <p className="text-fg-muted">Loading metrics…</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;
  return <CardGrid runId={runId!} sequences={allSequences} />;
}
