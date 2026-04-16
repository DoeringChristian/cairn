import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { useRun } from "../api/hooks";
import RunStatusBadge from "../components/RunStatusBadge";
import type { RunDetailResponse, SequenceMeta } from "../api/types";

const SERIES_COLORS = [
  "#539bf5",
  "#d29922",
  "#3fb950",
  "#f85149",
  "#c678dd",
  "#56d4dd",
];

interface ComparePoint {
  step: number;
  value: number;
  context: string | null;
}

interface CompareSeries {
  run_id: string;
  name: string;
  points: ComparePoint[];
}

interface CompareResponse {
  series: CompareSeries[];
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export default function ComparePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const runsParam = searchParams.get("runs") ?? "";
  const runs = useMemo(
    () => runsParam.split(",").filter(Boolean),
    [runsParam],
  );

  const colorFor = (idx: number): string =>
    SERIES_COLORS[idx % SERIES_COLORS.length]!;

  const removeRun = (id: string) => {
    const next = runs.filter((r) => r !== id);
    const params = new URLSearchParams(searchParams);
    if (next.length === 0) {
      params.delete("runs");
    } else {
      params.set("runs", next.join(","));
    }
    setSearchParams(params, { replace: true });
  };

  if (!projectId) return null;

  if (runs.length === 0) {
    return (
      <div>
        <Breadcrumbs projectId={projectId} />
        <h1 className="mono mb-4 text-xl font-semibold">
          {projectId} / compare
        </h1>
        <div className="card p-6 text-sm text-fg-muted">
          <p className="mb-2 text-fg">No runs selected.</p>
          <p>
            Go to the{" "}
            <Link
              to={`/p/${projectId}/runs`}
              className="text-accent hover:underline"
            >
              Runs table
            </Link>{" "}
            and pick some to compare.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Breadcrumbs projectId={projectId} />
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="mono text-xl font-semibold">{projectId} / compare</h1>
        <p className="text-sm text-fg-muted">
          {runs.length} run{runs.length === 1 ? "" : "s"}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        <LeftRail
          runs={runs}
          projectId={projectId}
          colorFor={colorFor}
          onRemove={removeRun}
        />
        <MainArea runs={runs} colorFor={colorFor} />
      </div>
    </div>
  );
}

function Breadcrumbs({ projectId }: { projectId: string }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
      <Link to="/" className="hover:text-fg">
        Projects
      </Link>
      <span>›</span>
      <Link to={`/p/${projectId}`} className="mono hover:text-fg">
        {projectId}
      </Link>
      <span>›</span>
      <span className="text-fg">Compare</span>
    </nav>
  );
}

function LeftRail({
  runs,
  projectId,
  colorFor,
  onRemove,
}: {
  runs: string[];
  projectId: string;
  colorFor: (idx: number) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <aside className="card h-fit p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Selected runs
      </h2>
      <ul className="flex flex-col gap-2">
        {runs.map((runId, idx) => (
          <RailItem
            key={runId}
            runId={runId}
            projectId={projectId}
            color={colorFor(idx)}
            onRemove={() => onRemove(runId)}
          />
        ))}
      </ul>
    </aside>
  );
}

