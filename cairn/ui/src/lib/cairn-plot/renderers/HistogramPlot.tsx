import { useMemo, useState } from "react";
import type { ColormapName } from "../types";
import { useContainerSize } from "../hooks/use-container-size";
import { formatNum } from "../format";
import { rebinHistograms, type HistogramData } from "../transforms/histogram";
import Tooltip from "../primitives/Tooltip";
import { anchorFromRect, type TooltipAnchor } from "../primitives/tooltip-position";
import Heatmap from "./Heatmap";

export type HistogramPlotProps = { className?: string } & (
  | {
      /** Single-step bar chart of counts vs bin edges. */
      view: "bars";
      counts: number[];
      edges: number[];
      logY?: boolean;
    }
  | {
      /** Step × bin heatmap (W&B-style) across all logged steps. */
      view: "heatmap";
      perStep: Array<{ step: number } & HistogramData>;
      colormap: ColormapName;
      logColor?: boolean;
      bins?: number;
    }
);

const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

export default function HistogramPlot(props: HistogramPlotProps) {
  if (props.view === "heatmap") return <HistogramHeatmap {...props} />;
  return <HistogramBars {...props} />;
}

// ---------------------------------------------------------------------------
// Per-step bar chart
// ---------------------------------------------------------------------------
function HistogramBars({
  counts,
  edges,
  logY,
  className,
}: {
  counts: number[];
  edges: number[];
  logY?: boolean;
  className?: string;
}) {
  const { ref: containerRef, size } = useContainerSize();
  const [hover, setHover] = useState<{ i: number; anchor: TooltipAnchor } | null>(
    null,
  );

  const { w, h } = size;
  const plotW = Math.max(0, w - PAD.left - PAD.right);
  const plotH = Math.max(0, h - PAD.top - PAD.bottom);

  const xMin = edges[0] ?? 0;
  const xMax = edges[edges.length - 1] ?? 1;
  const xRange = xMax - xMin || 1;

  const yMax = useMemo(() => {
    const m = counts.reduce((a, b) => Math.max(a, b), 0);
    return m > 0 ? m : 1;
  }, [counts]);
  const yScaleMax = logY ? Math.log10(yMax + 1) : yMax;

  const toX = (v: number) => PAD.left + ((v - xMin) / xRange) * plotW;
  const barH = (c: number) => {
    const val = logY ? Math.log10(c + 1) : c;
    return (val / (yScaleMax || 1)) * plotH;
  };

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || counts.length === 0) return;
    const mx = e.clientX - rect.left - PAD.left;
    if (mx < 0 || mx > plotW) {
      setHover(null);
      return;
    }
    const i = Math.min(counts.length - 1, Math.floor((mx / plotW) * counts.length));
    setHover({ i, anchor: anchorFromRect(e, rect) });
  };

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full ${className ?? ""}`}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      {plotW > 0 && plotH > 0 && (
        <svg width={w} height={h} className="select-none">
          <rect
            x={PAD.left}
            y={PAD.top}
            width={plotW}
            height={plotH}
            fill="none"
            stroke="#d0d7de"
          />
          {[0, 0.5, 1].map((t) => {
            const val = logY
              ? Math.pow(10, t * yScaleMax) - 1
              : t * yScaleMax;
            return (
              <text
                key={t}
                x={PAD.left - 4}
                y={PAD.top + plotH - t * plotH + 3}
                textAnchor="end"
                className="mono fill-fg-subtle"
                style={{ fontSize: 8 }}
              >
                {formatNum(val)}
              </text>
            );
          })}
          {[0, 0.5, 1].map((t) => (
            <text
              key={`x${t}`}
              x={PAD.left + t * plotW}
              y={PAD.top + plotH + 12}
              textAnchor="middle"
              className="mono fill-fg-subtle"
              style={{ fontSize: 8 }}
            >
              {formatNum(xMin + t * xRange)}
            </text>
          ))}
          {counts.map((c, i) => {
            const x0 = toX(edges[i]!);
            const x1 = toX(edges[i + 1]!);
            const bw = Math.max(0.5, x1 - x0 - 0.5);
            const bh = barH(c);
            return (
              <rect
                key={i}
                x={x0}
                y={PAD.top + plotH - bh}
                width={bw}
                height={bh}
                className={hover?.i === i ? "fill-accent" : "fill-accent/70"}
              />
            );
          })}
        </svg>
      )}
      {hover && counts[hover.i] != null && (
        <Tooltip
          x={hover.anchor.x}
          y={hover.anchor.y}
          containerW={hover.anchor.containerW}
          containerH={hover.anchor.containerH}
        >
          <div className="mb-1 mono font-semibold">
            [{formatNum(edges[hover.i]!)}, {formatNum(edges[hover.i + 1]!)})
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-fg-muted">count</span>
            <span className="mono">{formatNum(counts[hover.i]!)}</span>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step × bin heatmap
// ---------------------------------------------------------------------------
function HistogramHeatmap({
  perStep,
  colormap,
  logColor,
  bins = 64,
  className,
}: {
  perStep: Array<{ step: number } & HistogramData>;
  colormap: ColormapName;
  logColor?: boolean;
  bins?: number;
  className?: string;
}) {
  const { matrix, yEdges, steps } = useMemo(() => {
    const { yEdges, matrix } = rebinHistograms(perStep, bins);
    // rebin gives matrix[step][bin]; transpose to matrix[bin][step] for Heatmap.
    const nBins = yEdges.length - 1;
    const heat: number[][] = [];
    for (let b = 0; b < nBins; b++) {
      const row: number[] = [];
      for (let s = 0; s < matrix.length; s++) row.push(matrix[s]![b]!);
      heat.push(row);
    }
    return { matrix: heat, yEdges, steps: perStep.map((p) => p.step) };
  }, [perStep, bins]);

  return (
    <Heatmap
      className={className}
      matrix={matrix}
      colormap={colormap}
      logColor={logColor}
      originTop={false}
      xLabel="step"
      yLabel="value"
      valueLabel="count"
      xTickLabel={(i) => String(steps[i] ?? i)}
      yTickLabel={(i) => formatNum(yEdges[i] ?? 0)}
      tooltipContent={({ x, y, value }) => (
        <>
          <div className="mb-1 mono font-semibold">step {steps[x] ?? x}</div>
          <div className="flex justify-between gap-2">
            <span className="text-fg-muted">bin</span>
            <span className="mono">
              [{formatNum(yEdges[y] ?? 0)}, {formatNum(yEdges[y + 1] ?? 0)})
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-fg-muted">count</span>
            <span className="mono">{formatNum(value)}</span>
          </div>
        </>
      )}
    />
  );
}
