import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { SERIES_COLORS } from "../types";
import { formatNum } from "../format";
import { niceTicks } from "../theme";
import { Axis, type AxisTick } from "../primitives/Axis";
import { useContainerSize } from "../hooks/use-container-size";
import Tooltip from "../primitives/Tooltip";
import { pointerAnchor, type TooltipAnchor } from "../primitives/tooltip-position";
import { useChartViewport, type PlotRect } from "../viewport/use-chart-viewport";
import { useChartController } from "./use-chart-controller";
import { useSeriesVisibility } from "../hooks/use-series-visibility";
import PlotToolbar from "../primitives/PlotToolbar";

const DEFAULT_COLORS = SERIES_COLORS;

export interface BarDatum {
  id: string;
  label: string;
  value: number;
  /** Explicit bar color; falls back to the SERIES_COLORS cycle by index. */
  color?: string;
}

/**
 * How multiple runs' bars (all belonging to the single metric/category this
 * card currently plots) are composed against one another. Only meaningful
 * when `bars.length > 1` — a single-run chart always renders one bar
 * regardless of mode.
 *
 *  - "grouped": today's default — one full row per run, independently
 *    positioned/sorted (per the card's sort settings).
 *  - "stacked": all runs collapse into a single row, segments laid end to
 *    end in `runOrder` (NOT the sorted `bars` order — stacking order must
 *    stay stable regardless of sort, per spec). Disallowed together with a
 *    log axis (summing in log space is misleading); callers should fall
 *    back to "grouped" and explain why when `logX` is set.
 *  - "overlay": all runs collapse into a single row, drawn as translucent
 *    full-width bars superimposed in the given `bars` order (so the card's
 *    sort setting controls which bar is drawn on top).
 */
export type BarCompareMode = "grouped" | "stacked" | "overlay";

export interface BarChartProps {
  bars: BarDatum[];
  /** Axis caption for the value dimension (e.g. the metric name). */
  valueLabel?: string;
  /** Logarithmic value axis (only positive values are plotted under log). */
  logX?: boolean;
  /** How to compose multiple runs' bars. Default "grouped" (today's look). */
  compareMode?: BarCompareMode;
  /**
   * Run id order used to lay out "stacked" segments (independent of the
   * `bars` array's sort order). Falls back to `bars` order when omitted.
   */
  runOrder?: string[];
  selectedIds?: Set<string>;
  onClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  tooltipContent?: (bar: BarDatum) => ReactNode;
  colors?: string[];
  className?: string;
}

interface StackSegment {
  bar: BarDatum;
  start: number;
  end: number;
  total: number;
}

/**
 * Horizontal bar chart. Pure SVG, self-contained resize via
 * useContainerSize, mirroring ScatterPlot's structure (tooltip, selection
 * outline, log axis). Draws either one row per run ("grouped", the
 * historical single-mode layout) or a single composed row ("stacked" /
 * "overlay") when a card feeds it multiple runs' bars for the same metric.
 */
