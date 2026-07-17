import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ColormapName } from "../types";
import { getColormapLUT } from "../colormaps";
import { useContainerSize } from "../hooks/use-container-size";
import { formatNum } from "../format";
import { AXIS } from "../theme";
import Tooltip from "../primitives/Tooltip";
import { Axis, PlotFrame, type AxisTick } from "../primitives/Axis";
import { anchorFromRect, type TooltipAnchor } from "../primitives/tooltip-position";
import { useChartViewport, type PlotRect } from "../viewport/use-chart-viewport";
import { useChartController } from "./use-chart-controller";
import PlotToolbar from "../primitives/PlotToolbar";

export interface HeatmapProps {
  /** `matrix[y][x]` cell values. Rows may be ragged only if all same length. */
  matrix: number[][];
  colormap: ColormapName;
  /** Color-scale bounds; computed from the matrix when omitted. */
  min?: number;
  max?: number;
  /** Log-compress the color scale (useful for count data). */
  logColor?: boolean;
  /** When true, `matrix[0]` renders at the top (image convention); when false,
   *  at the bottom (chart convention, e.g. low histogram bins at the base). */
  originTop?: boolean;
  xLabel?: string;
  yLabel?: string;
  valueLabel?: string;
  xTickLabel?: (i: number) => string;
  yTickLabel?: (i: number) => string;
  /** Tooltip body for a hovered cell; falls back to a default value readout. */
  tooltipContent?: (cell: { x: number; y: number; value: number }) => ReactNode;
  /** Keep cells square by locking the viewport aspect ratio (opt-in). */
  lockAspect?: boolean;
  className?: string;
}

const PAD = { top: 14, right: 64, bottom: 34, left: 46 };

