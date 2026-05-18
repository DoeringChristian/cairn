import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunsListResponse } from "./types";
import { api } from "./client";
import { qk } from "./query-keys";

export function useHealth() {
  return useQuery({ queryKey: qk.health(), queryFn: api.health, refetchInterval: 5_000 });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects(), queryFn: api.projects });
}

export function useRuns(params: Parameters<typeof api.runs>[0]) {
  return useQuery({
    queryKey: qk.runs(params),
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
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    refetchInterval: (q) =>
      q.state.data?.run.status === "running" ? 2_000 : false,
  });
}

export function useSequences(runId: string) {
  return useQuery({
    queryKey: qk.sequences(runId),
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
    queryKey: qk.sequence(runId, name, opts),
    queryFn: () => api.sequence(runId, name, opts),
    refetchInterval: 2_000,
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
  return useQuery({
    queryKey: qk.logs(runId, opts),
    queryFn: () => api.logs(runId, opts),
    refetchInterval: 3_000,
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
      qc.invalidateQueries({ queryKey: ["runs-infinite"] });
    },
  });
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
