/**
 * Centralized query-key factories.
 *
 * Every react-query `queryKey` and `invalidateQueries` call should
 * reference these builders so keys stay consistent across the app.
 */

export const qk = {
  health: () => ["health"] as const,
  projects: () => ["projects"] as const,
  runs: (params?: unknown) => params != null ? ["runs", params] as const : ["runs"] as const,
  run: (runId: string) => ["run", runId] as const,
  sequences: (runId: string) => ["sequences", runId] as const,
  sequence: (runId: string, name: string, opts: unknown) => ["sequence", runId, name, opts] as const,
  artifacts: (runId: string) => ["artifacts", runId] as const,
  logs: (runId: string, opts: unknown) => ["logs", runId, opts] as const,
  sourceTree: (runId: string) => ["source-tree", runId] as const,
  sourceFile: (runId: string, path: string | null) => ["source-file", runId, path] as const,
  highlight: (selected: string | null, content: string | undefined) => ["highlight", selected, content] as const,
  plotlySource: (sourceHash: string | null | undefined) => ["plotly-source", sourceHash] as const,
  refSeries: (runId: string, name: string, contextHash: string) => ["ref-series", runId, name, contextHash] as const,
} as const;
