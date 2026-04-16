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
import { useSequence } from "../api/hooks";
import type { SequenceMeta } from "../api/types";

interface Props {
  runId: string;
  metric: SequenceMeta;
  /** Merge multiple series (e.g. all contexts of the same metric) onto one plot. */
  extraContexts?: SequenceMeta[];
}

const SERIES_COLORS = ["#539bf5", "#d29922", "#3fb950", "#f85149", "#c678dd", "#56d4dd"];

export default function ScalarPlotCard({ runId, metric, extraContexts = [] }: Props) {
  const series = [metric, ...extraContexts];
  const queries = series.map((s) =>
    useSequence(runId, s.name, {
      context: s.context_hash || undefined,
      maxPoints: 2000,
    }),
  );
  // Merge into a single chart data array: { step, <seriesKey>: value, ... }
  type Row = { step: number } & Record<string, number | null>;
  const dataByStep = new Map<number, Row>();
  queries.forEach((q, idx) => {
    const s = series[idx]!;
    const key = seriesLabel(s);
    if (!q.data) return;
    for (const p of q.data.points) {
      const row: Row = dataByStep.get(p.step) ?? { step: p.step };
      row[key] = p.scalar_value;
      dataByStep.set(p.step, row);
    }
  });
  const data = Array.from(dataByStep.values()).sort((a, b) => a.step - b.step);
  const anyLoading = queries.some((q) => q.isLoading);

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="mono text-sm font-semibold">{metric.name}</h3>
        <span className="text-xs text-fg-subtle">{metric.count} pts</span>
      </div>
      {anyLoading && data.length === 0 ? (
        <div className="h-48 animate-pulse rounded bg-bg-hover" />
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
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
              />
              {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((s, idx) => (
                <Line
                  key={seriesLabel(s)}
                  type="monotone"
                  dataKey={seriesLabel(s)}
                  stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
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

function seriesLabel(s: SequenceMeta): string {
  if (!s.context) return "value";
  try {
    const parsed = JSON.parse(s.context);
    const entries = Object.entries(parsed)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return entries || "value";
  } catch {
    return s.context_hash.slice(0, 6);
  }
}
