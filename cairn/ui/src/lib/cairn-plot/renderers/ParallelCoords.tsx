import { useCallback, useId, useMemo, useState, type ReactNode } from "react";
import type { ParallelColumn, ParallelRow } from "../types";
import { normalizeValue } from "../transforms/normalize";
import { viridis } from "../colormaps/viridis";
import { useContainerSize } from "../hooks/use-container-size";
import { formatNum } from "../format";
import { AXIS } from "../theme";
import Tooltip from "../primitives/Tooltip";
import { TickText, AxisTitle } from "../primitives/Axis";
import { pointerAnchor, type TooltipAnchor } from "../primitives/tooltip-position";
import type { ChartCapabilities } from "../viewport/use-chart-viewport";
import PlotToolbar from "../primitives/PlotToolbar";
import type { PlotController, ToPNGOptions } from "../controls/types";
import { plotToPng, type PlotToPngOptions } from "../primitives/plot-to-png";

/**
 * Parallel-coordinates deliberately opts OUT of the shared chart-zoom (no
 * `useChartViewport`). Each of the N vertical axes is an independent 1D scale,
 * so a single shared 2D box-zoom/pan domain is undefined here — Plotly handles
 * exploration on this plot via per-axis brushing (range selection along one
 * axis), not a global viewport. Until per-axis brushing lands, this renderer
 * exposes only the non-viewport capabilities so a future toolbar (S5) can
 * honestly hide the zoom/pan/box controls for PC.
 */
export const PARALLEL_COORDS_CAPABILITIES: ChartCapabilities = {
  zoom: false,
  pan: false,
  boxZoom: false,
  autoscale: false,
  reset: false,
  screenshot: true,
};

export interface ParallelCoordsProps {
  columns: ParallelColumn[];
  rows: ParallelRow[];
  columnDomains: Array<{ min: number; max: number; isNumeric: boolean }>;
  selectedIds?: Set<string>;
  onHover?: (
    rowId: string | null,
    screen: {
      x: number;
      y: number;
      containerW: number;
      containerH: number;
    } | null,
  ) => void;
  onClick?: (rowId: string) => void;
  tooltipContent?: (
    row: ParallelRow,
    columns: ParallelColumn[],
  ) => ReactNode;
  className?: string;
}

