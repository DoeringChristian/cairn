import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useRunsDetails } from "../api/hooks";
import { api } from "../api/client";
import { qk } from "../api/query-keys";
import type { Param, Run } from "../api/types";
import RunStatusBadge from "../components/RunStatusBadge";
import { formatDuration, safeJsonParse } from "../lib/format";
import { formatNum } from "@cairn-plot/lib/cairn-plot";
import { disambiguateRunLabels, useRunMetadataVersion } from "../lib/run-label";
import { computeCellStatuses, diffCellClassName, isNumericSeries, toNumeric } from "@cairn-plot/lib/cairn-plot/table-diff";

/** Cap on metrics shown in the summary table (per spec). */
const MAX_SUMMARY_METRICS = 50;

interface Props {
  compRunIds: string[];
}

export default function ComparisonOverviewTab({ compRunIds }: Props) {
  const [onlyDiffs, setOnlyDiffs] = useState(true);

  const queries = useRunsDetails(compRunIds);

  const loading = queries.some((q) => q.isLoading);
  const runData = useMemo(
    () =>
      queries
        .map((q) => q.data)
        .filter((d): d is { run: Run; params: Param[] } => d != null),
    [queries],
  );

  // Recompute labels when the run metadata cache is seeded (api/hooks.ts).
  const metaVersion = useRunMetadataVersion();
  const labels = useMemo(
    () => disambiguateRunLabels(compRunIds),
    [compRunIds, metaVersion],
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

  const displayEnvRows = onlyDiffs ? envRows.filter((r) => r.differs) : envRows;

  return (
    <div className="flex flex-col gap-6">
      {/* Global control bar */}
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={onlyDiffs}
            onChange={(e) => setOnlyDiffs(e.target.checked)}
          />
          Only show differences
        </label>
      </div>

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
                  const rawValues = runData.map((rd) => row.get(rd.run.id) ?? null);
                  const numeric = isNumericSeries(rawValues);
                  const statuses = numeric
                    ? computeCellStatuses(rawValues.map(toNumeric))
                    : null;
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
                      {runData.map((rd, i) => {
                        const diffCls = statuses ? diffCellClassName(statuses[i]!) : "";
                        return (
                          <td
                            key={rd.run.id}
                            className={`mono py-1 pr-4 whitespace-nowrap text-fg-muted ${diffCls}`}
                          >
                            {row.get(rd.run.id) ?? "—"}
                          </td>
                        );
                      })}
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
        {displayEnvRows.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            Environment is identical across runs.
          </p>
        ) : (
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
              {displayEnvRows.map((row) => (
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
        )}
      </section>

      {/* Summary metrics — last value of each scalar metric per run. */}
      <MetricsSummarySection
        runData={runData}
        labels={labels}
        onlyDiffs={onlyDiffs}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary metrics section
// ---------------------------------------------------------------------------

interface MetricsSummaryProps {
  runData: Array<{ run: Run; params: Param[] }>;
  labels: Record<string, string>;
  onlyDiffs: boolean;
}

/**
 * Table of each scalar metric's LAST value per run (columns = runs, rows =
 * metrics). Capped at MAX_SUMMARY_METRICS with a substring filter box; obeys
 * the overview's "only show differences" toggle.
 */
function MetricsSummarySection({ runData, labels, onlyDiffs }: MetricsSummaryProps) {
  const [filter, setFilter] = useState("");
  const runIds = useMemo(() => runData.map((rd) => rd.run.id), [runData]);

  // Scalar sequence lists per run → union of metric names.
  const seqQueries = useQueries({
    queries: runIds.map((rid) => ({
      queryKey: qk.sequences(rid),
      queryFn: () => api.sequences(rid),
      staleTime: 10_000,
    })),
  });

  const { metricNames, truncated } = useMemo(() => {
    const names = new Set<string>();
    for (const q of seqQueries) {
      for (const seq of q.data?.sequences ?? []) {
        if (seq.object_type === "scalar") names.add(seq.name);
      }
    }
    const all = Array.from(names).sort();
    return { metricNames: all.slice(0, MAX_SUMMARY_METRICS), truncated: all.length > MAX_SUMMARY_METRICS };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seqQueries.map((q) => q.dataUpdatedAt).join("|")]);

  // Fetch last value for every (run, metric) pair.
  const specs = useMemo(
    () => runIds.flatMap((rid) => metricNames.map((name) => ({ rid, name }))),
    [runIds, metricNames],
  );

  const valueQueries = useQueries({
    queries: specs.map((s) => ({
      queryKey: qk.sequence(s.rid, s.name, "last-summary"),
      queryFn: () => api.sequence(s.rid, s.name, {}),
      staleTime: 10_000,
    })),
  });

  // metricName → runId → last value.
  const { rows, differing } = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    specs.forEach((s, i) => {
      const pts = valueQueries[i]?.data?.points;
      if (!pts?.length) return;
      let last: number | null = null;
      for (let j = pts.length - 1; j >= 0; j--) {
        if (pts[j]!.scalar_value != null) { last = pts[j]!.scalar_value!; break; }
      }
      if (last == null) return;
      let row = map.get(s.name);
      if (!row) { row = new Map(); map.set(s.name, row); }
      row.set(s.rid, last);
    });
    const diff = new Set<string>();
    for (const [name, row] of map) {
      const vals = runIds.map((rid) => row.get(rid));
      const present = vals.filter((v): v is number => v != null);
      if (present.length < runIds.length || present.some((v) => v !== present[0])) {
        diff.add(name);
      }
    }
    return { rows: map, differing: diff };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specs, runIds, valueQueries.map((q) => q.dataUpdatedAt).join("|")]);

  const anyLoading = seqQueries.some((q) => q.isLoading) || valueQueries.some((q) => q.isLoading);

  const q = filter.trim().toLowerCase();
  const displayNames = metricNames
    .filter((name) => rows.has(name))
    .filter((name) => (onlyDiffs ? differing.has(name) : true))
    .filter((name) => (q ? name.toLowerCase().includes(q) : true));

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Metrics ({differing.size} differ{differing.size === 1 ? "s" : ""})
        </h3>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter metrics..."
          className="input w-40 text-xs"
        />
      </div>
      {anyLoading && rows.size === 0 ? (
        <p className="text-sm text-fg-subtle">Loading metrics...</p>
      ) : displayNames.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          {rows.size === 0
            ? "No scalar metrics logged."
            : onlyDiffs
              ? "All metrics are identical across runs."
              : "No matching metrics."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="pb-1 pr-4 sticky left-0 bg-bg-surface">Metric</th>
                {runData.map((rd) => (
                  <th key={rd.run.id} className="pb-1 pr-4 whitespace-nowrap">
                    {labels[rd.run.id] ?? rd.run.id.slice(0, 8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayNames.map((name) => {
                const row = rows.get(name)!;
                const differs = differing.has(name);
                const statuses = computeCellStatuses(runIds.map((rid) => row.get(rid) ?? null));
                return (
                  <tr
                    key={name}
                    className={`border-t border-border-subtle ${differs ? "bg-accent/5" : ""}`}
                  >
                    <td
                      className={`mono py-1 pr-4 sticky left-0 ${
                        differs ? "bg-accent/5 border-l-2 border-accent" : "bg-bg-surface"
                      }`}
                    >
                      {name}
                    </td>
                    {runData.map((rd, i) => {
                      const v = row.get(rd.run.id);
                      const diffCls = v != null ? diffCellClassName(statuses[i]!) : "";
                      return (
                        <td
                          key={rd.run.id}
                          className={`mono py-1 pr-4 whitespace-nowrap tabular-nums text-fg-muted ${diffCls}`}
                        >
                          {v != null ? formatNum(v) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {truncated && (
            <p className="mt-2 text-[10px] text-fg-subtle">
              Showing first {MAX_SUMMARY_METRICS} metrics.
            </p>
          )}
        </div>
      )}
    </section>
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
