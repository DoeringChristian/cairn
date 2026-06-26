import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import {
  CartesianGrid,
  Customized,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Series, Viewport } from "../types";
import type { AxisSource } from "../transforms/x-axis";
import { resolveAxisDomain } from "../transforms/domain";
import { mergeToRows } from "../transforms/merge-rows";
import { formatNum, formatXTick } from "../format";
import { useModifierKey } from "../hooks/use-modifier-key";

type AxisScale = "linear" | "log";

interface PromotedSeriesConfig {
  min: number;
  max: number;
}

const CHART_MARGIN = { top: 4, right: 8, left: 0, bottom: 4 } as const;
const PROMOTED_AXIS_WIDTH = 35;

export interface ScalarPlotProps {
  series: Series[];
  xAxis: AxisSource;
  xScale: AxisScale;
  yScale: AxisScale;
  xRange: [number | null, number | null];
  yRange: [number | null, number | null];
  viewport: Viewport;
  onViewportChange: (v: Viewport) => void;
  promotedSeries: Record<string, PromotedSeriesConfig>;
  onPromotedSeriesChange: (
    p: Record<string, PromotedSeriesConfig>,
  ) => void;
  lineType?: "linear" | "monotone" | "step" | "stepBefore" | "stepAfter";
  showLegend?: boolean;
  tooltip?: { showContext?: boolean; showWallTime?: boolean };
  selectedSeriesKeys?: Set<string>;
  onSeriesClick?: (seriesKey: string) => void;
  className?: string;
}

