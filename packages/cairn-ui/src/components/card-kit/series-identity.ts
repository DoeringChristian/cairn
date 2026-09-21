import { shortRunLabel } from "../../lib/run-label";

/** Chip/pane label for one series — run-scoped in a multi-run card, else
 *  `name · ctxhash6`. Extracted verbatim from the dissolved media shell so
 *  every per-kind media card labels panes identically. */
export function seriesLabel(
  m: { runId?: string; name: string; context_hash: string },
  fallbackRunId: string,
  multiRun: boolean,
  siblingRunIds?: string[],
): string {
  if (multiRun) {
    return shortRunLabel(m.runId ?? fallbackRunId, siblingRunIds);
  }
  const parts: string[] = [m.name];
  if (m.context_hash) parts.push(m.context_hash.slice(0, 6));
  return parts.join(" · ");
}

/** Stable React key for one series row. */
export function seriesKey(m: {
  runId?: string;
  name: string;
  context_hash: string;
}): string {
  return `${m.runId ?? ""}::${m.name}::${m.context_hash}`;
}
