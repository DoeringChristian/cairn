import { useOutletContext, useParams } from "react-router-dom";
import { useSequences } from "../api/hooks";
import CardGrid from "../components/CardGrid";
import type { Run } from "../api/types";

interface Ctx {
  run: Run;
}

export default function RunMetricsTab() {
  const { runId } = useParams<{ runId: string }>();
  useOutletContext<Ctx>(); // context present but not used directly here
  const q = useSequences(runId!);

  if (q.isLoading) return <p className="text-fg-muted">Loading metrics…</p>;
  if (q.isError) return <p className="text-status-failed">Error: {String(q.error)}</p>;
  const sequences = q.data?.sequences ?? [];
  return <CardGrid runId={runId!} sequences={sequences} />;
}