export default function BarChart({
  bars,
  valueLabel,
  logX,
  compareMode,
  runOrder,
  selectedIds,
  onClick,
  onBackgroundClick,
  tooltipContent,
  colors = DEFAULT_COLORS,
  className,
}: BarChartProps) {
  const { ref: containerRef, size } = useContainerSize();
  const rawId = useId();
  const clipId = `bar-clip-${rawId.replace(/:/g, "")}`;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipAnchor | null>(null);

  const requestedMode: BarCompareMode = compareMode ?? "grouped";
  // Stacking totals in log space is misleading — fall back to grouped and
  // surface why via an on-chart note.
  const stackedDisabledByLog = requestedMode === "stacked" && !!logX;
  const mode: BarCompareMode = stackedDisabledByLog ? "grouped" : requestedMode;
  const composed = mode !== "grouped" && bars.length > 1;

  const logSafe = (v: number) => Math.log10(Math.max(v, 1e-10));

  // Stacked segments (only computed when needed): lay out in `runOrder`
  // (falls back to `bars` order), signed so positive/negative values stack
  // on their own side of the zero baseline.
  const stackSegments = useMemo<StackSegment[]>(() => {
    if (mode !== "stacked" || !composed) return [];
    const order = runOrder?.length ? runOrder : bars.map((b) => b.id);
    const byId = new Map(bars.map((b) => [b.id, b]));
    const total = bars.reduce((s, b) => s + b.value, 0);
    let pos = 0;
    let neg = 0;
    const out: StackSegment[] = [];
    for (const id of order) {
      const bar = byId.get(id);
      if (!bar) continue;
      if (bar.value >= 0) {
        out.push({ bar, start: pos, end: pos + bar.value, total });
        pos += bar.value;
      } else {
        out.push({ bar, start: neg + bar.value, end: neg, total });
        neg += bar.value;
      }
    }
    return out;
  }, [mode, composed, bars, runOrder]);

  const domain = useMemo(() => {
    if (!bars.length) return { min: 0, max: 1 };
    if (mode === "stacked" && composed) {
      // Stacked axis scaling uses the summed extent, not per-bar max.
      const posSum = stackSegments.reduce((m, s) => Math.max(m, s.end), 0);
      const negSum = stackSegments.reduce((m, s) => Math.min(m, s.start), 0);
      const lo = Math.min(0, negSum);
      const hi = Math.max(0, posSum);
      return lo === hi ? { min: lo, max: hi + 1 } : { min: lo, max: hi };
    }
    // Grouped and overlay both scale to the largest individual bar.
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
  }, [bars, logX, mode, composed, stackSegments]);

  const { w, h } = size;
  const longestLabel = useMemo(
    () => bars.reduce((m, b) => Math.max(m, b.label.length), 0),
    [bars],
  );
  // Legend chip x-offsets, laid out left to right in `bars` order (i.e. the
  // card's sort order) starting at the left plot edge.
  const legendChips = useMemo(() => {
    let x = 0;
    return bars.map((b, i) => {
      const chipX = x;
      const textLen = Math.min(b.label.length, 24) * 5.4;
      x += 14 + textLen + 12;
      return { bar: b, x: chipX, color: b.color ?? colors[i % colors.length] };
    });
  }, [bars, colors]);
  const rowLabel = composed
    ? mode === "stacked"
      ? "Total"
      : "Overlay"
    : "";
  // Reserve a row of legend chips above the plot whenever multiple runs are
  // composed into a single row (stacked/overlay) — grouped mode already
  // labels each row with its run, but chips are shown there too for a
  // consistent way to read off run -> color.
  const showLegend = bars.length > 1;
  const pad = {
    top: showLegend ? 26 : 12,
    bottom: 34,
    left: composed
      ? Math.max(60, rowLabel.length * 6.2 + 12)
      : Math.min(160, Math.max(60, longestLabel * 6.2 + 12)),
    right: 56,
  };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  // HOME value-domain (mapped space); the row (y) axis is categorical, so the
  // viewport is x-only (`constrainTo:'x'`) — zoom/pan the value axis, never the
  // rows. yDomain is a dummy the hook leaves untouched.
  const dMinHome = logX ? logSafe(domain.min) : domain.min;
  const dMaxHome = logX ? logSafe(domain.max) : domain.max;
  const home = useMemo(
    () => ({
      xDomain: [dMinHome, dMaxHome] as [number, number],
      yDomain: [0, 1] as [number, number],
    }),
    [dMinHome, dMaxHome],
  );

  const plotRectRef = useRef<PlotRect | null>(null);
  plotRectRef.current = { x: pad.left, y: pad.top, width: plotW, height: plotH };

  const chartVp = useChartViewport({
    containerRef,
    plotRectRef,
    home,
    constrainTo: "x",
  });
  const {
    domain: viewport,
    containerProps,
    dragRect,
    wasDragRef,
  } = chartVp;
  const controller = useChartController({ viewport: chartVp, rootRef: containerRef });

  // S6 interactive legend: click a chip to hide/show that run's bar,
  // double-click to isolate it. A hidden bar is simply not drawn (its row slot
  // stays in place so the layout doesn't jump).
  const barIds = useMemo(() => bars.map((b) => b.id), [bars]);
  const visibility = useSeriesVisibility(barIds);

  const [dMin, dMax] = viewport.xDomain;
  const range = dMax - dMin || 1;
  const toX = (v: number) => {
    const mapped = logX ? logSafe(Math.max(v, 1e-10)) : v;
    return pad.left + ((mapped - dMin) / range) * plotW;
  };
  // Baseline: value 0 for linear (clamped into the plot), left edge for log.
  const baseX = logX ? pad.left : Math.max(pad.left, Math.min(pad.left + plotW, toX(0)));

  // Value-axis ticks: "nice"-rounded on a linear axis, evenly-spaced fractions
  // on a log axis. Recomputed from the LIVE value domain so they track zoom/pan.
  const eps = 0.5;
  const valueTicks: AxisTick[] = logX
    ? [0, 0.25, 0.5, 0.75, 1].map((t) => ({
        pos: pad.left + t * plotW,
        label: formatNum(Math.pow(10, dMin + t * range)),
      }))
    : niceTicks(dMin, dMax)
        .map((v) => ({ pos: toX(v), label: formatNum(v) }))
        .filter((t) => t.pos >= pad.left - eps && t.pos <= pad.left + plotW + eps);

  // Row count: one row per bar when grouped (today's layout), a single
  // composed row for stacked/overlay.
  const n = composed ? 1 : bars.length;
  const rowH = n > 0 ? plotH / n : 0;
  const barH = composed
    ? Math.max(8, Math.min(64, plotH * 0.55))
    : Math.max(2, Math.min(28, rowH * 0.62));

  const handleEnter = (id: string, e: React.MouseEvent) => {
    setHoveredId(id);
    const anchor = pointerAnchor(e, containerRef);
    if (anchor) setTooltipPos(anchor);
  };
  const handleMove = (e: React.MouseEvent) => {
    const anchor = pointerAnchor(e, containerRef);
    if (anchor) setTooltipPos(anchor);
  };
  const handleLeave = () => {
    setHoveredId(null);
    setTooltipPos(null);
  };
  // Suppress the click that ends a box-zoom/pan drag (mirrors ScalarPlot).
  const suppressAfterDrag = () => {
    if (wasDragRef.current) {
      wasDragRef.current = false;
      return true;
    }
    return false;
  };

  const hoveredBar = hoveredId
    ? (bars.find((b) => b.id === hoveredId) ?? null)
    : null;
  const hoveredStack = hoveredId
    ? (stackSegments.find((s) => s.bar.id === hoveredId) ?? null)
    : null;

  const cy = pad.top + rowH / 2; // used for composed (single-row) modes

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
          {/* Background — clears selection on click. */}
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            fill="transparent"
            onClick={() => {
              if (suppressAfterDrag()) return;
              onBackgroundClick?.();
            }}
          />

          {/* Value axis: gridlines + ticks + caption (shared primitive). */}
          <Axis
            orientation="bottom"
            plot={{ x: pad.left, y: pad.top, width: plotW, height: plotH }}
            ticks={valueTicks}
            title={valueLabel}
            showGrid
          />

          {showLegend && (
            <g>
              {legendChips.map(({ bar, x, color }) => {
                const isSelected = selectedIds?.has(bar.id);
                const isHidden = visibility.isHidden(bar.id);
                return (
                  <g
                    key={bar.id}
                    className="cursor-pointer"
                    opacity={isHidden ? 0.35 : 1}
                    onClick={() => visibility.toggle(bar.id)}
                    onDoubleClick={() => visibility.isolate(bar.id)}
                    onMouseEnter={(e) => handleEnter(bar.id, e)}
                    onMouseMove={handleMove}
                    onMouseLeave={handleLeave}
                  >
                    <title>Click to hide/show. Double-click to isolate.</title>
                    <rect
                      x={pad.left + x}
                      y={4}
                      width={10}
                      height={10}
                      rx={2}
                      fill={color}
                      opacity={isSelected || hoveredId === bar.id ? 1 : 0.85}
                    />
                    <text
                      x={pad.left + x + 14}
                      y={13}
                      className={`mono text-[9px] ${isSelected ? "fill-accent" : "fill-fg-muted"}`}
                      style={{
                        fontSize: 9,
                        textDecoration: isHidden ? "line-through" : undefined,
                      }}
                    >
                      {bar.label.length > 24 ? bar.label.slice(0, 23) + "…" : bar.label}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {stackedDisabledByLog && (
            <text
              x={pad.left + plotW}
              y={pad.top - 2}
              textAnchor="end"
              className="text-[9px] fill-fg-subtle"
              style={{ fontSize: 9 }}
            >
              Stacked disabled on log axis — showing grouped
            </text>
          )}

          {mode === "grouped" &&
            bars.map((b, i) => {
              if (visibility.isHidden(b.id)) return null;
              const rowCy = pad.top + i * rowH + rowH / 2;
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
                  onClick={() => {
                    if (suppressAfterDrag()) return;
                    onClick?.(b.id);
                  }}
                  onMouseEnter={(e) => handleEnter(b.id, e)}
                  onMouseMove={handleMove}
                  onMouseLeave={handleLeave}
                >
                  {/* Run label. */}
                  <text
                    x={pad.left - 6}
                    y={rowCy + 3}
                    textAnchor="end"
                    className={`mono text-[10px] ${isSelected ? "fill-accent" : "fill-fg-muted"}`}
                    style={{ fontSize: 10 }}
                  >
                    {b.label.length > 24 ? b.label.slice(0, 23) + "…" : b.label}
                  </text>
                  <rect
                    clipPath={`url(#${clipId})`}
                    x={x0}
                    y={rowCy - barH / 2}
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
                    y={rowCy + 3}
                    textAnchor={valAtRight ? "start" : "end"}
                    className="mono text-[9px] fill-fg-subtle"
                    style={{ fontSize: 9 }}
                  >
                    {formatNum(b.value)}
                  </text>
                </g>
              );
            })}

          {mode === "stacked" && composed && (
            <g>
              <text
                x={pad.left - 6}
                y={cy + 3}
                textAnchor="end"
                className="mono text-[10px] fill-fg-muted"
                style={{ fontSize: 10 }}
              >
                {rowLabel}
              </text>
              {stackSegments.map((seg) => {
                if (visibility.isHidden(seg.bar.id)) return null;
                const x0 = toX(seg.start);
                const x1 = toX(seg.end);
                const isHovered = hoveredId === seg.bar.id;
                const isSelected = selectedIds?.has(seg.bar.id);
                return (
                  <rect
                    key={seg.bar.id}
                    clipPath={`url(#${clipId})`}
                    className="cursor-pointer"
                    x={Math.min(x0, x1)}
                    y={cy - barH / 2}
                    width={Math.max(0, Math.abs(x1 - x0))}
                    height={barH}
                    fill={seg.bar.color ?? colors[0]}
                    opacity={isHovered ? 1 : 0.85}
                    stroke={
                      isSelected ? "var(--color-accent, #0969da)" : "rgba(0,0,0,0.15)"
                    }
                    strokeWidth={isSelected ? 2 : 0.5}
                    onClick={() => {
                      if (suppressAfterDrag()) return;
                      onClick?.(seg.bar.id);
                    }}
                    onMouseEnter={(e) => handleEnter(seg.bar.id, e)}
                    onMouseMove={handleMove}
                    onMouseLeave={handleLeave}
                  />
                );
              })}
              {/* Total value label at the stack's outer edge (right edge for
                  a non-negative total, left edge for a negative one). */}
              {stackSegments.length > 0 && (() => {
                const total = stackSegments[0]!.total;
                const posSum = stackSegments.reduce((m, s) => Math.max(m, s.end), 0);
                const negSum = stackSegments.reduce((m, s) => Math.min(m, s.start), 0);
                const edge = toX(total >= 0 ? posSum : negSum);
                return (
                  <text
                    x={total >= 0 ? edge + 4 : edge - 4}
                    y={cy + 3}
                    textAnchor={total >= 0 ? "start" : "end"}
                    className="mono text-[9px] fill-fg-subtle"
                    style={{ fontSize: 9 }}
                  >
                    {formatNum(total)}
                  </text>
                );
              })()}
            </g>
          )}

          {mode === "overlay" && composed && (
            <g>
              <text
                x={pad.left - 6}
                y={cy + 3}
                textAnchor="end"
                className="mono text-[10px] fill-fg-muted"
                style={{ fontSize: 10 }}
              >
                {rowLabel}
              </text>
              {bars.map((b, i) => {
                if (visibility.isHidden(b.id)) return null;
                const vx = toX(b.value);
                const x0 = Math.min(baseX, vx);
                const x1 = Math.max(baseX, vx);
                const color = b.color ?? colors[i % colors.length];
                const isHovered = hoveredId === b.id;
                const isSelected = selectedIds?.has(b.id);
                return (
                  <rect
                    key={b.id}
                    clipPath={`url(#${clipId})`}
                    className="cursor-pointer"
                    x={x0}
                    y={cy - barH / 2}
                    width={Math.max(0, x1 - x0)}
                    height={barH}
                    rx={2}
                    fill={color}
                    fillOpacity={isHovered ? 0.75 : 0.45}
                    stroke={isSelected ? "var(--color-accent, #0969da)" : color}
                    strokeWidth={isSelected ? 2 : 1}
                    onClick={() => {
                      if (suppressAfterDrag()) return;
                      onClick?.(b.id);
                    }}
                    onMouseEnter={(e) => handleEnter(b.id, e)}
                    onMouseMove={handleMove}
                    onMouseLeave={handleLeave}
                  />
                );
              })}
            </g>
          )}
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

      {hoveredBar && tooltipPos && (
        <Tooltip
          x={tooltipPos.x}
          y={tooltipPos.y}
          containerW={tooltipPos.containerW}
          containerH={tooltipPos.containerH}
        >
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
              {mode === "stacked" && hoveredStack && (
                <div className="flex justify-between gap-2 mt-0.5 pt-0.5 border-t border-border-subtle">
                  <span className="text-fg-muted">Total</span>
                  <span className="mono">{formatNum(hoveredStack.total)}</span>
                </div>
              )}
            </>
          )}
        </Tooltip>
      )}
    </div>
  );
}
