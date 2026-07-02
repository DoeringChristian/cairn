import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ColormapName } from "../types";
import { getColormapLUT } from "../colormaps";
import { useContainerSize } from "../hooks/use-container-size";
import Tooltip from "../primitives/Tooltip";

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
  className?: string;
}

const PAD = { top: 14, right: 64, bottom: 26, left: 46 };

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
  className,
}: HeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: containerRef, size } = useContainerSize();
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    px: number;
    py: number;
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
  // scales it to the plot rect (crisp pixelation for discrete cells).
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
  }, [matrix, colormap, lo, hi, logColor, originTop, rows, cols]);

  const { w, h } = size;
  const plotW = Math.max(0, w - PAD.left - PAD.right);
  const plotH = Math.max(0, h - PAD.top - PAD.bottom);

  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || cols === 0 || rows === 0) return;
    const mx = e.clientX - rect.left - PAD.left;
    const my = e.clientY - rect.top - PAD.top;
    if (mx < 0 || my < 0 || mx > plotW || my > plotH) {
      setHover(null);
      return;
    }
    const cx = Math.min(cols - 1, Math.floor((mx / plotW) * cols));
    const cyView = Math.min(rows - 1, Math.floor((my / plotH) * rows));
    const cy = originTop ? cyView : rows - 1 - cyView;
    setHover({
      x: cx,
      y: cy,
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
    });
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

  const xTicks = tickPositions(cols);
  const yTicks = tickPositions(rows);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full ${className ?? ""}`}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      {plotW > 0 && plotH > 0 && rows > 0 && cols > 0 && (
        <>
          <canvas
            ref={canvasRef}
            className="absolute"
            style={{
              left: PAD.left,
              top: PAD.top,
              width: plotW,
              height: plotH,
              imageRendering: "pixelated",
            }}
          />
          <svg width={w} height={h} className="pointer-events-none absolute inset-0 select-none">
            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotW}
              height={plotH}
              fill="none"
              stroke="#d0d7de"
            />
            {xLabel && (
              <text
                x={PAD.left + plotW / 2}
                y={h - 2}
                textAnchor="middle"
                className="fill-fg-muted"
                style={{ fontSize: 10 }}
              >
                {xLabel}
              </text>
            )}
            {yLabel && (
              <text
                x={10}
                y={PAD.top + plotH / 2}
                textAnchor="middle"
                className="fill-fg-muted"
                style={{ fontSize: 10 }}
                transform={`rotate(-90, 10, ${PAD.top + plotH / 2})`}
              >
                {yLabel}
              </text>
            )}
            {xTicks.map((i) => (
              <text
                key={`x${i}`}
                x={PAD.left + ((i + 0.5) / cols) * plotW}
                y={PAD.top + plotH + 12}
                textAnchor="middle"
                className="mono fill-fg-subtle"
                style={{ fontSize: 8 }}
              >
                {xTickLabel ? xTickLabel(i) : i}
              </text>
            ))}
            {yTicks.map((i) => {
              const viewRow = originTop ? i : rows - 1 - i;
              return (
                <text
                  key={`y${i}`}
                  x={PAD.left - 4}
                  y={PAD.top + ((viewRow + 0.5) / rows) * plotH + 3}
                  textAnchor="end"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: 8 }}
                >
                  {yTickLabel ? yTickLabel(i) : i}
                </text>
              );
            })}
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
              stroke="#d0d7de"
            />
            <text
              x={w - PAD.right + 26}
              y={PAD.top + 6}
              className="mono fill-fg-subtle"
              style={{ fontSize: 8 }}
            >
              {fmt(hi)}
            </text>
            <text
              x={w - PAD.right + 26}
              y={PAD.top + plotH}
              className="mono fill-fg-subtle"
              style={{ fontSize: 8 }}
            >
              {fmt(lo)}
            </text>
            {valueLabel && (
              <text
                x={w - 6}
                y={PAD.top + plotH / 2}
                textAnchor="middle"
                className="fill-fg-muted"
                style={{ fontSize: 9 }}
                transform={`rotate(90, ${w - 6}, ${PAD.top + plotH / 2})`}
              >
                {valueLabel}
              </text>
            )}
          </svg>
        </>
      )}

      {hover && (
        <Tooltip x={hover.px} y={hover.py} containerW={w} containerH={h}>
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
              <span className="mono">{fmt(matrix[hover.y]?.[hover.x] ?? NaN)}</span>
            </div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

/** Up to 6 roughly-even tick indices across `n` cells. */
function tickPositions(n: number): number[] {
  if (n <= 0) return [];
  const maxTicks = Math.min(6, n);
  const step = Math.max(1, Math.floor(n / maxTicks));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  return out;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000 || a < 1e-3) return v.toExponential(2);
  return Number(v.toPrecision(4)).toString();
}
