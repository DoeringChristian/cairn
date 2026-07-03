import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { RunDetailResponse, RunsListResponse } from "./types";
import { api } from "./client";
import { qk } from "./query-keys";
import { addRunMetadata, setRunMetadata } from "../lib/run-label";
import { resolveRunSelectorFromRuns, type RunSelector } from "../lib/run-selector";

export function useHealth() {
  return useQuery({ queryKey: qk.health(), queryFn: api.health, refetchInterval: 5_000 });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects(), queryFn: api.projects });
}

export function useRuns(params: Parameters<typeof api.runs>[0]) {
  const q = useQuery({
    queryKey: qk.runs(params),
    queryFn: () => api.runs(params),
    refetchInterval: (q) => {
      // Poll every 3s if there are any running runs.
      const data = q.state.data;
      if (!data) return false;
      return data.runs.some((r) => r.status === "running") ? 3_000 : false;
    },
  });

  // Seed the shared run-label cache centrally. `setRunMetadata` only bumps
  // its version (re-rendering label consumers) when data actually changed,
  // so this is safe to run on every fetch/poll.
  useEffect(() => {
    if (q.data && q.data.runs.length > 0) setRunMetadata(q.data.runs);
  }, [q.data]);

  return q;
}

const INFINITE_PAGE_SIZE = 100;

export function useInfiniteRuns(params: { project?: string; status?: string }) {
  const q = useInfiniteQuery<RunsListResponse>({
    queryKey: qk.runsInfinite(params),
    queryFn: ({ pageParam }) =>
      api.runs({ ...params, limit: INFINITE_PAGE_SIZE, offset: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    refetchInterval: (q) => {
      const pages = q.state.data?.pages;
      if (!pages) return false;
      // Poll if any run on the first page is still running.
      return pages[0]?.runs.some((r) => r.status === "running") ? 3_000 : false;
    },
  });

  useEffect(() => {
    const pages = q.data?.pages;
    if (!pages) return;
    const runs = pages.flatMap((p) => p.runs);
    if (runs.length > 0) setRunMetadata(runs);
  }, [q.data]);

  return q;
}

export function useRun(runId: string) {
  const q = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    refetchInterval: (q) =>
      q.state.data?.run.status === "running" ? 2_000 : false,
  });

  useEffect(() => {
    if (q.data) addRunMetadata(q.data.run);
  }, [q.data]);

  return q;
}

/** Fetch run details for a set of runs (e.g. comparison tabs). */
export function useRunsDetails(runIds: string[]): UseQueryResult<RunDetailResponse>[] {
  const results = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 5_000,
    })),
  });

  // `results` is a fresh array each render, so key the seeding effect on the
  // queries' dataUpdatedAt timestamps instead (changes iff any fetch landed).
  const dataKey = results.map((r) => r.dataUpdatedAt).join("|");
  useEffect(() => {
    const runs = results
      .map((r) => r.data?.run)
      .filter((r): r is NonNullable<typeof r> => r != null);
    if (runs.length > 0) setRunMetadata(runs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  return results;
}

export function useSequences(runId: string) {
  const runQ = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    staleTime: 5_000,
    enabled: !!runId,
  });
  const live = runQ.data ? runQ.data.run.status === "running" : true;
  return useQuery({
    queryKey: qk.sequences(runId),
    queryFn: () => api.sequences(runId),
    refetchInterval: live ? 2_000 : false,
  });
}

export function useSequence(
  runId: string,
  name: string,
  opts: { context?: string; maxPoints?: number } = {},
) {
  const runQ = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    staleTime: 5_000,
    enabled: !!runId,
  });
  const live = runQ.data ? runQ.data.run.status === "running" : true;
  return useQuery({
    queryKey: qk.sequence(runId, name, opts),
    queryFn: () => api.sequence(runId, name, opts),
    refetchInterval: live ? 2_000 : false,
  });
}

/**
 * Fetch sequences for multiple (runId, name, contextHash) specs at once —
 * e.g. a multi-run card. Mirrors `useSequence`'s status-gated polling: a
 * single deduped run-status lookup per distinct runId drives whether each
 * sequence query keeps polling.
 */