export default function ScalarPlot({
  series,
  xAxis,
  xScale,
  yScale,
  xRange,
  yRange,
  viewport,
  onViewportChange,
  promotedSeries,
  onPromotedSeriesChange,
  lineType = "linear",
  showLegend = true,
  tooltip,
  selectedSeriesKeys,
  onSeriesClick,
  className,
}: ScalarPlotProps) {
  const data = useMemo(() => mergeToRows(series), [series]);

  const xDomain = resolveAxisDomain(
    xRange[0], xRange[1], viewport.xMin, viewport.xMax, xScale,
  );
  const yDomain = resolveAxisDomain(
    yRange[0], yRange[1], viewport.yMin, viewport.yMax, yScale,
  );

  const dataXs = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const p of s.points) {
        if (p.x < lo) lo = p.x;
        if (p.x > hi) hi = p.x;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1] as const;
    if (lo === hi) return [lo - 0.5, hi + 0.5] as const;
    return [lo, hi] as const;
  }, [series]);

  const dataYs = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      if (promotedSeries[s.key]) continue;
      for (const p of s.points) {
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1] as const;
    if (lo === hi) return [lo - 0.5, hi + 0.5] as const;
    return [lo, hi] as const;
  }, [series, promotedSeries]);

  const effectiveX: [number, number] = [
    typeof xDomain[0] === "number" ? xDomain[0] : dataXs[0],
    typeof xDomain[1] === "number" ? xDomain[1] : dataXs[1],
  ];
  const effectiveY: [number, number] = [
    typeof yDomain[0] === "number" ? yDomain[0] : dataYs[0],
    typeof yDomain[1] === "number" ? yDomain[1] : dataYs[1],
  ];

  // ── Promoted axes ──
  const promotedKeysOrdered = useMemo(
    () => series.map((s) => s.key).filter((k) => promotedSeries[k]),
    [series, promotedSeries],
  );
  const dynamicMargin = useMemo(() => ({ ...CHART_MARGIN }), []);

  const promotedRef = useRef(promotedSeries);
  promotedRef.current = promotedSeries;

  const togglePromote = useCallback(
    (key: string) => {
      const existing = promotedRef.current[key];
      if (existing) {
        const next = { ...promotedRef.current };
        delete next[key];
        onPromotedSeriesChange(next);
        return;
      }
      const s = series.find((x) => x.key === key);
      if (!s || s.points.length === 0) {
        onPromotedSeriesChange({
          ...promotedRef.current,
          [key]: { min: 0, max: 1 },
        });
        return;
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of s.points) {
        if (p.y < lo) lo = p.y;
        if (p.y > hi) hi = p.y;
      }
      if (lo === hi) { lo -= 0.5; hi += 0.5; }
      onPromotedSeriesChange({
        ...promotedRef.current,
        [key]: { min: lo, max: hi },
      });
    },
    [series, onPromotedSeriesChange],
  );

  // ── Refs for interaction handlers ──
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const plotOffsetRef = useRef<{
    top: number; left: number; width: number; height: number;
  } | null>(null);
  const effectiveRef = useRef({ x: effectiveX, y: effectiveY });
  effectiveRef.current = { x: effectiveX, y: effectiveY };

  const wasDragRef = useRef(false);
  const hoveredSeriesRef = useRef<string | null>(null);
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);
  hoveredSeriesRef.current = hoveredSeries;

  type RightAxisDragMode = "pan" | "scale";
  const rightAxisDragRef = useRef<{
    key: string;
    pointerId: number;
    mode: RightAxisDragMode;
    startY: number;
    startMin: number;
    startMax: number;
    axisHeightPx: number;
    axisTopPx: number;
    anchorData: number;
  } | null>(null);

  type PlotDragMode = "pan" | "select";
  const plotDragRef = useRef<{
    pointerId: number;
    mode: PlotDragMode;
    startClientX: number;
    startClientY: number;
    plotLeft: number;
    plotTop: number;
    plotW: number;
    plotH: number;
    startXDomain: [number, number];
    startYDomain: [number, number];
  } | null>(null);

  const [selection, setSelection] = useState<{
    x0: number; y0: number; x1: number; y1: number;
  } | null>(null);

  const altDown = useModifierKey();

  // ── Wheel zoom ──
  useEffect(() => {
    const el = chartBoxRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.altKey && !e.ctrlKey && !e.metaKey) return;
      const rect = el.getBoundingClientRect();
      const plotLeft = rect.left + CHART_MARGIN.left + 46;
      const plotRight = rect.right - dynamicMargin.right;
      const plotTop = rect.top + CHART_MARGIN.top;
      const plotBottom = rect.bottom - CHART_MARGIN.bottom - 20;
      if (
        e.clientX < plotLeft || e.clientX > plotRight ||
        e.clientY < plotTop || e.clientY > plotBottom
      ) return;
      e.preventDefault();

      const factor = e.deltaY < 0 ? 1 / 1.1 : 1.1;
      const { x, y } = effectiveRef.current;
      const fx = (e.clientX - plotLeft) / Math.max(1, plotRight - plotLeft);
      const fy = (plotBottom - e.clientY) / Math.max(1, plotBottom - plotTop);
      const ax = x[0] + fx * (x[1] - x[0]);
      const ay = y[0] + fy * (y[1] - y[0]);
      onViewportChange({
        xMin: ax - (ax - x[0]) * factor,
        xMax: ax + (x[1] - ax) * factor,
        yMin: ay - (ay - y[0]) * factor,
        yMax: ay + (y[1] - ay) * factor,
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [onViewportChange, dynamicMargin.right]);

  // ── Axis strip drag ──
  const onAxisStripPointerDown = useCallback(
    (
      key: string,
      e: React.PointerEvent<SVGRectElement>,
      axisHeightPx: number,
      axisTopPx: number,
    ) => {
      const cfg = promotedRef.current[key];
      if (!cfg) return;
      e.stopPropagation();
      e.preventDefault();
      chartBoxRef.current?.setPointerCapture(e.pointerId);
      const rect = (e.currentTarget as SVGRectElement)
        .ownerSVGElement?.getBoundingClientRect();
      const svgTop = rect?.top ?? 0;
      const localY = e.clientY - svgTop;
      const fracFromTop = Math.max(
        0,
        Math.min(1, (localY - axisTopPx) / Math.max(1, axisHeightPx)),
      );
      const anchorData = cfg.max - fracFromTop * (cfg.max - cfg.min);
      rightAxisDragRef.current = {
        key,
        pointerId: e.pointerId,
        mode: e.shiftKey ? "scale" : "pan",
        startY: e.clientY,
        startMin: cfg.min,
        startMax: cfg.max,
        axisHeightPx,
        axisTopPx,
        anchorData,
      };
    },
    [],
  );

  // ── Plot-area pointer handlers ──
  const onChartPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      wasDragRef.current = false;
      const el = chartBoxRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const po = plotOffsetRef.current;
      const plotLeft = po ? rect.left + po.left : rect.left + CHART_MARGIN.left + 50;
      const plotRight = po ? rect.left + po.left + po.width : rect.right - dynamicMargin.right;
      const plotTop = po ? rect.top + po.top : rect.top + CHART_MARGIN.top;
      const plotBottom = po ? rect.top + po.top + po.height : rect.bottom - CHART_MARGIN.bottom - 28;
      if (
        e.clientX < plotLeft || e.clientX > plotRight ||
        e.clientY < plotTop || e.clientY > plotBottom
      ) return;
      if (e.button !== 0) return;
      const mode: PlotDragMode = (e.altKey || e.ctrlKey || e.metaKey) ? "pan" : "select";
      plotDragRef.current = {
        pointerId: e.pointerId,
        mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        plotLeft,
        plotTop,
        plotW: Math.max(1, plotRight - plotLeft),
        plotH: Math.max(1, plotBottom - plotTop),
        startXDomain: effectiveRef.current.x,
        startYDomain: effectiveRef.current.y,
      };
    },
    [dynamicMargin.right],
  );

  const onChartPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ax = rightAxisDragRef.current;
      if (ax && ax.pointerId === e.pointerId) {
        const dyPx = e.clientY - ax.startY;
        if (ax.mode === "pan") {
          const range = ax.startMax - ax.startMin;
          const dyData = (dyPx / Math.max(1, ax.axisHeightPx)) * range;
          onPromotedSeriesChange({
            ...promotedRef.current,
            [ax.key]: { min: ax.startMin + dyData, max: ax.startMax + dyData },
          });
        } else {
          const factor = Math.exp(dyPx / Math.max(1, ax.axisHeightPx));
          const newMin = ax.anchorData - (ax.anchorData - ax.startMin) * factor;
          const newMax = ax.anchorData + (ax.startMax - ax.anchorData) * factor;
          if (Number.isFinite(newMin) && Number.isFinite(newMax) && newMax > newMin) {
            onPromotedSeriesChange({
              ...promotedRef.current,
              [ax.key]: { min: newMin, max: newMax },
            });
          }
        }
        return;
      }

      const s = plotDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const moved = Math.abs(e.clientX - s.startClientX) >= 3 || Math.abs(e.clientY - s.startClientY) >= 3;
      if (moved) {
        wasDragRef.current = true;
        try { (e.currentTarget as HTMLDivElement).setPointerCapture(s.pointerId); } catch { /* ok */ }
      }
      if (s.mode === "pan") {
        const dxPx = e.clientX - s.startClientX;
        const dyPx = e.clientY - s.startClientY;
        const [x0, x1] = s.startXDomain;
        const [y0, y1] = s.startYDomain;
        const dxData = (dxPx / s.plotW) * (x1 - x0);
        const dyData = (dyPx / s.plotH) * (y1 - y0);
        onViewportChange({
          xMin: x0 - dxData,
          xMax: x1 - dxData,
          yMin: y0 + dyData,
          yMax: y1 + dyData,
        });
        return;
      }
      const el2 = chartBoxRef.current;
      if (!el2) return;
      const rect2 = el2.getBoundingClientRect();
      const localX = e.clientX - rect2.left;
      const localY = e.clientY - rect2.top;
      const wPx = Math.abs(e.clientX - s.startClientX);
      const hPx = Math.abs(e.clientY - s.startClientY);
      if (wPx >= 6 || hPx >= 6) {
        const startLocalX = s.startClientX - rect2.left;
        const startLocalY = s.startClientY - rect2.top;
        setSelection({ x0: startLocalX, y0: startLocalY, x1: localX, y1: localY });
      }
    },
    [onViewportChange, onPromotedSeriesChange],
  );

  const onChartPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ax = rightAxisDragRef.current;
      if (ax && ax.pointerId === e.pointerId) {
        wasDragRef.current = true;
        rightAxisDragRef.current = null;
        try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ok */ }
        return;
      }

      const s = plotDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* ok */ }
      if (s.mode === "select") {
        const wPx = Math.abs(e.clientX - s.startClientX);
        const hPx = Math.abs(e.clientY - s.startClientY);
        if (wPx >= 6 && hPx >= 6) {
          wasDragRef.current = true;
          const x0c = Math.min(s.startClientX, e.clientX);
          const x1c = Math.max(s.startClientX, e.clientX);
          const y0c = Math.min(s.startClientY, e.clientY);
          const y1c = Math.max(s.startClientY, e.clientY);
          const fxLo = (x0c - s.plotLeft) / s.plotW;
          const fxHi = (x1c - s.plotLeft) / s.plotW;
          const plotBottom = s.plotTop + s.plotH;
          const fyLo = (plotBottom - y1c) / s.plotH;
          const fyHi = (plotBottom - y0c) / s.plotH;
          const [xa, xb] = s.startXDomain;
          const [ya, yb] = s.startYDomain;
          const xMinNew = xa + fxLo * (xb - xa);
          const xMaxNew = xa + fxHi * (xb - xa);
          const yMinNew = ya + fyLo * (yb - ya);
          const yMaxNew = ya + fyHi * (yb - ya);
          if (
            Number.isFinite(xMinNew) && Number.isFinite(xMaxNew) &&
            Number.isFinite(yMinNew) && Number.isFinite(yMaxNew) &&
            xMaxNew > xMinNew && yMaxNew > yMinNew
          ) {
            onViewportChange({ xMin: xMinNew, xMax: xMaxNew, yMin: yMinNew, yMax: yMaxNew });
          }
        }
        setSelection(null);
      }
      plotDragRef.current = null;
    },
    [onViewportChange],
  );

  // ── Render ──
  return (
    <div
      ref={chartBoxRef}
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        touchAction: "none",
        cursor: altDown ? "move" : hoveredSeries ? "pointer" : "crosshair",
        userSelect: "none",
        WebkitUserSelect: "none",
      } as CSSProperties}
      aria-label="Scalar plot. Drag to box-zoom. Alt+drag to pan. Alt+wheel to zoom."
      onPointerDown={onChartPointerDown}
      onPointerMove={onChartPointerMove}
      onPointerUp={onChartPointerUp}
      onPointerCancel={onChartPointerUp}
      onClick={() => {
        if (wasDragRef.current) { wasDragRef.current = false; return; }
        const hk = hoveredSeriesRef.current;
        if (hk) onSeriesClick?.(hk);
      }}
      onLostPointerCapture={() => {
        plotDragRef.current = null;
        rightAxisDragRef.current = null;
        setSelection(null);
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={dynamicMargin}
          onMouseMove={(state: any) => {
            if (state?.activePayload?.length) {
              const payload = state.activePayload as Array<{
                dataKey: string;
                value: number;
              }>;
              const po = plotOffsetRef.current;
              if (po && state.chartY != null) {
                const fracFromTop = Math.max(
                  0,
                  Math.min(
                    1,
                    (state.chartY - po.top) / Math.max(1, po.height),
                  ),
                );
                let closestKey: string | null = null;
                let closestScreenDist = Infinity;
                for (const p of payload) {
                  if (p.value == null) continue;
                  const promoted = promotedRef.current[p.dataKey];
                  const [yMin, yMax] = promoted
                    ? [promoted.min, promoted.max]
                    : effectiveRef.current.y;
                  const valueFrac =
                    1 - (p.value - yMin) / Math.max(1e-10, yMax - yMin);
                  const dist = Math.abs(valueFrac - fracFromTop);
                  if (dist < closestScreenDist) {
                    closestScreenDist = dist;
                    closestKey = p.dataKey;
                  }
                }
                setHoveredSeries(closestKey);
              } else if (payload.length === 1) {
                setHoveredSeries(payload[0]!.dataKey);
              }
            }
          }}
          onMouseLeave={() => setHoveredSeries(null)}
        >
          <CartesianGrid stroke="#d0d7de" strokeDasharray="2 4" />
          <XAxis
            dataKey="x"
            type="number"
            scale={xScale === "log" ? "log" : "linear"}
            domain={xDomain as [number | string, number | string]}
            allowDataOverflow
            stroke="#656d76"
            fontSize={11}
            tickFormatter={(v: number) => formatXTick(v, xAxis)}
          />
          <YAxis
            yAxisId="__left__"
            scale={yScale === "log" ? "log" : "linear"}
            domain={yDomain as [number | string, number | string]}
            allowDataOverflow
            stroke="#656d76"
            fontSize={11}
            width={46}
          />
          {promotedKeysOrdered.map((key) => {
            const s = series.find((x) => x.key === key);
            const color = s?.color ?? "#656d76";
            const cfg = promotedSeries[key]!;
            return (
              <YAxis
                key={key}
                yAxisId={key}
                orientation="right"
                scale="linear"
                domain={[cfg.min, cfg.max]}
                allowDataOverflow
                stroke={color}
                tick={{ fill: color }}
                fontSize={11}
                width={PROMOTED_AXIS_WIDTH}
              />
            );
          })}
          <Tooltip
            isAnimationActive={false}
            content={
              <CustomTooltip
                seriesByKey={Object.fromEntries(
                  series.map((s) => [s.key, s]),
                )}
                xAxis={xAxis}
                showContext={tooltip?.showContext ?? true}
                showWallTime={tooltip?.showWallTime ?? true}
              />
            }
            contentStyle={{
              background: "#f6f8fa",
              border: "1px solid #d0d7de",
              fontSize: 12,
            }}
            labelStyle={{ color: "#656d76" }}
          />
          {showLegend && series.length > 0 && (
            <Legend
              wrapperStyle={{ fontSize: 11 }}
              content={
                <CustomLegend
                  series={series}
                  promoted={promotedSeries}
                  onToggle={togglePromote}
                  onSelect={(key) => onSeriesClick?.(key)}
                  selectedKeys={selectedSeriesKeys}
                />
              }
            />
          )}
          {series.map((s) => {
            const isHovered = hoveredSeries === s.key;
            const isSelected = selectedSeriesKeys?.has(s.key);
            const isDimmed =
              (hoveredSeries != null && !isHovered) ||
              ((selectedSeriesKeys?.size ?? 0) > 0 &&
                !isSelected &&
                !isHovered);
            const axisId = promotedSeries[s.key] ? s.key : "__left__";
            return [
              s.rawPoints && (
                <Line
                  key={`${s.key}__raw`}
                  type={lineType}
                  dataKey={`${s.key}__raw`}
                  stroke={s.color}
                  strokeWidth={1}
                  strokeOpacity={isDimmed ? 0.05 : 0.2}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                  yAxisId={axisId}
                  legendType="none"
                  tooltipType="none"
                />
              ),
              <Line
                key={s.key}
                type={lineType}
                name={s.label}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={isHovered ? 2.5 : 1.5}
                strokeOpacity={isDimmed ? 0.15 : 1}
                dot={false}
                isAnimationActive={false}
                connectNulls
                yAxisId={axisId}
              />,
            ];
          })}
          <Customized
            component={
              ((props: unknown) => {
                const p = props as {
                  offset?: {
                    top?: number;
                    left?: number;
                    width?: number;
                    height?: number;
                    right?: number;
                  };
                };
                const o = p.offset;
                if (!o || o.width == null || o.height == null) return null;
                plotOffsetRef.current = {
                  top: o.top ?? 0,
                  left: o.left ?? 0,
                  width: o.width,
                  height: o.height,
                };
                if (promotedKeysOrdered.length === 0) return null;
                const top = o.top ?? 0;
                const height = o.height;
                const plotRight = (o.left ?? 0) + o.width;
                return (
                  <g>
                    {promotedKeysOrdered.map((key, i) => {
                      const x = plotRight + i * PROMOTED_AXIS_WIDTH;
                      return (
                        <rect
                          key={key}
                          x={x}
                          y={top - 5}
                          width={PROMOTED_AXIS_WIDTH}
                          height={height + 10}
                          fill="transparent"
                          style={{
                            cursor: "ns-resize",
                            touchAction: "none",
                          }}
                          onPointerDown={(e) =>
                            onAxisStripPointerDown(key, e, height, top)
                          }
                        />
                      );
                    })}
                  </g>
                );
              }) as unknown as React.FunctionComponent
            }
          />
        </LineChart>
      </ResponsiveContainer>
      {selection && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: Math.min(selection.x0, selection.x1),
            top: Math.min(selection.y0, selection.y1),
            width: Math.abs(selection.x1 - selection.x0),
            height: Math.abs(selection.y1 - selection.y0),
            border: "1px solid #0969da",
            background: "rgba(83, 155, 245, 0.12)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

// ─── Custom Legend ───

interface LegendSeries {
  key: string;
  label: string;
  color: string;
}

function CustomLegend({
  series,
  promoted,
  onToggle,
  onSelect,
  selectedKeys,
}: {
  series: LegendSeries[];
  promoted: Record<string, PromotedSeriesConfig>;
  onToggle: (key: string) => void;
  onSelect?: (seriesKey: string) => void;
  selectedKeys?: Set<string>;
}) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
      {series.map((s) => {
        const isPromoted = !!promoted[s.key];
        const isSelected = selectedKeys?.has(s.key) ?? false;
        const hasSel = selectedKeys != null && selectedKeys.size > 0;
        return (
          <li
            key={s.key}
            className="inline-flex items-center gap-1 text-[11px] text-fg-muted"
          >
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-fg"
              style={{ opacity: hasSel && !isSelected ? 0.35 : 1 }}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              title="Click to select this run"
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: isSelected ? 3 : 2,
                  background: s.color,
                  marginRight: 2,
                }}
              />
              <span>{s.label}</span>
            </button>
            <button
              type="button"
              onClick={() => onToggle(s.key)}
              className={`ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-xs hover:bg-bg-hover ${
                isPromoted ? "text-accent" : "text-fg-muted"
              }`}
              title={
                isPromoted
                  ? "Demote (single Y axis)"
                  : "Promote to own Y axis"
              }
            >
              <i
                className="fa-solid fa-arrows-up-down"
                aria-hidden="true"
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Custom Tooltip ───

interface TooltipPayloadEntry {
  dataKey?: string | number;
  name?: string | number;
  color?: string;
  value?: number | string | Array<number | string>;
  payload?: Record<string, unknown>;
}

function CustomTooltip({
  active,
  label,
  payload,
  seriesByKey,
  xAxis,
  showContext,
  showWallTime,
}: {
  active?: boolean;
  label?: number | string;
  payload?: TooltipPayloadEntry[];
  seriesByKey: Record<string, LegendSeries>;
  xAxis: AxisSource;
  showContext: boolean;
  showWallTime: boolean;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const style: CSSProperties = {
    background: "#f6f8fa",
    border: "1px solid #d0d7de",
    padding: "6px 8px",
    fontSize: 12,
    color: "#1f2328",
    minWidth: 140,
  };
  const labelNum = typeof label === "number" ? label : Number(label);
  return (
    <div style={style}>
      <div style={{ color: "#656d76", marginBottom: 4 }}>
        {formatXTick(labelNum, xAxis)}
      </div>
      {payload.map((entry, i) => {
        const key = String(entry.dataKey ?? "");
        const meta = seriesByKey[key];
        const val = entry.value;
        const rawCtx =
          (entry.payload?.[`${key}__ctx`] as string | undefined) ?? null;
        const rawWall =
          (entry.payload?.[`${key}__wall`] as string | undefined) ?? null;
        return (
          <div key={`${key}-${i}`} style={{ lineHeight: 1.4 }}>
            <div style={{ color: meta?.color ?? entry.color ?? "#656d76" }}>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                {meta?.label ?? entry.name ?? key}
              </span>
              <span style={{ color: "#1f2328", marginLeft: 8 }}>
                {typeof val === "number"
                  ? formatNum(val)
                  : String(val ?? "")}
              </span>
            </div>
            {showContext && rawCtx && (
              <div style={{ color: "#6e7681", fontSize: 11 }}>{rawCtx}</div>
            )}
            {showWallTime && rawWall && (
              <div style={{ color: "#6e7681", fontSize: 11 }}>{rawWall}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
