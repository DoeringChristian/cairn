import { useId, useMemo, useState, type ReactNode } from "react";
import { SERIES_COLORS, type ScatterPoint } from "../types";
import type { ParetoDirection } from "../transforms/pareto";
import { computeParetoFront } from "../transforms/pareto";
import { viridis } from "../colormaps/viridis";
import { useContainerSize } from "../hooks/use-container-size";
import { formatNum } from "../format";
import { AXIS } from "../theme";
import Tooltip from "../primitives/Tooltip";
import { pointerAnchor, type TooltipAnchor } from "../primitives/tooltip-position";

const DEFAULT_COLORS = SERIES_COLORS;

export interface ScatterPlotProps {
  points: ScatterPoint[];
  xLabel?: string;
  yLabel?: string;
  colorLabel?: string;
  xLog?: boolean;
  yLog?: boolean;
  pareto?: { show: boolean; direction: ParetoDirection };
  selectedIds?: Set<string>;
  onHover?: (
    pointId: string | null,
    screen: {
      x: number;
      y: number;
      containerW: number;
      containerH: number;
    } | null,
  ) => void;
  onClick?: (pointId: string) => void;
  onBackgroundClick?: () => void;
  tooltipContent?: (point: ScatterPoint) => ReactNode;
  colors?: string[];
  className?: string;
}

