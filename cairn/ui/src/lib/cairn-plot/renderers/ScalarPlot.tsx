import {
  useCallback,
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
import { formatXTick } from "../format";
import { useModifierKey } from "../hooks/use-modifier-key";
import { CustomLegend, type PromotedSeriesConfig } from "./scalar/scalar-legend";
import { CustomTooltip } from "./scalar/scalar-tooltip";
import { usePlotGestures, type PlotOffset } from "./scalar/use-plot-gestures";

type AxisScale = "linear" | "log";

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

  // ── Refs shared with the gesture state machine ──
  // `plotOffsetRef` is written by the <Customized> component below with the
  // Recharts plot rect (container-local coords); the gesture hook reads it.
  const chartBoxRef = useRef<HTMLDivElement>(null);
  const plotOffsetRef = useRef<PlotOffset | null>(null);
  const effectiveRef = useRef({ x: effectiveX, y: effectiveY });
  effectiveRef.current = { x: effectiveX, y: effectiveY };

  const hoveredSeriesRef = useRef<string | null>(null);
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);
  hoveredSeriesRef.current = hoveredSeries;

  const altDown = useModifierKey();

  const {
    selection,
    wasDragRef,
    onChartPointerDown,
    onChartPointerMove,
    onChartPointerUp,
    onAxisStripPointerDown,
    clearDrag,
  } = usePlotGestures({
    chartBoxRef,
    plotOffsetRef,
    effectiveRef,
    promotedRef,
    onViewportChange,
    onPromotedSeriesChange,
  });

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
      onLostPointerCapture={clearDrag}
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
