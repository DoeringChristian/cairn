/**
 * App-wide live-updates poller.
 *
 * Mounted ONCE at the app root (inside `QueryClientProvider`, above the
 * router) so navigating between run, compare and report pages never restarts
 * it and never creates a second instance. Both pieces of its state are
 * app-wide singletons: the react-query cache, and the module-level cursor map
 * in `live-updates-core.ts`.
 *
 * Every tick it asks the query cache which runs are actually on screen (any
 * ACTIVE `["sequence", runId, …]` observer, from any page), and for each one
 * that is still running issues a SINGLE `GET /api/runs/{id}/updates?since=…`.
 * The returned points are appended into the sequences already cached — the
 * poller never creates a cache entry, so it only ever feeds cards that are
 * already showing that series.
 *
 * This replaces per-card `refetchInterval`s that re-downloaded whole
 * (multi-megabyte) sequences: a compare page over one running run used to
 * issue ~177 sequence requests a minute.
 */

import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { api } from "./client";
import { qk } from "./query-keys";
import type { RunDetailResponse, SequenceResponse, UpdatesResponse } from "./types";
import {
  MAX_PAGES_PER_CYCLE,
  advanceCursor,
  appendAllDedup,
  getRunCursor,
  groupPointsBySeries,
  selectRunsToPoll,
  seriesKeyOfQueryKey,
  setRunCursor,
} from "./live-updates-core";

const POLL_INTERVAL_MS = 2_000;

/**
 * Last status seen for a run, app-wide. `qk.run(rid)` is the primary source,
 * but a compare page can show a run's sequences without ever mounting its
 * detail query — this keeps the poller able to stop on a finished run anyway.
 */
const statusByRun = new Map<string, string>();

/** Runs with a poll in flight — keeps overlapping ticks (and React 18's
 * double-mounted dev effects) from issuing the same request twice. */
const inFlight = new Set<string>();

function runIdsWithActiveSequences(qc: QueryClient): string[] {
  const ids = new Set<string>();
  for (const q of qc.getQueryCache().findAll({ queryKey: ["sequence"], type: "active" })) {
    const rid = q.queryKey[1];
    if (typeof rid === "string" && rid) ids.add(rid);
  }
  return [...ids];
}

function currentStatus(qc: QueryClient, runId: string): string | null {
  const detail = qc.getQueryData<RunDetailResponse>(qk.run(runId));
  return detail?.run.status ?? statusByRun.get(runId) ?? null;
}

/** Append a poll's points into whichever sequence queries already hold them. */
function applyPoints(qc: QueryClient, runId: string, res: UpdatesResponse): void {
  if (res.points.length === 0) return;
  const bySeries = groupPointsBySeries(res.points);

  // Route by inspecting the cached keys rather than rebuilding them: card call
  // sites spell the key's context slot three different ways (see
  // `keyContextHash`). Inactive-but-cached queries are updated too, so a card
  // that remounts within the gc window comes back already current.
  for (const query of qc.getQueryCache().findAll({ queryKey: ["sequence", runId] })) {
    const key = seriesKeyOfQueryKey(query.queryKey);
    if (key === null) continue;
    const incoming = bySeries.get(key);
    if (!incoming) continue;
    const old = query.state.data as SequenceResponse | undefined;
    if (!old || !Array.isArray(old.points)) continue; // never create entries
    const points = appendAllDedup(old.points, incoming);
    if (points === old.points) continue; // nothing new — no re-render
    qc.setQueryData<SequenceResponse>(query.queryKey, {
      ...old,
      points,
      cursor: res.cursor,
    });
  }
}

function applyStatus(qc: QueryClient, runId: string, status: string): void {
  statusByRun.set(runId, status);
  qc.setQueryData<RunDetailResponse>(qk.run(runId), (old) => {
    if (!old || old.run.status === status) return old;
    return { ...old, run: { ...old.run, status: status as RunDetailResponse["run"]["status"] } };
  });
}

async function pollRun(qc: QueryClient, runId: string): Promise<void> {
  if (inFlight.has(runId)) return;
  inFlight.add(runId);
  try {
    for (let page = 0; page < MAX_PAGES_PER_CYCLE; page++) {
      const since = getRunCursor(runId);
      if (since === undefined) return;
      const res = await api.updates(runId, since);
      applyPoints(qc, runId, res);
      const { cursor, done } = advanceCursor(since, res);
      setRunCursor(runId, cursor);
      // Status last: the server reads it after the points, so a terminal
      // status means this response already carried everything.
      applyStatus(qc, runId, res.status);
      if (done) break;
    }
  } catch {
    // Transient (offline, restart, 401 redirect in flight). The next tick
    // retries from the same cursor — nothing is lost.
  } finally {
    inFlight.delete(runId);
  }
}

async function pollCycle(qc: QueryClient): Promise<void> {
  const runIds = selectRunsToPoll(
    runIdsWithActiveSequences(qc).map((runId) => ({
      runId,
      hasActiveSequenceObserver: true,
      status: currentStatus(qc, runId),
      cursor: getRunCursor(runId),
    })),
  );
  await Promise.all(runIds.map((rid) => pollRun(qc, rid)));
}

/** Mount once, at the app root. Renders nothing of its own. */
export function LiveUpdatesProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  useEffect(() => {
    const timer = setInterval(() => {
      void pollCycle(qc);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [qc]);
  return <>{children}</>;
}
