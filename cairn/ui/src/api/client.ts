// Thin fetch wrapper around the Cairn /api/* surface.
// All paths are relative so the same client works in dev (with Vite proxy)
// and prod (served by the UI server).

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${path}`);
  }
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
  return (await res.json()) as T;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
  return (await res.json()) as T;
}

async function del_<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => get<import("./types").Health>("/api/health"),
  projects: () =>
    get<{ projects: import("./types").Project[] }>("/api/projects"),
  project: (id: string) => get<import("./types").Project>(`/api/projects/${id}`),
  createProject: (name: string) =>
    post<{ id: string; name: string; created_at: string }>("/api/projects", { name }),
  runs: (params: { project?: string; status?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.project) q.set("project", params.project);
    if (params.status) q.set("status", params.status);
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.offset != null) q.set("offset", String(params.offset));
    const qs = q.toString();
    return get<import("./types").RunsListResponse>(
      `/api/runs${qs ? `?${qs}` : ""}`,
    );
  },
  run: (runId: string) =>
    get<import("./types").RunDetailResponse>(`/api/runs/${runId}`),
  sequences: (runId: string) =>
    get<{ sequences: import("./types").SequenceMeta[] }>(
      `/api/runs/${runId}/sequences`,
    ),
  sequence: (
    runId: string,
    name: string,
    opts: { context?: string; maxPoints?: number } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.context != null) q.set("context", opts.context);
    if (opts.maxPoints != null) q.set("max_points", String(opts.maxPoints));
    const qs = q.toString();
    return get<import("./types").SequenceResponse>(
      `/api/runs/${runId}/sequences/${encodeURIComponent(name)}${qs ? `?${qs}` : ""}`,
    );
  },
  artifactsForRun: (runId: string) =>
    get<import("./types").ArtifactsResponse>(`/api/runs/${runId}/artifacts`),
  artifactUrl: (hash: string) => `/api/artifacts/${hash}`,
  logs: (
    runId: string,
    opts: { offset?: number; limit?: number; stream?: string; search?: string } = {},
  ) => {
    const q = new URLSearchParams();
    if (opts.offset != null) q.set("offset", String(opts.offset));
    if (opts.limit != null) q.set("limit", String(opts.limit));
    if (opts.stream) q.set("stream", opts.stream);
    if (opts.search) q.set("search", opts.search);
    const qs = q.toString();
    return get<import("./types").LogsResponse>(
      `/api/runs/${runId}/logs${qs ? `?${qs}` : ""}`,
    );
  },
  sourceTree: (runId: string) =>
    get<import("./types").SourceTreeResponse>(`/api/runs/${runId}/source/tree`),
  sourceFile: (runId: string, path: string) =>
    get<import("./types").SourceFileResponse>(
      `/api/runs/${runId}/source/file?path=${encodeURIComponent(path)}`,
    ),
  setTags: (runId: string, tags: string[]) =>
    post<{ run_id: string; tags: string[] }>(`/api/runs/${runId}/tags`, { tags }),
  setNotes: (runId: string, notes: string) =>
    post<{ run_id: string; notes: string }>(`/api/runs/${runId}/notes`, { notes }),
  deleteRun: (runId: string) =>
    del_<{ deleted: string }>(`/api/runs/${runId}`),
  archiveRun: (runId: string) =>
    post<{ run_id: string; status: string }>(`/api/runs/${runId}/archive`, {}),
  unarchiveRun: (runId: string) =>
    post<{ run_id: string; status: string }>(`/api/runs/${runId}/unarchive`, {}),
  exportRuns: async (runIds: string[]): Promise<Blob> => {
    const resp = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_ids: runIds }),
    });
    if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
    return resp.blob();
  },
  importRuns: async (file: File): Promise<{ imported: Array<{ original_id: string; new_id: string; name: string }> }> => {
    const form = new FormData();
    form.append("file", file);
    const resp = await fetch("/api/import", { method: "POST", body: form });
    if (!resp.ok) throw new Error(`Import failed: ${resp.status}`);
    return resp.json();
  },

  // Comparisons (server-persisted)
  comparisons: (projectId: string) =>
    get<{ comparisons: Array<{ id: string; name: string; created_at: string; updated_at: string; card_count: number }> }>(
      `/api/projects/${projectId}/comparisons`,
    ),
  comparison: (projectId: string, id: string) =>
    get<{ id: string; project_id: string; name: string; created_at: string; updated_at: string; payload: Record<string, unknown> }>(
      `/api/projects/${projectId}/comparisons/${id}`,
    ),
  createServerComparison: (projectId: string, name: string, payload: Record<string, unknown>) =>
    post<{ id: string; name: string; created_at: string }>(
      `/api/projects/${projectId}/comparisons`,
      { name, payload },
    ),
  updateServerComparison: (projectId: string, id: string, body: { name?: string; payload?: Record<string, unknown> }) =>
    put<{ id: string; updated_at: string }>(
      `/api/projects/${projectId}/comparisons/${id}`,
      body,
    ),
  deleteServerComparison: (projectId: string, id: string) =>
    del_<{ deleted: string }>(`/api/projects/${projectId}/comparisons/${id}`),
};