export default function ParallelCoords({
  columns,
  rows,
  columnDomains,
  selectedIds,
  onHover,
  onClick,
  tooltipContent,
  className,
}: ParallelCoordsProps) {
  const rawId = useId();
  const gradientId = `pc-cbar-${rawId.replace(/:/g, "")}`;
  const { ref: containerRef, size } = useContainerSize();

  // ParallelCoords opts out of the shared 2D viewport (see the module comment),
  // so it exposes a REDUCED but HONEST controller. The one thing it can
  // genuinely do is a client-side PNG export: `plotToPng` rasterizes the `<svg>`
  // under the root, so `screenshot` is truly capable and the camera button
  // downloads the PC chart. Every other capability is honestly `false`:
  //   - zoom/pan/boxZoom/autoscale: no shared 2D viewport here (per-axis 1D
  //     scales have no single 2D domain — see the module comment).
  //   - reset: PC holds NO clearable exploration state. `selectedIds` is owned
  //     by the parent (PC only emits `onClick`), and `hoveredId` is transient.
  //     There is no per-axis brush or column-reorder state to clear, so `reset`
  //     stays `false` rather than showing a button that would clear nothing.
  //     (When per-axis brushing / reorder lands, flip `reset` to true and clear
  //     that state in the `reset()` handler + set `isModified` accordingly.)
  const toPNG = useCallback(
    (opts?: ToPNGOptions): Promise<Blob> => {
      const root = containerRef.current;
      if (!root)
        return Promise.reject(
          new Error("ParallelCoords.toPNG: no root element to export"),
        );
      const png: PlotToPngOptions = { scale: opts?.scale, filename: opts?.filename };
      return plotToPng(root, png);
    },
    [containerRef],
  );
  const controller = useMemo<PlotController>(
    () => ({
      capabilities: {
        zoom: false,
        pan: false,
        boxZoom: false,
        select: false,
        lasso: false,
        autoscale: false,
        reset: false,
        screenshot: PARALLEL_COORDS_CAPABILITIES.screenshot,
        hover: false,
        spikelines: false,
        hoverModes: false,
        legend: false,
        axisScaleToggle: false,
        perAxisDrag: false,
        brush: false,
        reorder: false,
      },
      dragMode: "zoom",
      hoverMode: "closest",
      spikelines: false,
      isModified: false,
      setDragMode: () => {},
      setHoverMode: () => {},
      toggleSpikelines: () => {},
      zoomIn: () => {},
      zoomOut: () => {},
      autoscale: () => {},
      reset: () => {},
      toPNG,
    }),
    [toPNG],
  );
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<TooltipAnchor | null>(null);

  const handleRowEnter = (row: ParallelRow, e: React.MouseEvent) => {
    setHoveredId(row.id);
    const anchor = pointerAnchor(e, containerRef);
    if (anchor) {
      setTooltipPos(anchor);
      onHover?.(row.id, anchor);
    }
  };

  const handleRowMove = (e: React.MouseEvent) => {
    const anchor = pointerAnchor(e, containerRef);
    if (anchor) setTooltipPos(anchor);
  };

  const handleLeave = () => {
    setHoveredId(null);
    setTooltipPos(null);
    onHover?.(null, null);
  };

  const { w, h } = size;
  const pad = { top: 30, bottom: 20, left: 60, right: 60 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const colX = columns.map((_, i) =>
    pad.left +
    (columns.length === 1
      ? plotW / 2
      : (i / (columns.length - 1)) * plotW),
  );

  const colorColIdx = columns.length - 1;
  const colorDomain = columnDomains[colorColIdx];

  const hoveredRow = hoveredId
    ? (rows.find((r) => r.id === hoveredId) ?? null)
    : null;

  return (
    <div
      ref={containerRef}
      className={`group relative ${className ?? ""}`}
      onMouseLeave={handleLeave}
    >
      <PlotToolbar controller={controller} />
      {plotW > 0 && plotH > 0 && (
        <svg width={w} height={h} className="select-none">
          {columns.map((col, ci) => {
            const x = colX[ci]!;
            const d = columnDomains[ci]!;
            return (
              <g key={ci}>
                <line
                  x1={x}
                  y1={pad.top}
                  x2={x}
                  y2={pad.top + plotH}
                  stroke={AXIS.lineColor}
                  strokeWidth={AXIS.lineWidth}
                />
                <AxisTitle x={x} y={pad.top - 8}>
                  {col.key}
                </AxisTitle>
                <TickText x={x} y={pad.top + plotH + 14}>
                  {formatNum(d.min)}
                </TickText>
                <TickText x={x} y={pad.top - 1}>
                  {formatNum(d.max)}
                </TickText>
              </g>
            );
          })}

          {rows.map((row) => {
            const points: Array<{ x: number; y: number }> = [];
            for (let ci = 0; ci < columns.length; ci++) {
              const t = normalizeValue(row.values[ci], columnDomains[ci]!, columns[ci]);
              if (t == null) continue;
              points.push({
                x: colX[ci]!,
                y: pad.top + plotH - t * plotH,
              });
            }
            if (points.length < 2) return null;

            const colorT = colorDomain
              ? normalizeValue(
                  row.values[colorColIdx],
                  colorDomain,
                  columns[colorColIdx],
                )
              : null;
            const color = colorT != null ? viridis(colorT) : "#656d76";
            const isHovered = hoveredId === row.id;
            const isSelected = selectedIds?.has(row.id);
            const isDimmed =
              (hoveredId != null && !isHovered) ||
              ((selectedIds?.size ?? 0) > 0 && !isSelected && !isHovered);

            const d = points
              .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
              .join(" ");

            return (
              <g
                key={row.id}
                className="cursor-pointer"
                onClick={() => onClick?.(row.id)}
                onMouseEnter={(e) => handleRowEnter(row, e)}
                onMouseMove={handleRowMove}
                onMouseLeave={handleLeave}
              >
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={8}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={isHovered ? 3 : 1.5}
                  strokeOpacity={isDimmed ? 0.15 : 0.8}
                />
                {points.map((p, pi) => (
                  <circle
                    key={pi}
                    cx={p.x}
                    cy={p.y}
                    r={isHovered ? 4 : 3}
                    fill={color}
                    stroke="white"
                    strokeWidth={1}
                    opacity={isDimmed ? 0.2 : 1}
                  />
                ))}
              </g>
            );
          })}

          {colorDomain && (
            <g>
              <defs>
                <linearGradient
                  id={gradientId}
                  x1="0"
                  y1="1"
                  x2="0"
                  y2="0"
                >
                  <stop offset="0%" stopColor={viridis(0)} />
                  <stop offset="50%" stopColor={viridis(0.5)} />
                  <stop offset="100%" stopColor={viridis(1)} />
                </linearGradient>
              </defs>
              <rect
                x={w - 18}
                y={pad.top}
                width={10}
                height={plotH}
                fill={`url(#${gradientId})`}
                rx={2}
              />
            </g>
          )}
        </svg>
      )}

      {hoveredRow && tooltipPos && (
        <Tooltip
          x={tooltipPos.x}
          y={tooltipPos.y}
          containerW={tooltipPos.containerW}
          containerH={tooltipPos.containerH}
        >
          {tooltipContent ? (
            tooltipContent(hoveredRow, columns)
          ) : (
            <>
              {hoveredRow.label && (
                <div className="font-semibold mono mb-1 truncate">
                  {hoveredRow.label}
                </div>
              )}
              {columns.map((col, ci) => (
                <div key={ci} className="flex justify-between gap-2">
                  <span className="text-fg-muted truncate">{col.key}</span>
                  <span className="mono shrink-0">
                    {hoveredRow.raw[ci] ?? "—"}
                  </span>
                </div>
              ))}
            </>
          )}
        </Tooltip>
      )}
    </div>
  );
}