export function useSequencesForRuns(
  specs: Array<{ runId: string; name: string; contextHash: string; maxPoints?: number }>,
) {
  const distinctRunIds = useMemo(
    () => Array.from(new Set(specs.map((s) => s.runId))),
    [specs],
  );

  const runQueries = useQueries({
    queries: distinctRunIds.map((rid) => ({
      queryKey: qk.run(rid),
      queryFn: () => api.run(rid),
      staleTime: 5_000,
      enabled: !!rid,
    })),
  });

  const liveByRunId = new Map<string, boolean>();
  distinctRunIds.forEach((rid, i) => {
    const runQ = runQueries[i];
    liveByRunId.set(rid, runQ?.data ? runQ.data.run.status === "running" : true);
  });

  return useQueries({
    queries: specs.map((spec) => ({
      queryKey: qk.sequence(spec.runId, spec.name, spec.contextHash),
      queryFn: () =>
        api.sequence(spec.runId, spec.name, {
          context: spec.contextHash || undefined,
          maxPoints: spec.maxPoints,
        }),
      staleTime: 2_000,
      refetchInterval: (liveByRunId.get(spec.runId) ?? true) ? 2_000 : false,
    })),
  });
}

export function useArtifacts(runId: string) {
  return useQuery({
    queryKey: qk.artifacts(runId),
    queryFn: () => api.artifactsForRun(runId),
  });
}

export function useLogs(
  runId: string,
  opts: { offset?: number; limit?: number; stream?: string; search?: string },
) {
  const runQ = useQuery({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    staleTime: 5_000,
    enabled: !!runId,
  });
  const live = runQ.data ? runQ.data.run.status === "running" : true;
  return useQuery({
    queryKey: qk.logs(runId, opts),
    queryFn: () => api.logs(runId, opts),
    refetchInterval: live ? 3_000 : false,
  });
}

export function useSourceTree(runId: string) {
  return useQuery({
    queryKey: qk.sourceTree(runId),
    queryFn: () => api.sourceTree(runId),
    retry: false,
  });
}

export function useSourceFile(runId: string, path: string | null) {
  return useQuery({
    queryKey: qk.sourceFile(runId, path),
    queryFn: () => {
      if (!path) throw new Error("no path");
      return api.sourceFile(runId, path);
    },
    enabled: !!path,
  });
}

export function useSetTags(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tags: string[]) => api.setTags(runId, tags),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.run(runId) });
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: qk.runsInfinite() });
    },
  });
}

export function useBulkRunMutation() {
  const qc = useQueryClient();
  const invalidate = (runIds: string[]) => {
    qc.invalidateQueries({ queryKey: qk.runsInfinite() });
    qc.invalidateQueries({ queryKey: ["runs"] });
    for (const rid of runIds) qc.invalidateQueries({ queryKey: qk.run(rid) });
  };
  return {
    bulkDelete: async (runIds: string[]) => {
      await Promise.all(runIds.map((id) => api.deleteRun(id)));
      invalidate(runIds);
    },
    bulkArchive: async (runIds: string[], archived: boolean) => {
      await Promise.all(
        runIds.map((id) => (archived ? api.archiveRun(id) : api.unarchiveRun(id))),
      );
      invalidate(runIds);
    },
  };
}

export function useSetNotes(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.setNotes(runId, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.run(runId) }),
  });
}

export function useArtifactFamilies(projectId: string) {
  return useQuery({
    queryKey: qk.artifactFamilies(projectId),
    queryFn: () => api.artifactFamilies(projectId),
    enabled: !!projectId,
  });
}

export function useArtifactFamily(projectId: string, familyId: string) {
  return useQuery({
    queryKey: qk.artifactFamily(projectId, familyId),
    queryFn: () => api.artifactFamily(projectId, familyId),
    enabled: !!projectId && !!familyId,
  });
}

export function useRunInputArtifacts(runId: string) {
  return useQuery({
    queryKey: qk.runInputArtifacts(runId),
    queryFn: () => api.runInputArtifacts(runId),
    enabled: !!runId,
  });
}

