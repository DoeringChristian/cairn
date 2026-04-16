import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import createPlotlyComponent from "react-plotly.js/factory";
// @ts-expect-error - plotly.js-dist-min has no bundled types, but is runtime-compatible with the factory.
import Plotly from "plotly.js-dist-min";
import { useSequence } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import type { SequenceMeta } from "../api/types";

const Plot = createPlotlyComponent(Plotly);

interface Props {
  runId: string;
  metric: SequenceMeta;
}

interface FigureMetadata {
  has_source?: boolean;
  source_format?: string | null;
  source_hash?: string | null;
}

interface PlotlyFigure {
  data?: unknown[];
  layout?: Record<string, unknown>;
}

const DARK_LAYOUT: Record<string, unknown> = {
  paper_bgcolor: "#13171c",
  plot_bgcolor: "#0b0d10",
  font: { color: "#e6edf3" },
  margin: { l: 40, r: 20, t: 20, b: 40 },
};

function usePlotlySource(sourceHash: string | null | undefined) {
  return useQuery({
    queryKey: ["plotly-source", sourceHash],
    queryFn: async (): Promise<PlotlyFigure> => {
      const res = await fetch(api.artifactUrl(sourceHash as string));
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return (await res.json()) as PlotlyFigure;
    },
    enabled: !!sourceHash,
    staleTime: 60_000,
    retry: false,
  });
}

export default function FigureInteractiveCard({ runId, metric }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(
    () => (q.data?.points ?? []).filter((p) => p.artifact_hash),
    [q.data],
  );
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];

  const meta = useMemo(
    () => safeJsonParse<FigureMetadata>(current?.artifact_metadata ?? null),
    [current],
  );
  const sourceHash =
    meta?.has_source && meta?.source_format === "plotly_json"
      ? meta.source_hash ?? null
      : null;

  const sourceQ = usePlotlySource(sourceHash);

  const mergedLayout = useMemo(() => {
    const base = (sourceQ.data?.layout ?? {}) as Record<string, unknown>;
    return {
      ...base,
      ...DARK_LAYOUT,
      font: { ...((base.font as object) ?? {}), ...(DARK_LAYOUT.font as object) },
      margin: DARK_LAYOUT.margin,
    };
  }, [sourceQ.data]);

  const showPlotly = !!sourceHash && sourceQ.isSuccess && !!sourceQ.data?.data;

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="mono text-sm font-semibold">{metric.name}</h3>
        <span className="text-xs text-fg-subtle">
          {points.length > 0
            ? `step ${current?.step ?? "—"} of ${points.length}`
            : `${metric.count} pts`}
        </span>
      </div>
      {q.isLoading ? (
        <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
      ) : current?.artifact_hash ? (
        <>
          {showPlotly ? (
            <div className="rounded bg-bg">
              <Plot
                data={(sourceQ.data?.data ?? []) as Plotly.Data[]}
                layout={mergedLayout as Partial<Plotly.Layout>}
                config={{ displayModeBar: false, responsive: true }}
                useResizeHandler
                style={{ width: "100%", height: "320px" }}
              />
            </div>
          ) : sourceHash && sourceQ.isLoading ? (
            <div className="h-48 motion-safe:animate-pulse rounded bg-bg-hover" />
          ) : (
            <div className="flex justify-center rounded bg-bg p-2">
              <img
                src={api.artifactUrl(current.artifact_hash)}
                alt={`${metric.name} @ step ${current.step}`}
                className="max-h-64 object-contain"
              />
            </div>
          )}
          {points.length > 1 && (
            <input
              type="range"
              min={0}
              max={points.length - 1}
              value={safeIdx}
              onChange={(e) => setIdx(Number(e.target.value))}
              className="mt-3 w-full accent-accent"
            />
          )}
        </>
      ) : (
        <div className="text-sm text-fg-muted">no figure logged yet</div>
      )}
    </div>
  );
}