export default function ScatterPlot({
  points,
  xLabel,
  yLabel,
  colorLabel,
  xLog,
  yLog,
  pareto,
  selectedIds,
  onHover,
  onClick,
  onBackgroundClick,
  tooltipContent,
  colors = DEFAULT_COLORS,
  className,
}: ScatterPlotProps) {
  const rawId = useId();
  const gradientId = `scatter-cbar-${rawId.replace(/:/g, "")}`;
  const { ref: containerRef, size } = useContainerSize();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipAnchor | null>(null);

  const { xDomain, yDomain, colorDomain } = useMemo(() => {
    const makeDomain = (vals: number[]) => {
      if (!vals.length) return { min: 0, max: 1 };
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      return lo === hi
        ? { min: lo - 0.5, max: hi + 0.5 }
        : { min: lo, max: hi };
    };
    return {
      xDomain: makeDomain(points.map((p) => p.x)),
      yDomain: makeDomain(points.map((p) => p.y)),
      colorDomain: makeDomain(
        points.map((p) => p.color).filter((v): v is number => v != null),
      ),
    };
  }, [points]);

  const paretoFront = useMemo(() => {
    if (!pareto?.show) return [];
    return computeParetoFront(points, pareto.direction);
  }, [points, pareto?.show, pareto?.direction]);

  const paretoSet = useMemo(
    () => new Set(paretoFront.map((p) => p.id)),
    [paretoFront],
  );

  const handlePointEnter = (pt: ScatterPoint, e: React.MouseEvent) => {
    setHoveredId(pt.id);
    const anchor = pointerAnchor(e, containerRef);
    if (anchor) {
      setTooltipPos(anchor);
      onHover?.(pt.id, anchor);
    }
  };

  const handlePointMove = (e: React.MouseEvent) => {
    const anchor = pointerAnchor(e, containerRef);
    if (anchor) setTooltipPos(anchor);
  };

  const handleLeave = () => {
    setHoveredId(null);
    setTooltipPos(null);
    onHover?.(null, null);
  };

  const { w, h } = size;
  const hasColorbar = !!colorLabel;
  const pad = {
    top: 20,
    bottom: 40,
    left: 55,
    right: hasColorbar ? 70 : 30,
  };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const logSafe = (v: number) => Math.log10(Math.max(v, 1e-10));

  const xMin = xLog ? logSafe(xDomain.min) : xDomain.min;
  const xMax = xLog ? logSafe(xDomain.max) : xDomain.max;
  const yMin = yLog ? logSafe(yDomain.min) : yDomain.min;
  const yMax = yLog ? logSafe(yDomain.max) : yDomain.max;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const toX = (v: number) => {
    const mapped = xLog ? logSafe(v) : v;
    return pad.left + ((mapped - xMin) / xRange) * plotW;
  };
  const toY = (v: number) => {
    const mapped = yLog ? logSafe(v) : v;
    return pad.top + plotH - ((mapped - yMin) / yRange) * plotH;
  };

  let paretoPath = "";
  if (pareto?.show && paretoFront.length >= 2) {
    const dir = pareto.direction;
    const sorted = [...paretoFront].sort((a, b) => a.x - b.x);
    const parts: string[] = [`M${toX(sorted[0].x)},${toY(sorted[0].y)}`];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (dir.endsWith("min")) {
        parts.push(`L${toX(curr.x)},${toY(prev.y)}`);
      } else {
        parts.push(`L${toX(prev.x)},${toY(curr.y)}`);
      }
      parts.push(`L${toX(curr.x)},${toY(curr.y)}`);
    }
    paretoPath = parts.join(" ");
  }

  const hoveredPoint = hoveredId
    ? (points.find((p) => p.id === hoveredId) ?? null)
    : null;

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ""}`}
      onMouseLeave={handleLeave}
    >
      {plotW > 0 && plotH > 0 && (
        <svg width={w} height={h} className="select-none">
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            stroke={AXIS.lineColor}
            onClick={onBackgroundClick}
            className="cursor-default"
          />

          {xLabel && (
            <text
              x={pad.left + plotW / 2}
              y={h - 4}
              textAnchor="middle"
              className="fill-fg-muted"
              style={{ fontSize: AXIS.titleFontSize }}
            >
              {xLabel}
            </text>
          )}
          {yLabel && (
            <text
              x={12}
              y={pad.top + plotH / 2}
              textAnchor="middle"
              className="fill-fg-muted"
              style={{ fontSize: AXIS.titleFontSize }}
              transform={`rotate(-90, 12, ${pad.top + plotH / 2})`}
            >
              {yLabel}
            </text>
          )}

          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const xTickLog = xMin + t * xRange;
            const yTickLog = yMin + t * yRange;
            const xTickLabel = xLog
              ? formatNum(Math.pow(10, xTickLog))
              : formatNum(xDomain.min + t * (xDomain.max - xDomain.min));
            const yTickLabel = yLog
              ? formatNum(Math.pow(10, yTickLog))
              : formatNum(yDomain.min + t * (yDomain.max - yDomain.min));
            return (
              <g key={t}>
                <text
                  x={pad.left + t * plotW}
                  y={pad.top + plotH + 14}
                  textAnchor="middle"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: AXIS.tickFontSize }}
                >
                  {xTickLabel}
                </text>
                <text
                  x={pad.left - 4}
                  y={pad.top + plotH - t * plotH + 3}
                  textAnchor="end"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: AXIS.tickFontSize }}
                >
                  {yTickLabel}
                </text>
              </g>
            );
          })}

          {paretoPath && (
            <path
              d={paretoPath}
              fill="none"
              stroke="var(--color-accent, #0969da)"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.7}
            />
          )}

          {points.map((pt, i) => {
            const cx = toX(pt.x);
            const cy = toY(pt.y);
            let color: string;
            if (colorLabel && pt.color != null) {
              const t =
                (pt.color - colorDomain.min) /
                (colorDomain.max - colorDomain.min);
              color = viridis(t);
            } else {
              color = colors[i % colors.length];
            }
            const isHovered = hoveredId === pt.id;
            const isSelected = selectedIds?.has(pt.id);
            const isOnPareto = paretoSet.has(pt.id);
            return (
              <circle
                key={pt.id}
                cx={cx}
                cy={cy}
                r={isHovered ? 7 : isOnPareto && pareto?.show ? 6 : 5}
                fill={color}
                stroke={
                  isSelected
                    ? "var(--color-accent, #0969da)"
                    : isHovered
                      ? "#1f2328"
                      : "white"
                }
                strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
                className="cursor-pointer"
                onClick={() => onClick?.(pt.id)}
                onMouseEnter={(e) => handlePointEnter(pt, e)}
                onMouseMove={handlePointMove}
                onMouseLeave={handleLeave}
              />
            );
          })}

          {hasColorbar && (() => {
            const barX = w - pad.right + 10;
            const barW = 12;
            const cMid = (colorDomain.min + colorDomain.max) / 2;
            return (
              <>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor={viridis(0)} />
                    <stop offset="50%" stopColor={viridis(0.5)} />
                    <stop offset="100%" stopColor={viridis(1)} />
                  </linearGradient>
                </defs>
                <rect
                  x={barX}
                  y={pad.top}
                  width={barW}
                  height={plotH}
                  fill={`url(#${gradientId})`}
                  stroke={AXIS.lineColor}
                />
                <text
                  x={barX + barW + 4}
                  y={pad.top + plotH + 3}
                  textAnchor="start"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: AXIS.tickFontSize }}
                >
                  {formatNum(colorDomain.min)}
                </text>
                <text
                  x={barX + barW + 4}
                  y={pad.top + plotH / 2 + 3}
                  textAnchor="start"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: AXIS.tickFontSize }}
                >
                  {formatNum(cMid)}
                </text>
                <text
                  x={barX + barW + 4}
                  y={pad.top + 3}
                  textAnchor="start"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: AXIS.tickFontSize }}
                >
                  {formatNum(colorDomain.max)}
                </text>
                <text
                  x={barX + barW + 18}
                  y={pad.top + plotH / 2}
                  textAnchor="middle"
                  className="fill-fg-muted"
                  style={{ fontSize: AXIS.titleFontSize }}
                  transform={`rotate(90, ${barX + barW + 18}, ${pad.top + plotH / 2})`}
                >
                  {colorLabel}
                </text>
              </>
            );
          })()}
        </svg>
      )}

      {hoveredPoint && tooltipPos && (
        <Tooltip
          x={tooltipPos.x}
          y={tooltipPos.y}
          containerW={tooltipPos.containerW}
          containerH={tooltipPos.containerH}
        >
          {tooltipContent ? (
            tooltipContent(hoveredPoint)
          ) : (
            <>
              {hoveredPoint.label && (
                <div className="font-semibold mono mb-1 truncate">
                  {hoveredPoint.label}
                </div>
              )}
              {xLabel && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">{xLabel}</span>
                  <span className="mono">
                    {hoveredPoint.x.toPrecision(4)}
                  </span>
                </div>
              )}
              {yLabel && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">{yLabel}</span>
                  <span className="mono">
                    {hoveredPoint.y.toPrecision(4)}
                  </span>
                </div>
              )}
              {colorLabel && hoveredPoint.color != null && (
                <div className="flex justify-between gap-2">
                  <span className="text-fg-muted">{colorLabel}</span>
                  <span className="mono">
                    {hoveredPoint.color.toPrecision(4)}
                  </span>
                </div>
              )}
            </>
          )}
        </Tooltip>
      )}
    </div>
  );
}
