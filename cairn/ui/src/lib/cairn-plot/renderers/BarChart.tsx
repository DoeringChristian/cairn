import { useMemo, useState, type ReactNode } from "react";
import { SERIES_COLORS } from "../types";
import { formatNum } from "../format";
import { useContainerSize } from "../hooks/use-container-size";
import Tooltip from "../primitives/Tooltip";

const DEFAULT_COLORS = SERIES_COLORS;

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  /** Explicit bar color; falls back to the SERIES_COLORS cycle by index. */
  color?: string;
}

export interface BarChartProps {
  bars: BarDatum[];
  /** Axis caption for the value dimension (e.g. the metric name). */
  valueLabel?: string;
  /** Logarithmic value axis (only positive values are plotted under log). */
  logX?: boolean;
  selectedIds?: Set<string>;
  onClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  tooltipContent?: (bar: BarDatum) => ReactNode;
  colors?: string[];
  className?: string;
}

/**
 * Horizontal bar chart — one bar per datum, drawn top-to-bottom in the order
 * given (callers sort). Pure SVG, self-contained resize via useContainerSize,
 * mirroring ScatterPlot's structure (tooltip, selection outline, log axis).
 */
export default function BarChart({
  bars,
  valueLabel,
  logX,
  selectedIds,
  onClick,
  onBackgroundClick,
  tooltipContent,
  colors = DEFAULT_COLORS,
  className,
}: BarChartProps) {
  const { ref: containerRef, size } = useContainerSize();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  const logSafe = (v: number) => Math.log10(Math.max(v, 1e-10));

  const domain = useMemo(() => {
    if (!bars.length) return { min: 0, max: 1 };
    const vals = bars.map((b) => b.value).filter((v) => Number.isFinite(v));
    if (!vals.length) return { min: 0, max: 1 };
    if (logX) {
      const positives = vals.filter((v) => v > 0);
      if (!positives.length) return { min: 1e-3, max: 1 };
      return { min: Math.min(...positives), max: Math.max(...positives) };
    }
    // Linear axis always includes the zero baseline.
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    return lo === hi ? { min: lo, max: hi + 1 } : { min: lo, max: hi };
  }, [bars, logX]);

  const { w, h } = size;
  const longestLabel = useMemo(
    () => bars.reduce((m, b) => Math.max(m, b.label.length), 0),
    [bars],
  );
  const pad = {
    top: 12,
    bottom: 28,
    left: Math.min(160, Math.max(60, longestLabel * 6.2 + 12)),
    right: 56,
  };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const dMin = logX ? logSafe(domain.min) : domain.min;
  const dMax = logX ? logSafe(domain.max) : domain.max;
  const range = dMax - dMin || 1;
  const toX = (v: number) => {
    const mapped = logX ? logSafe(Math.max(v, 1e-10)) : v;
    return pad.left + ((mapped - dMin) / range) * plotW;
  };
  // Baseline: value 0 for linear (clamped into the plot), left edge for log.
  const baseX = logX ? pad.left : Math.max(pad.left, Math.min(pad.left + plotW, toX(0)));

  const n = bars.length;
  const rowH = n > 0 ? plotH / n : 0;
  const barH = Math.max(2, Math.min(28, rowH * 0.62));

  const handleEnter = (b: BarDatum, e: React.MouseEvent) => {
    setHoveredId(b.id);
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  const handleMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };
  const handleLeave = () => {
    setHoveredId(null);
    setTooltipPos(null);
  };

  const hoveredBar = hoveredId
    ? (bars.find((b) => b.id === hoveredId) ?? null)
    : null;

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ""}`}
      onMouseLeave={handleLeave}
    >
      {plotW > 0 && plotH > 0 && (
        <svg width={w} height={h} className="select-none">
          {/* Background — clears selection on click. */}
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            fill="transparent"
            onClick={onBackgroundClick}
          />

          {/* Value axis gridlines + ticks. */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const gx = pad.left + t * plotW;
            const dv = dMin + t * range;
            const label = logX ? Math.pow(10, dv) : dv;
            return (
              <g key={t}>
                <line
                  x1={gx}
                  y1={pad.top}
                  x2={gx}
                  y2={pad.top + plotH}
                  stroke="currentColor"
                  className="text-border-subtle"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                  opacity={0.5}
                />
                <text
                  x={gx}
                  y={pad.top + plotH + 12}
                  textAnchor="middle"
                  className="mono text-[8px] fill-fg-subtle"
                  style={{ fontSize: 8 }}
                >
                  {formatNum(label)}
                </text>
              </g>
            );
          })}

          {valueLabel && (
            <text
              x={pad.left + plotW / 2}
              y={h - 2}
              textAnchor="middle"
              className="text-[10px] fill-fg-muted"
              style={{ fontSize: 10 }}
            >
              {valueLabel}
            </text>
          )}

          {bars.map((b, i) => {
            const cy = pad.top + i * rowH + rowH / 2;
            const vx = toX(b.value);
            const x0 = Math.min(baseX, vx);
            const x1 = Math.max(baseX, vx);
            const color = b.color ?? colors[i % colors.length];
            const isHovered = hoveredId === b.id;
            const isSelected = selectedIds?.has(b.id);
            const valAtRight = vx >= baseX;
            return (
              <g
                key={b.id}
                className="cursor-pointer"
                onClick={() => onClick?.(b.id)}
                onMouseEnter={(e) => handleEnter(b, e)}
                onMouseMove={handleMove}
                onMouseLeave={handleLeave}
              >
                {/* Run label. */}
                <text
                  x={pad.left - 6}
                  y={cy + 3}
                  textAnchor="end"
                  className={`mono text-[10px] ${isSelected ? "fill-accent" : "fill-fg-muted"}`}
                  style={{ fontSize: 10 }}
                >
                  {b.label.length > 24 ? b.label.slice(0, 23) + "…" : b.label}
                </text>
                <rect
                  x={x0}
                  y={cy - barH / 2}
                  width={Math.max(0, x1 - x0)}
                  height={barH}
                  rx={2}
                  fill={color}
                  opacity={isHovered ? 1 : 0.85}
                  stroke={isSelected ? "var(--color-accent, #0969da)" : "transparent"}
                  strokeWidth={isSelected ? 2 : 0}
                />
                {/* Value label at the bar's end. */}
                <text
                  x={valAtRight ? x1 + 4 : x0 - 4}
                  y={cy + 3}
                  textAnchor={valAtRight ? "start" : "end"}
                  className="mono text-[9px] fill-fg-subtle"
                  style={{ fontSize: 9 }}
                >
                  {formatNum(b.value)}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {hoveredBar && tooltipPos && (
        <Tooltip x={tooltipPos.x} y={tooltipPos.y} containerW={w} containerH={h}>
          {tooltipContent ? (
            tooltipContent(hoveredBar)
          ) : (
            <>
              <div className="font-semibold mono mb-1 truncate">
                {hoveredBar.label}
              </div>
              {valueLabel && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">{valueLabel}</span>
                  <span className="mono">{formatNum(hoveredBar.value)}</span>
                </div>
              )}
            </>
          )}
        </Tooltip>
      )}
    </div>
  );
}
