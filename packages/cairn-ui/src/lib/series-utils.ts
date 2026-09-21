import { shortRunLabel } from "./run-label";

export function seriesKey(m: { runId?: string; name: string; context_hash: string }): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}

export function seriesLabel(
  name: string,
  contextHash: string,
  runId: string | undefined,
  includeRun: boolean,
  siblingRunIds?: string[],
): string {
  if (includeRun && runId) {
    const parts: string[] = [shortRunLabel(runId, siblingRunIds)];
    if (contextHash) parts.push(contextHash.slice(0, 6));
    return parts.join(" \u00B7 ");
  }
  const parts: string[] = [name];
  if (contextHash) parts.push(contextHash.slice(0, 6));
  return parts.join(" \u00B7 ");
}