function RailItem({
  runId,
  projectId,
  color,
  onRemove,
}: {
  runId: string;
  projectId: string;
  color: string;
  onRemove: () => void;
}) {
  const q = useRun(runId);
  const run = q.data?.run;
  const label = run?.display_name ?? shortId(runId);
  return (
    <li className="flex items-center gap-2 rounded border border-border-subtle bg-bg px-2 py-1.5 text-sm">
      <span
        className="inline-block h-3 w-3 flex-shrink-0 rounded-sm"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <Link
        to={`/p/${projectId}/r/${runId}`}
        className="mono min-w-0 flex-1 truncate text-accent hover:underline"
        title={runId}
      >
        {label}
      </Link>
      {run ? <RunStatusBadge status={run.status} /> : null}
      <button
        type="button"
        aria-label={`remove ${label} from selection`}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-fg-subtle hover:text-fg-muted md:min-h-0 md:min-w-0"
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}

function MainArea({
  runs,
  colorFor,
}: {
  runs: string[];
  colorFor: (idx: number) => string;
}) {
  const seqQueries = useQueries({
    queries: runs.map((runId) => ({
      queryKey: ["sequences", runId],
      queryFn: () => api.sequences(runId),
      refetchInterval: 5_000,
    })),
  });
  const runQueries = useQueries({
    queries: runs.map((runId) => ({
      queryKey: ["run", runId],
      queryFn: () => api.run(runId),
    })),
  });

  const anySeqLoading = seqQueries.some((q) => q.isLoading);
  const metricNames = useMemo(() => {
    const names = new Set<string>();
    for (const q of seqQueries) {
      const data = q.data;
      if (!data) continue;
      for (const s of data.sequences as SequenceMeta[]) {
        if (s.object_type === "scalar") names.add(s.name);
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [seqQueries]);

  const runLabels = useMemo(() => {
    const map = new Map<string, string>();
    runs.forEach((runId, idx) => {
      const data = runQueries[idx]?.data as RunDetailResponse | undefined;
      map.set(runId, data?.run?.display_name ?? shortId(runId));
    });
    return map;
  }, [runs, runQueries]);

  if (anySeqLoading && metricNames.length === 0) {
    return <p className="text-fg-muted">Loading sequences…</p>;
  }

  if (metricNames.length === 0) {
    return (
      <div className="card p-6 text-sm text-fg-muted">
        No scalar metrics in the selected runs to compare.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {metricNames.map((name) => (
        <CompareCard
          key={name}
          metricName={name}
          runs={runs}
          runLabels={runLabels}
          colorFor={colorFor}
        />
      ))}
    </div>
  );
}

function CompareCard({
  metricName,
  runs,
  runLabels,
  colorFor,
}: {
  metricName: string;
  runs: string[];
  runLabels: Map<string, string>;
  colorFor: (idx: number) => string;
}) {
  const cmp = useQuery({
    queryKey: ["compare", runs, metricName],
    queryFn: async (): Promise<CompareResponse> => {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_ids: runs,
          metrics: [metricName],
          max_points: 2000,
        }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()) as CompareResponse;
    },
    refetchInterval: 5_000,
  });

  type Row = { step: number } & Record<string, number | null>;
  const data: Row[] = useMemo(() => {
    const byStep = new Map<number, Row>();
    const series = cmp.data?.series ?? [];
    for (const s of series) {
      for (const p of s.points) {
        const row = byStep.get(p.step) ?? { step: p.step };
        row[s.run_id] = p.value;
        byStep.set(p.step, row);
      }
    }
    return Array.from(byStep.values()).sort((a, b) => a.step - b.step);
  }, [cmp.data]);

  const nameFormatter = (value: string): string =>
    runLabels.get(value) ?? shortId(value);

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="mono text-sm font-semibold">{metricName}</h3>
        {cmp.isError ? (
          <span className="text-xs text-status-failed">error</span>
        ) : null}
      </div>
      {cmp.isLoading && data.length === 0 ? (
        <div className="h-64 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-xs text-fg-subtle">
          No data
        </div>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
            >
              <CartesianGrid stroke="#30363d" strokeDasharray="2 4" />
              <XAxis
                dataKey="step"
                type="number"
                domain={["dataMin", "dataMax"]}
                stroke="#8b949e"
                fontSize={11}
              />
              <YAxis stroke="#8b949e" fontSize={11} width={46} />
              <Tooltip
                contentStyle={{
                  background: "#13171c",
                  border: "1px solid #30363d",
                  fontSize: 12,
                }}
                labelStyle={{ color: "#8b949e" }}
                formatter={(value: number | string, name: string) => [
                  value,
                  nameFormatter(name),
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value: string) => nameFormatter(value)}
              />
              {runs.map((runId, idx) => (
                <Line
                  key={runId}
                  type="monotone"
                  dataKey={runId}
                  name={runId}
                  stroke={colorFor(idx)}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
