import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import type { Param, Run } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import { formatDuration, safeJsonParse } from "../lib/format";
import { disambiguateRunLabels } from "../lib/run-label";

interface Props {
  compRunIds: string[];
}

export default function ComparisonOverviewTab({ compRunIds }: Props) {
  const [onlyDiffs, setOnlyDiffs] = useState(true);

  const queries = useQueries({
    queries: compRunIds.map((id) => ({
      queryKey: qk.run(id),
      queryFn: () => api.run(id),
      staleTime: 30_000,
    })),
  });

  const loading = queries.some((q) => q.isLoading);
  const runData = useMemo(
    () =>
      queries
        .map((q) => q.data)
        .filter((d): d is { run: Run; params: Param[] } => d != null),
    [queries],
  );

  const labels = useMemo(
    () => disambiguateRunLabels(compRunIds),
    [compRunIds],
  );

  // Build param diff table: key → { runId → value }
  const { paramKeys, paramMap, differingKeys } = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const rd of runData) {
      for (const p of rd.params) {
        let row = map.get(p.key);
        if (!row) {
          row = new Map();
          map.set(p.key, row);
        }
        row.set(rd.run.id, p.value);
      }
    }
    const keys = Array.from(map.keys()).sort();
    const differing = new Set<string>();
    for (const [key, row] of map) {
      const vals = Array.from(row.values());
      if (vals.length < compRunIds.length || vals.some((v) => v !== vals[0])) {
        differing.add(key);
      }
    }
    return { paramKeys: keys, paramMap: map, differingKeys: differing };
  }, [runData, compRunIds]);

  // Environment diff
  const envRows = useMemo(() => {
    const fields = ["python_version", "platform", "cuda_available", "cuda_version", "gpu_names"] as const;
    const rows: Array<{ key: string; values: Map<string, string>; differs: boolean }> = [];
    for (const field of fields) {
      const values = new Map<string, string>();
      for (const rd of runData) {
        const env = safeJsonParse<Record<string, unknown>>(rd.run.env_snapshot);
        let val = "—";
        if (env) {
          const raw = env[field];
          if (field === "gpu_names" && Array.isArray(raw)) {
            val = raw.length > 0 ? (raw as string[]).join(", ") : "—";
          } else if (field === "cuda_available") {
            val = raw ? `yes (${env.cuda_version ?? "?"})` : "no";
          } else if (raw != null) {
            val = String(raw);
          }
        }
        values.set(rd.run.id, val);
      }
      const vals = Array.from(values.values());
      rows.push({ key: field.replace(/_/g, " "), values, differs: vals.some((v) => v !== vals[0]) });
    }
    return rows;
  }, [runData]);

  if (loading) return <p className="text-fg-muted">Loading run details...</p>;
  if (runData.length === 0)
    return <p className="text-fg-muted">No runs in this comparison.</p>;

  const displayKeys = onlyDiffs
    ? paramKeys.filter((k) => differingKeys.has(k))
    : paramKeys;

  return (
    <div className="flex flex-col gap-6">
      {/* Run summary cards */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Runs ({compRunIds.length})
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {runData.map((rd) => (
            <RunSummaryCard
              key={rd.run.id}
              run={rd.run}
              label={labels[rd.run.id] ?? rd.run.id.slice(0, 8)}
            />
          ))}
        </div>
      </section>

      {/* Parameter diff */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
            Parameters ({differingKeys.size} differ{differingKeys.size === 1 ? "s" : ""})
          </h3>
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={onlyDiffs}
              onChange={(e) => setOnlyDiffs(e.target.checked)}
            />
            Only show diffs
          </label>
        </div>
        {displayKeys.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            {paramKeys.length === 0
              ? "No parameters logged."
              : "All parameters are identical across runs."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
                <tr>
                  <th className="pb-1 pr-4 sticky left-0 bg-bg-surface">Key</th>
                  {runData.map((rd) => (
                    <th key={rd.run.id} className="pb-1 pr-4 whitespace-nowrap">
                      {labels[rd.run.id] ?? rd.run.id.slice(0, 8)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayKeys.map((key) => {
                  const row = paramMap.get(key)!;
                  const differs = differingKeys.has(key);
                  return (
                    <tr
                      key={key}
                      className={`border-t border-border-subtle ${
                        differs ? "bg-accent/5" : ""
                      }`}
                    >
                      <td
                        className={`mono py-1 pr-4 sticky left-0 ${
                          differs ? "bg-accent/5 border-l-2 border-accent" : "bg-bg-surface"
                        }`}
                      >
                        {key}
                      </td>
                      {runData.map((rd) => (
                        <td key={rd.run.id} className="mono py-1 pr-4 text-fg-muted whitespace-nowrap">
                          {row.get(rd.run.id) ?? "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Environment diff */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Environment
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="pb-1 pr-4 sticky left-0 bg-bg-surface">Field</th>
                {runData.map((rd) => (
                  <th key={rd.run.id} className="pb-1 pr-4 whitespace-nowrap">
                    {labels[rd.run.id] ?? rd.run.id.slice(0, 8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {envRows.map((row) => (
                <tr
                  key={row.key}
                  className={`border-t border-border-subtle ${
                    row.differs ? "bg-accent/5" : ""
                  }`}
                >
                  <td
                    className={`py-1 pr-4 text-fg-muted sticky left-0 ${
                      row.differs ? "bg-accent/5 border-l-2 border-accent" : "bg-bg-surface"
                    }`}
                  >
                    {row.key}
                  </td>
                  {runData.map((rd) => (
                    <td key={rd.run.id} className="mono py-1 pr-4 text-fg-muted whitespace-nowrap">
                      {row.values.get(rd.run.id) ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RunSummaryCard({ run, label }: { run: Run; label: string }) {
  const tags = safeJsonParse<string[]>(run.tags) ?? [];
  return (
    <div className="card p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <span className="mono font-semibold truncate">{label}</span>
        <RunStatusBadge status={run.status} />
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-muted">Branch</dt>
        <dd className="mono text-fg truncate">{run.git_branch ?? "—"}</dd>
        <dt className="text-fg-muted">Commit</dt>
        <dd className="mono text-fg">{run.git_sha?.slice(0, 10) ?? "—"}</dd>
        <dt className="text-fg-muted">Duration</dt>
        <dd className="mono text-fg">{formatDuration(run.created_at, run.ended_at)}</dd>
        {tags.length > 0 && (
          <>
            <dt className="text-fg-muted">Tags</dt>
            <dd className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="mono rounded border border-border-subtle px-1 py-0 text-[10px] text-fg-muted"
                >
                  {t}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
