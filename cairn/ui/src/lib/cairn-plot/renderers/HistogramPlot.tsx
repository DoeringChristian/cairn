import { useId, useMemo, useRef, useState } from "react";
import type { ColormapName } from "../types";
import { useContainerSize } from "../hooks/use-container-size";
import { formatNum } from "../format";
import { niceTicks, paddedDomain } from "../theme";
import { rebinHistograms, type HistogramData } from "../transforms/histogram";
import Tooltip from "../primitives/Tooltip";
import { Axis, PlotFrame, type AxisTick } from "../primitives/Axis";
import { anchorFromRect, type TooltipAnchor } from "../primitives/tooltip-position";
import { useChartViewport, type PlotRect } from "../viewport/use-chart-viewport";
import { useChartController } from "./use-chart-controller";
import PlotToolbar from "../primitives/PlotToolbar";
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
  const rawId = useId();
  const clipId = `hist-clip-${rawId.replace(/:/g, "")}`;
  const { ref: containerRef, size } = useContainerSize();
  const [hover, setHover] = useState<{ i: number; anchor: TooltipAnchor } | null>(
    null,
  );

  const { w, h } = size;
  const plotW = Math.max(0, w - PAD.left - PAD.right);
  const plotH = Math.max(0, h - PAD.top - PAD.bottom);

  const rawXMin = edges[0] ?? 0;
  const rawXMax = edges[edges.length - 1] ?? 1;

  const yMax = useMemo(() => {
    const m = counts.reduce((a, b) => Math.max(a, b), 0);
    return m > 0 ? m : 1;
  }, [counts]);
  // Count value mapped into axis space (log-compressed when logY).
  const mapY = (c: number) => (logY ? Math.log10(c + 1) : c);
  const yScaleMax = mapY(yMax);

  // HOME domain: x = ~5%-padded bin range; y = [0, top-padded max count]. The
  // bar baseline (count 0) stays anchored at the bottom in the home view.
  const homeX = paddedDomain(rawXMin, rawXMax);
  const homeYTop = yScaleMax > 0 ? yScaleMax * 1.05 : 1;
  const home = useMemo(
    () => ({ xDomain: homeX, yDomain: [0, homeYTop] as [number, number] }),
    [homeX[0], homeX[1], homeYTop],
  );

  // One-bin minimum x-span (a max-zoom floor so you can't zoom past a bin).
  const binWidth =
    counts.length > 0 ? (rawXMax - rawXMin) / counts.length : undefined;

  const plotRectRef = useRef<PlotRect | null>(null);
  plotRectRef.current = { x: PAD.left, y: PAD.top, width: plotW, height: plotH };

  const viewport = useChartViewport({
    containerRef,
    plotRectRef,
    home,
    minSpan: binWidth ? { x: binWidth } : undefined,
  });
  const { domain, containerProps, dragRect } = viewport;
  const controller = useChartController({ viewport, rootRef: containerRef });

  const [xMin, xMax] = domain.xDomain;
  const [yLo, yHi] = domain.yDomain;
  const xRange = xMax - xMin || 1;
  const yRange = yHi - yLo || 1;

  const toX = (v: number) => PAD.left + ((v - xMin) / xRange) * plotW;
  const toY = (mapped: number) =>
    PAD.top + plotH - ((mapped - yLo) / yRange) * plotH;

  const plotRect = { x: PAD.left, y: PAD.top, width: plotW, height: plotH };
  const eps = 0.5;
  const xTicks: AxisTick[] = niceTicks(xMin, xMax)
    .map((v) => ({ pos: toX(v), label: formatNum(v) }))
    .filter((t) => t.pos >= PAD.left - eps && t.pos <= PAD.left + plotW + eps);
  const yTicks: AxisTick[] = logY
    ? [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const mapped = yLo + t * yRange;
        return {
          pos: toY(mapped),
          label: formatNum(Math.pow(10, mapped) - 1),
        };
      })
    : niceTicks(yLo, yHi)
        .map((v) => ({ pos: toY(v), label: formatNum(v) }))
        .filter((t) => t.pos >= PAD.top - eps && t.pos <= PAD.top + plotH + eps);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || counts.length === 0) return;
    const mx = e.clientX - rect.left - PAD.left;
    if (mx < 0 || mx > plotW) {
      setHover(null);
      return;
    }
    // Invert through the live domain: pixel → data x → bin index.
    const dataX = xMin + (mx / plotW) * xRange;
    let bin = -1;
    for (let i = 0; i < counts.length; i++) {
      if (dataX >= edges[i]! && dataX < edges[i + 1]!) {
        bin = i;
        break;
      }
    }
    if (bin < 0) {
      setHover(null);
      return;
    }
    setHover({ i: bin, anchor: anchorFromRect(e, rect) });
  };

  const yBase = toY(0);

  return (
    <div
      ref={containerRef}
      className={`group relative h-full w-full ${className ?? ""}`}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      {...containerProps}
    >
      <PlotToolbar controller={controller} />
      {plotW > 0 && plotH > 0 && (
        <svg width={w} height={h} className="select-none">
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          <Axis orientation="left" plot={plotRect} ticks={yTicks} showGrid />
          <Axis orientation="bottom" plot={plotRect} ticks={xTicks} showGrid />
          <PlotFrame x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          <g clipPath={`url(#${clipId})`}>
          {counts.map((c, i) => {
            const x0 = toX(edges[i]!);
            const x1 = toX(edges[i + 1]!);
            const bw = Math.max(0.5, x1 - x0 - 0.5);
            const yTop = toY(mapY(c));
            const yA = Math.min(yTop, yBase);
            const bh = Math.abs(yBase - yTop);
            return (
              <rect
                key={i}
                x={x0}
                y={yA}
                width={bw}
                height={bh}
                className={hover?.i === i ? "fill-accent" : "fill-accent/70"}
              />
            );
          })}
          </g>
        </svg>
      )}
      {dragRect && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.width,
            height: dragRect.height,
            border: "1px solid #0969da",
            background: "rgba(83, 155, 245, 0.12)",
            pointerEvents: "none",
          }}
        />
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
