import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SERIES_COLORS, type ScatterPoint } from "../types";
import type { ParetoDirection } from "../transforms/pareto";
import { computeParetoFront } from "../transforms/pareto";
import { viridis } from "../colormaps/viridis";
import { useContainerSize } from "../hooks/use-container-size";
import { formatNum } from "../format";
import { AXIS, niceTicks, paddedDomain } from "../theme";
import { Axis, PlotFrame, type AxisTick } from "../primitives/Axis";
import Tooltip from "../primitives/Tooltip";
import { pointerAnchor, type TooltipAnchor } from "../primitives/tooltip-position";
import {
  useChartViewport,
  type PlotRect,
  type SelectionGeometry,
} from "../viewport/use-chart-viewport";
import { pointInPolygon, pointInRect } from "../viewport/chart-viewport-math";
import { useChartController } from "./use-chart-controller";
import PlotToolbar from "../primitives/PlotToolbar";

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
  // Internal box/lasso selection (a Set of point ids). Distinct from the
  // `selectedIds` prop (an external highlight): this drives the dim-others
  // visual and is surfaced on the controller. Cleared on Escape / empty click.
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const clearSelection = useCallback(() => setSelection(new Set()), []);
  // Stable wrapper for `controller.selection` — only re-identifies when the
  // selection Set changes, so it doesn't defeat the controller's memo.
  const controllerSelection = useMemo(
    () => ({ ids: selection, clear: clearSelection }),
    [selection, clearSelection],
  );
  // The viewport hook fires `onSelect` on release, but it can't see this
  // render's `toX`/`toY` (defined below). It dispatches through this ref, which
  // we repoint at the live hit-tester each render — so a selection always maps
  // through the CURRENT viewport transform.
  const selectRef = useRef<(g: SelectionGeometry) => void>(() => {});

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

  // The scatter HOME domain is the ~5%-padded data extent (in mapped log/linear
  // space) — points never touch the frame in the home position. The live
  // viewport (zoom/pan) starts here and is owned by useChartViewport.
  const homeX = paddedDomain(
    xLog ? logSafe(xDomain.min) : xDomain.min,
    xLog ? logSafe(xDomain.max) : xDomain.max,
  );
  const homeY = paddedDomain(
    yLog ? logSafe(yDomain.min) : yDomain.min,
    yLog ? logSafe(yDomain.max) : yDomain.max,
  );
  const home = useMemo(
    () => ({ xDomain: homeX, yDomain: homeY }),
    [homeX[0], homeX[1], homeY[0], homeY[1]],
  );

  // Publish the plot inset (container-local px) every render so the viewport
  // hook can hit-test wheel/pointer gestures against it.
  const plotRectRef = useRef<PlotRect | null>(null);
  plotRectRef.current = { x: pad.left, y: pad.top, width: plotW, height: plotH };

  const viewport = useChartViewport({
    containerRef,
    plotRectRef,
    home,
    onSelect: (g) => selectRef.current(g),
  });
  const { domain, containerProps, dragRect, dragPath, wasDragRef } = viewport;
  const controller = useChartController({
    viewport,
    rootRef: containerRef,
    selectable: true,
    selection: controllerSelection,
  });

  const [xMin, xMax] = domain.xDomain;
  const [yMin, yMax] = domain.yDomain;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  // toX/toY map raw data through the LIVE viewport domain (mapped space).
  const toX = (v: number) => {
    const mapped = xLog ? logSafe(v) : v;
    return pad.left + ((mapped - xMin) / xRange) * plotW;
  };
  const toY = (v: number) => {
    const mapped = yLog ? logSafe(v) : v;
    return pad.top + plotH - ((mapped - yMin) / yRange) * plotH;
  };

  // Repoint the hook's onSelect dispatcher at a hit-tester bound to THIS render's
  // toX/toY. On box/lasso release the hook hands us the marquee/polygon (in the
  // same container-local px space toX/toY emit), and we collect the enclosed
  // point ids. Assigning a ref during render is safe here: it's only read later
  // from a pointer handler, never during this render's output.
  selectRef.current = (geom: SelectionGeometry) => {
    const hit = new Set<string>();
    for (const pt of points) {
      const px = toX(pt.x);
      const py = toY(pt.y);
      const inside =
        geom.kind === "rect"
          ? pointInRect(px, py, geom.rect)
          : pointInPolygon(px, py, geom.points);
      if (inside) hit.add(pt.id);
    }
    setSelection(hit);
  };

  // Escape clears an active box/lasso selection. Scoped to when there's a
  // selection so it doesn't intercept Escape globally (e.g. closing a modal).
  useEffect(() => {
    if (selection.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection.size]);

  // Tick values: "nice"-rounded on a linear axis; evenly-spaced fractions on a
  // log axis (pretty log ticks are out of scope). Recomputed from the LIVE
  // domain so ticks update as the view zooms/pans; the range-filter drops any
  // that fall outside the frame.
  const plotRect = { x: pad.left, y: pad.top, width: plotW, height: plotH };
  const eps = 0.5;
  const xTicks: AxisTick[] = xLog
    ? [0, 0.25, 0.5, 0.75, 1].map((t) => ({
        pos: pad.left + t * plotW,
        label: formatNum(Math.pow(10, xMin + t * xRange)),
      }))
    : niceTicks(xMin, xMax)
        .map((v) => ({ pos: toX(v), label: formatNum(v) }))
        .filter((t) => t.pos >= pad.left - eps && t.pos <= pad.left + plotW + eps);
  const yTicks: AxisTick[] = yLog
    ? [0, 0.25, 0.5, 0.75, 1].map((t) => ({
        pos: pad.top + plotH - t * plotH,
        label: formatNum(Math.pow(10, yMin + t * yRange)),
      }))
    : niceTicks(yMin, yMax)
        .map((v) => ({ pos: toY(v), label: formatNum(v) }))
        .filter((t) => t.pos >= pad.top - eps && t.pos <= pad.top + plotH + eps);

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

  const clipId = `scatter-clip-${rawId.replace(/:/g, "")}`;
  return (
    <div
      ref={containerRef}
      className={`group relative ${className ?? ""}`}
      onMouseLeave={handleLeave}
      {...containerProps}
    >
      <PlotToolbar controller={controller} />
      {plotW > 0 && plotH > 0 && (
        <svg width={w} height={h} className="select-none">
          <defs>
            <clipPath id={clipId}>
              <rect x={pad.left} y={pad.top} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          <Axis orientation="left" plot={plotRect} ticks={yTicks} title={yLabel} showGrid />
          <Axis orientation="bottom" plot={plotRect} ticks={xTicks} title={xLabel} showGrid />
          <PlotFrame
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            interactive
            onClick={() => {
              if (wasDragRef.current) {
                wasDragRef.current = false;
                return;
              }
              // An empty click first clears an active box/lasso selection; only
              // with nothing selected does it fall through to the background
              // handler (the external run-deselect).
              if (selection.size > 0) {
                clearSelection();
                return;
              }
              onBackgroundClick?.();
            }}
            className="cursor-default"
          />

          {/* Marks clip to the plot rect so zoomed content never overflows. */}
          <g clipPath={`url(#${clipId})`}>
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
            const inSelection = selection.has(pt.id);
            // Accent stroke for either an externally-marked point (`selectedIds`
            // prop) or an internal box/lasso selection.
            const isSelected = !!selectedIds?.has(pt.id) || inSelection;
            const isOnPareto = paretoSet.has(pt.id);
            // While a box/lasso selection is active, fade points outside it
            // (unless hovered) to spotlight the picked set.
            const dimmed = selection.size > 0 && !inSelection && !isHovered;
            return (
              <circle
                key={pt.id}
                cx={cx}
                cy={cy}
                r={isHovered ? 7 : isOnPareto && pareto?.show ? 6 : 5}
                fill={color}
                opacity={dimmed ? 0.25 : 1}
                stroke={
                  isSelected
                    ? "var(--color-accent, #0969da)"
                    : isHovered
                      ? "#1f2328"
                      : "white"
                }
                strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
                className="cursor-pointer"
                onClick={() => {
                  if (wasDragRef.current) {
                    wasDragRef.current = false;
                    return;
                  }
                  onClick?.(pt.id);
                }}
                onMouseEnter={(e) => handlePointEnter(pt, e)}
                onMouseMove={handlePointMove}
                onMouseLeave={handleLeave}
              />
            );
          })}
          </g>

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

      {/* Live lasso polygon (container-local px), drawn closed while dragging. */}
      {dragPath && dragPath.length >= 2 && (
        <svg
          width={w}
          height={h}
          aria-hidden="true"
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        >
          <path
            d={`M${dragPath.map((p) => `${p.x},${p.y}`).join("L")}Z`}
            fill="rgba(83, 155, 245, 0.12)"
            stroke="#0969da"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
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
