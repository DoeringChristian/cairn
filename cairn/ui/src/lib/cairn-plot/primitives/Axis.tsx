/**
 * Shared SVG axis / gridline / frame primitives for cairn-plot's 2D renderers.
 *
 * Before this module every renderer hand-wrote the same `<text>`-per-tick +
 * `<rect>` frame + gridline `<line>` pattern with subtly different font-sizes,
 * colors and dash patterns. These primitives put that rendering in ONE place,
 * driven entirely by the tokens in `../theme`, so ScatterPlot / BarChart /
 * HistogramPlot / Heatmap / ParallelCoords all draw identical-looking axes.
 *
 *  - `PlotFrame`  — the bordered plot rectangle.
 *  - `TickText`   — a single tick label (mono, `AXIS.tickFontSize`, tick color).
 *  - `AxisTitle`  — an axis caption (`AXIS.titleFontSize`, title color).
 *  - `Axis`       — a full bottom/left axis: optional gridlines, optional
 *                   spine, tick marks + labels, optional title. Covers the
 *                   rectangular renderers (Scatter/Bar/Histogram/Heatmap).
 *
 * ParallelCoords composes `TickText` + `AxisTitle` directly for its bespoke
 * per-column vertical axes, so the tick/title styling still lives here alone.
 */
import type { ReactNode } from "react";
import { AXIS, GRID } from "../theme";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One tick: `pos` is the pixel coordinate ALONG the axis (x for a bottom
 *  axis, y for a left axis); `label` is the already-formatted text. */
export interface AxisTick {
  pos: number;
  label: string;
}

/** The bordered plot rectangle (the axis frame). `fill="transparent"` (via
 *  `interactive`) makes the interior catch background clicks. */
export function PlotFrame({
  x,
  y,
  width,
  height,
  interactive,
  onClick,
  className,
}: Rect & {
  interactive?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={interactive ? "transparent" : "none"}
      stroke={AXIS.lineColor}
      strokeWidth={AXIS.lineWidth}
      onClick={onClick}
      className={className}
    />
  );
}

/** A single numeric tick label — the ONE place tick-label styling lives. */
export function TickText({
  x,
  y,
  anchor = "middle",
  children,
}: {
  x: number;
  y: number;
  anchor?: "start" | "middle" | "end";
  children: ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      className="mono"
      style={{ fontSize: AXIS.tickFontSize, fill: AXIS.tickColor }}
    >
      {children}
    </text>
  );
}

/** An axis caption. `rotate` (e.g. -90) turns it for a vertical axis. */
export function AxisTitle({
  x,
  y,
  children,
  rotate,
  anchor = "middle",
}: {
  x: number;
  y: number;
  children: ReactNode;
  rotate?: number;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      style={{ fontSize: AXIS.titleFontSize, fill: AXIS.titleColor }}
      transform={rotate != null ? `rotate(${rotate}, ${x}, ${y})` : undefined}
    >
      {children}
    </text>
  );
}

export interface AxisProps {
  /** "bottom" = horizontal x-axis under the plot; "left" = vertical y-axis. */
  orientation: "bottom" | "left";
  plot: Rect;
  ticks: AxisTick[];
  title?: string;
  /** Draw background gridlines across the plot at each tick. */
  showGrid?: boolean;
  /** Draw the axis spine line (usually false — `PlotFrame` provides it). */
  showLine?: boolean;
  /** Draw short tick marks at each tick. */
  tickMarks?: boolean;
}

/**
 * A complete bottom or left axis: gridlines + spine + tick marks + tick
 * labels + title, all styled from `../theme`. Renderers compute the tick
 * positions/labels (log-scale math, "nice" rounding, categorical centers)
 * and hand them here so the *drawing* is never duplicated.
 */
export function Axis({
  orientation,
  plot,
  ticks,
  title,
  showGrid = false,
  showLine = false,
  tickMarks = false,
}: AxisProps) {
  const right = plot.x + plot.width;
  const bottom = plot.y + plot.height;
  const isBottom = orientation === "bottom";
  const spine = isBottom ? bottom : plot.x;

  return (
    <g>
      {showGrid &&
        ticks.map((t, i) =>
          isBottom ? (
            <line
              key={`g${i}`}
              x1={t.pos}
              y1={plot.y}
              x2={t.pos}
              y2={bottom}
              stroke={GRID.color}
              strokeWidth={AXIS.lineWidth}
              strokeDasharray={GRID.dash}
              opacity={GRID.opacity}
            />
          ) : (
            <line
              key={`g${i}`}
              x1={plot.x}
              y1={t.pos}
              x2={right}
              y2={t.pos}
              stroke={GRID.color}
              strokeWidth={AXIS.lineWidth}
              strokeDasharray={GRID.dash}
              opacity={GRID.opacity}
            />
          ),
        )}

      {showLine &&
        (isBottom ? (
          <line
            x1={plot.x}
            y1={spine}
            x2={right}
            y2={spine}
            stroke={AXIS.lineColor}
            strokeWidth={AXIS.lineWidth}
          />
        ) : (
          <line
            x1={spine}
            y1={plot.y}
            x2={spine}
            y2={bottom}
            stroke={AXIS.lineColor}
            strokeWidth={AXIS.lineWidth}
          />
        ))}

      {ticks.map((t, i) =>
        isBottom ? (
          <g key={i}>
            {tickMarks && (
              <line
                x1={t.pos}
                y1={spine}
                x2={t.pos}
                y2={spine + AXIS.tickLength}
                stroke={AXIS.lineColor}
                strokeWidth={AXIS.lineWidth}
              />
            )}
            <TickText
              x={t.pos}
              y={spine + AXIS.tickLength + AXIS.tickFontSize}
              anchor="middle"
            >
              {t.label}
            </TickText>
          </g>
        ) : (
          <g key={i}>
            {tickMarks && (
              <line
                x1={spine}
                y1={t.pos}
                x2={spine - AXIS.tickLength}
                y2={t.pos}
                stroke={AXIS.lineColor}
                strokeWidth={AXIS.lineWidth}
              />
            )}
            <TickText
              x={spine - AXIS.tickLength - 2}
              y={t.pos + AXIS.tickFontSize / 3}
              anchor="end"
            >
              {t.label}
            </TickText>
          </g>
        ),
      )}

      {title &&
        (isBottom ? (
          <AxisTitle
            x={plot.x + plot.width / 2}
            y={bottom + AXIS.tickLength + AXIS.tickFontSize + AXIS.titleFontSize + 4}
          >
            {title}
          </AxisTitle>
        ) : (
          <AxisTitle
            x={plot.x - AXIS.tickLength - 34}
            y={plot.y + plot.height / 2}
            rotate={-90}
          >
            {title}
          </AxisTitle>
        ))}
    </g>
  );
}
