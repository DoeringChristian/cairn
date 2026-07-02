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

  useEffect(() => {
    const runs = results
      .map((r) => r.data?.run)
      .filter((r): r is NonNullable<typeof r> => r != null);
    if (runs.length > 0) setRunMetadata(runs);
  });

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