export default function Heatmap({
  matrix,
  colormap,
  min,
  max,
  logColor = false,
  originTop = true,
  xLabel,
  yLabel,
  valueLabel,
  xTickLabel,
  yTickLabel,
  tooltipContent,
  lockAspect = false,
  className,
}: HeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: containerRef, size } = useContainerSize();
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    anchor: TooltipAnchor;
  } | null>(null);

  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0]!.length : 0;

  const { lo, hi } = useMemo(() => {
    if (min != null && max != null) return { lo: min, hi: max };
    let l = Infinity;
    let h = -Infinity;
    for (const row of matrix)
      for (const v of row) {
        if (!Number.isFinite(v)) continue;
        if (v < l) l = v;
        if (v > h) h = v;
      }
    if (!Number.isFinite(l)) {
      l = 0;
      h = 1;
    }
    return { lo: min ?? l, hi: max ?? h };
  }, [matrix, min, max]);

  // Paint the cells into an offscreen-sized canvas (native cols×rows), CSS
  // scales it to the plot rect (crisp pixelation for discrete cells). The
  // canvas only mounts once the container has been measured (see the
  // `plotW > 0 && plotH > 0` gate below), which happens asynchronously via
  // ResizeObserver — so `size` must be a dependency here too, otherwise the
  // very first paint attempt runs before the canvas exists (ref still null)
  // and never gets retried once it mounts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || rows === 0 || cols === 0) return;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(cols, rows);
    const lut = getColormapLUT(colormap);
    const range = hi - lo || 1;
    const logDen = logColor ? Math.log1p(range) : 1;
    for (let y = 0; y < rows; y++) {
      const row = matrix[y]!;
      const outY = originTop ? y : rows - 1 - y;
      for (let x = 0; x < cols; x++) {
        const v = row[x]!;
        let t: number;
        if (!Number.isFinite(v)) t = 0;
        else if (logColor) t = Math.log1p(Math.max(0, v - lo)) / (logDen || 1);
        else t = (v - lo) / range;
        let idx = Math.round(Math.max(0, Math.min(1, t)) * 255);
        idx = Math.max(0, Math.min(255, idx));
        const p = (outY * cols + x) * 4;
        img.data[p] = lut[idx * 3]!;
        img.data[p + 1] = lut[idx * 3 + 1]!;
        img.data[p + 2] = lut[idx * 3 + 2]!;
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [matrix, colormap, lo, hi, logColor, originTop, rows, cols, size]);

  const { w, h } = size;
  const plotW = Math.max(0, w - PAD.left - PAD.right);
  const plotH = Math.max(0, h - PAD.top - PAD.bottom);

  // Continuous cell-index viewport. x ∈ [0, cols] (columns, 0 = left edge),
  // y ∈ [0, rows] in VIEW space (0 = top of the painted canvas — the axis-flip
  // for originTop happens at the label/hover boundary, below). No padding: the
  // home view is exactly the full grid. Zoom = re-CSS-positioning the pixelated
  // canvas inside an overflow:hidden wrapper the size of the plot rect.
  const home = useMemo(
    () => ({
      xDomain: [0, Math.max(1, cols)] as [number, number],
      yDomain: [0, Math.max(1, rows)] as [number, number],
    }),
    [cols, rows],
  );
  const plotRectRef = useRef<PlotRect | null>(null);
  plotRectRef.current = { x: PAD.left, y: PAD.top, width: plotW, height: plotH };

  const viewport = useChartViewport({
    containerRef,
    plotRectRef,
    home,
    minSpan: { x: 1, y: 1 }, // never zoom past a single cell
    clamp: {
      xDomain: [0, Math.max(1, cols)],
      yDomain: [0, Math.max(1, rows)],
    },
    lockAspect,
  });
  const { domain, containerProps, dragRect } = viewport;
  const controller = useChartController({ viewport, rootRef: containerRef });

  const [xLo, xHi] = domain.xDomain;
  const [yLo, yHi] = domain.yDomain;
  const xSpan = xHi - xLo || 1;
  const ySpan = yHi - yLo || 1;

  // Canvas CSS box inside the plot-rect wrapper: scale the native cols×rows
  // canvas so the visible column/row span fills the wrapper, then offset it so
  // column xLo / view-row yLo sits at the wrapper's top-left.
  const canvasStyle = {
    position: "absolute" as const,
    left: cols > 0 ? -(xLo / xSpan) * plotW : 0,
    top: rows > 0 ? -(yLo / ySpan) * plotH : 0,
    width: cols > 0 ? (cols / xSpan) * plotW : plotW,
    height: rows > 0 ? (rows / ySpan) * plotH : plotH,
    imageRendering: "pixelated" as const,
  };

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || cols === 0 || rows === 0) return;
    const mx = e.clientX - rect.left - PAD.left;
    const my = e.clientY - rect.top - PAD.top;
    if (mx < 0 || my < 0 || mx > plotW || my > plotH) {
      setHover(null);
      return;
    }
    // Invert pixel → cell index through the live domain.
    const dataCol = xLo + (mx / plotW) * xSpan;
    const dataViewRow = yLo + (my / plotH) * ySpan;
    const cx = Math.max(0, Math.min(cols - 1, Math.floor(dataCol)));
    const cyView = Math.max(0, Math.min(rows - 1, Math.floor(dataViewRow)));
    const cy = originTop ? cyView : rows - 1 - cyView;
    setHover({ x: cx, y: cy, anchor: anchorFromRect(e, rect) });
  };

  const gradientStops = useMemo(() => {
    const lut = getColormapLUT(colormap);
    const stops: string[] = [];
    for (let i = 0; i <= 256; i += 32) {
      const idx = Math.min(255, i);
      stops.push(`rgb(${lut[idx * 3]},${lut[idx * 3 + 1]},${lut[idx * 3 + 2]})`);
    }
    return stops;
  }, [colormap]);

  const plotRect = { x: PAD.left, y: PAD.top, width: plotW, height: plotH };
  const eps = 0.5;
  // Cell-center ticks over the VISIBLE index range, mapped through the live
  // domain (x = columns, y = view-rows), so ticks track zoom/pan. The label
  // for a y tick converts the view-row back to a data-row via originTop.
  const xAxisTicks: AxisTick[] = visibleTickIndices(xLo, xHi, cols).map((i) => ({
    pos: PAD.left + ((i + 0.5 - xLo) / xSpan) * plotW,
    label: xTickLabel ? xTickLabel(i) : String(i),
  }))
    .filter((t) => t.pos >= PAD.left - eps && t.pos <= PAD.left + plotW + eps);
  const yAxisTicks: AxisTick[] = visibleTickIndices(yLo, yHi, rows).map((vr) => {
    const dataRow = originTop ? vr : rows - 1 - vr;
    return {
      pos: PAD.top + ((vr + 0.5 - yLo) / ySpan) * plotH,
      label: yTickLabel ? yTickLabel(dataRow) : String(dataRow),
    };
  })
    .filter((t) => t.pos >= PAD.top - eps && t.pos <= PAD.top + plotH + eps);

  return (
    <div
      ref={containerRef}
      className={`group relative h-full w-full ${className ?? ""}`}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      {...containerProps}
    >
      <PlotToolbar controller={controller} />
      {plotW > 0 && plotH > 0 && rows > 0 && cols > 0 && (
        <>
          {/* Plot-rect wrapper clips the zoomed canvas to the frame. */}
          <div
            className="absolute overflow-hidden"
            style={{ left: PAD.left, top: PAD.top, width: plotW, height: plotH }}
          >
            <canvas ref={canvasRef} style={canvasStyle} />
          </div>
          <svg width={w} height={h} className="pointer-events-none absolute inset-0 select-none">
            <Axis orientation="left" plot={plotRect} ticks={yAxisTicks} title={yLabel} />
            <Axis orientation="bottom" plot={plotRect} ticks={xAxisTicks} title={xLabel} />
            <PlotFrame x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
            {/* Colorbar */}
            <defs>
              <linearGradient id="heatmap-cbar" x1="0" y1="1" x2="0" y2="0">
                {gradientStops.map((c, i) => (
                  <stop
                    key={i}
                    offset={`${(i / (gradientStops.length - 1)) * 100}%`}
                    stopColor={c}
                  />
                ))}
              </linearGradient>
            </defs>
            <rect
              x={w - PAD.right + 12}
              y={PAD.top}
              width={10}
              height={plotH}
              fill="url(#heatmap-cbar)"
              stroke={AXIS.lineColor}
            />
            <text
              x={w - PAD.right + 26}
              y={PAD.top + 6}
              className="mono fill-fg-subtle"
              style={{ fontSize: AXIS.tickFontSize }}
            >
              {formatNum(hi)}
            </text>
            <text
              x={w - PAD.right + 26}
              y={PAD.top + plotH}
              className="mono fill-fg-subtle"
              style={{ fontSize: AXIS.tickFontSize }}
            >
              {formatNum(lo)}
            </text>
            {valueLabel && (
              <text
                x={w - 6}
                y={PAD.top + plotH / 2}
                textAnchor="middle"
                className="fill-fg-muted"
                style={{ fontSize: AXIS.titleFontSize }}
                transform={`rotate(90, ${w - 6}, ${PAD.top + plotH / 2})`}
              >
                {valueLabel}
              </text>
            )}
          </svg>
        </>
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

      {hover && (
        <Tooltip
          x={hover.anchor.x}
          y={hover.anchor.y}
          containerW={hover.anchor.containerW}
          containerH={hover.anchor.containerH}
        >
          {tooltipContent ? (
            tooltipContent({
              x: hover.x,
              y: hover.y,
              value: matrix[hover.y]?.[hover.x] ?? NaN,
            })
          ) : (
            <div className="flex justify-between gap-2">
              <span className="text-fg-muted">
                [{hover.y}, {hover.x}]
              </span>
              <span className="mono">{formatNum(matrix[hover.y]?.[hover.x] ?? NaN)}</span>
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Up to ~6 roughly-even integer cell indices whose cell-center (i + 0.5) falls
 * within the live [lo, hi] view span. As the viewport zooms in, `lo`/`hi`
 * tighten and the returned indices densify over the visible range; when zoomed
 * out to the full grid this reduces to evenly-spaced ticks across all `n` cells.
 */
function visibleTickIndices(lo: number, hi: number, n: number): number[] {
  if (n <= 0) return [];
  const first = Math.max(0, Math.ceil(lo - 0.5));
  const last = Math.min(n - 1, Math.floor(hi - 0.5));
  if (last < first) return [];
  const count = last - first + 1;
  const maxTicks = Math.min(6, count);
  const step = Math.max(1, Math.round(count / maxTicks));
  const out: number[] = [];
  for (let i = first; i <= last; i += step) out.push(i);
  return out;
}