export function useRunOutputArtifacts(runId: string) {
  return useQuery({
    queryKey: qk.runOutputArtifacts(runId),
    queryFn: () => api.runOutputArtifacts(runId),
    enabled: !!runId,
  });
}

export function useLineage(projectId: string) {
  return useQuery({
    queryKey: qk.lineage(projectId),
    queryFn: () => api.lineage(projectId),
    enabled: !!projectId,
  });
}

// ---------------------------------------------------------------------------
// Reports (server-persisted; see api/client.ts's Reports section)
// ---------------------------------------------------------------------------

export function useReports(projectId: string, params?: Parameters<typeof api.reports>[1]) {
  return useQuery({
    queryKey: qk.reports(projectId, params),
    queryFn: () => api.reports(projectId, params),
    enabled: !!projectId,
  });
}

export function useReport(projectId: string, reportId: string) {
  return useQuery({
    queryKey: qk.report(projectId, reportId),
    queryFn: () => api.report(projectId, reportId),
    enabled: !!projectId && !!reportId,
  });
}

export function useCreateReport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { name: string; payload: Record<string, unknown> }) =>
      api.createReport(projectId, vars.name, vars.payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reports(projectId) }),
  });
}

export function useUpdateReport(projectId: string, reportId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; payload?: Record<string, unknown> }) =>
      api.updateReport(projectId, reportId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.report(projectId, reportId) });
      qc.invalidateQueries({ queryKey: qk.reports(projectId) });
    },
  });
}

export function useDeleteReport(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reportId: string) => api.deleteReport(projectId, reportId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reports(projectId) }),
  });
}

// ---------------------------------------------------------------------------
// Dynamic run selectors (see lib/run-selector.ts) — shared by comparisons'
// `runSelector` field and reports' cards-block `runSelector` field.
// ---------------------------------------------------------------------------

/** Bounded pool size fetched to resolve a "query" run selector against. */
const RUN_SELECTOR_FETCH_LIMIT = 500;
/** Short staleTime so a newly logged run shows up on the next focus/refresh
 *  without requiring a full page reload. */
const RUN_SELECTOR_STALE_MS = 10_000;

/**
 * Resolve a `RunSelector` against the project's runs, live.
 *
 * For `{kind: "static"}` this is a synchronous passthrough (no fetch). For
 * `{kind: "query"}` it fetches a bounded, recency-sorted pool of the
 * project's runs with a short `staleTime` and `refetchOnWindowFocus`, so a
 * freshly logged run naturally re-enters the resolved set — `refresh()` (or
 * simply refocusing the tab) is enough to pick it up. Callers should show
 * the `active` flag as an "auto" badge (see components/RunSelectorBadge.tsx)
 * with `refresh` wired to a manual refresh affordance.
 */
export function useRunSelectorResolution(
  projectId: string,
  selector: RunSelector | undefined,
): { runIds: string[]; active: boolean; isFetching: boolean; refresh: () => Promise<string[]> } {
  const enabled = !!projectId && selector?.kind === "query";
  const q = useQuery({
    queryKey: qk.runs({ project: projectId, limit: RUN_SELECTOR_FETCH_LIMIT, runSelector: true }),
    queryFn: () => api.runs({ project: projectId, limit: RUN_SELECTOR_FETCH_LIMIT }),
    enabled,
    staleTime: RUN_SELECTOR_STALE_MS,
    refetchOnWindowFocus: true,
  });

  const runIds = useMemo(() => {
    if (!selector) return [];
    if (selector.kind === "static") return selector.runIds;
    if (!q.data) return [];
    return resolveRunSelectorFromRuns(selector, q.data.runs);
  }, [selector, q.data]);

  return {
    runIds,
    active: selector?.kind === "query",
    isFetching: q.isFetching,
    // Re-fetches and returns the freshly-resolved run ids (rather than the
    // possibly-stale `runIds` from before the call) — callers that rebuild
    // cards from the resolved set (see rebuildCardsFromRuns) should await
    // this instead of reading `runIds` right after calling it.
    refresh: async () => {
      if (!selector) return [];
      if (selector.kind === "static") return selector.runIds;
      const res = await q.refetch();
      return res.data ? resolveRunSelectorFromRuns(selector, res.data.runs) : [];
    },
  };
}
