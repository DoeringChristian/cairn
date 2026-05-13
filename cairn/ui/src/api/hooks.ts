import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunsListResponse } from "./types";
import { api } from "./client";

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 5_000 });
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.projects });
}

export function useRuns(params: Parameters<typeof api.runs>[0]) {
  return useQuery({
    queryKey: ["runs", params],
    queryFn: () => api.runs(params),
    refetchInterval: (q) => {
      // Poll every 3s if there are any running runs.
      const data = q.state.data;
      if (!data) return false;
      return data.runs.some((r) => r.status === "running") ? 3_000 : false;
    },
  });
}

const INFINITE_PAGE_SIZE = 100;

export function useInfiniteRuns(params: { project?: string; status?: string }) {
  return useInfiniteQuery<RunsListResponse>({
    queryKey: ["runs-infinite", params],
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
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.run(runId),
    refetchInterval: (q) =>
      q.state.data?.run.status === "running" ? 2_000 : false,
  });
}

export function useSequences(runId: string) {
  return useQuery({
    queryKey: ["sequences", runId],
    queryFn: () => api.sequences(runId),
    refetchInterval: 2_000,
  });
}

export function useSequence(
  runId: string,
  name: string,
  opts: { context?: string; maxPoints?: number } = {},
) {
  return useQuery({
    queryKey: ["sequence", runId, name, opts],
    queryFn: () => api.sequence(runId, name, opts),
    refetchInterval: 2_000,
  });
}

export function useArtifacts(runId: string) {
  return useQuery({
    queryKey: ["artifacts", runId],
    queryFn: () => api.artifactsForRun(runId),
  });
}

export function useLogs(
  runId: string,
  opts: { offset?: number; limit?: number; stream?: string; search?: string },
) {
  return useQuery({
    queryKey: ["logs", runId, opts],
    queryFn: () => api.logs(runId, opts),
    refetchInterval: 3_000,
  });
}

export function useSourceTree(runId: string) {
  return useQuery({
    queryKey: ["source-tree", runId],
    queryFn: () => api.sourceTree(runId),
    retry: false,
  });
}

export function useSourceFile(runId: string, path: string | null) {
  return useQuery({
    queryKey: ["source-file", runId, path],
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run", runId] }),
  });
}

export function useSetNotes(runId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => api.setNotes(runId, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run", runId] }),
  });
}
