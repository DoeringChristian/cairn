import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { RunDetailResponse } from "../../api/types";
import { useRunsDetails } from "../../api/hooks";

/**
 * Per-run metadata consumed by cards' selection panels.
 *
 * These are the fields the shared `RunSelectionPanel` actually reads:
 *  - `displayName` → the run's `display_name` (bold label, falls back to
 *    `shortRunLabel` when absent);
 *  - `projectId`   → the run's `project_id` (drives the "open run" link).
 *
 * The label itself is *not* stored here — cards compute it on the fly via
 * `shortRunLabel(runId, siblingRunIds)` (see `run-label.ts`), gated on
 * `useRunMetadataVersion()`.
 */
export interface RunInfo {
  displayName?: string;
  projectId?: string;
}

/**
 * Build the `runId → RunInfo` map from already-fetched run-detail queries.
 *
 * Pure helper (no hooks) so cards that already hold their own `useRunsDetails`
 * result — e.g. Parallel/Scatter, which read `params` off the same queries —
 * can reuse the canonical construction without a second subscription.
 */
export function buildRunInfoMap(
  runIds: string[],
  queries: UseQueryResult<RunDetailResponse>[],
): Map<string, RunInfo> {
  const m = new Map<string, RunInfo>();
  runIds.forEach((rid, i) => {
    const d = queries[i]?.data;
    if (d) {
      m.set(rid, {
        displayName: d.run.display_name || undefined,
        projectId: d.run.project_id,
      });
    }
  });
  return m;
}

/**
 * Fetch run details for `runIds` and derive the two per-run lookups cards need:
 *
 *  - `runInfoMap`          — `runId → {displayName, projectId}` for selection panels;
 *  - `runCreatedAtByRunId` — `runId → created_at (ms)` for wall-time x-axis mapping.
 *
 * Built on top of `useRunsDetails` (a `useQueries` over `qk.run`) — the single
 * source of run-detail fetching. Cards that also need the raw run payload keep
 * their own `useRunsDetails` and call `buildRunInfoMap` directly.
 */
export function useRunInfo(runIds: string[]): {
  runInfoMap: Map<string, RunInfo>;
  runCreatedAtByRunId: Map<string, number>;
} {
  const queries = useRunsDetails(runIds);

  const runInfoMap = useMemo(
    () => buildRunInfoMap(runIds, queries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds, queries],
  );

  const runCreatedAtByRunId = useMemo(() => {
    const map = new Map<string, number>();
    runIds.forEach((rid, i) => {
      const raw = queries[i]?.data?.run.created_at;
      if (!raw) return;
      const t = new Date(raw).getTime();
      if (Number.isFinite(t)) map.set(rid, t);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runIds, queries]);

  return { runInfoMap, runCreatedAtByRunId };
}
