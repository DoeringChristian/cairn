import { useId, useState, type ReactNode } from "react";
import type { ParallelColumn, ParallelRow } from "../types";
import { normalizeValue } from "../transforms/normalize";
import { viridis } from "../colormaps/viridis";
import { useContainerSize } from "../hooks/use-container-size";
import { formatNum } from "../format";
import { AXIS } from "../theme";
import Tooltip from "../primitives/Tooltip";
import { pointerAnchor, type TooltipAnchor } from "../primitives/tooltip-position";

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
      className={`relative ${className ?? ""}`}
      onMouseLeave={handleLeave}
    >
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
                <text
                  x={x}
                  y={pad.top - 8}
                  textAnchor="middle"
                  className="fill-fg-muted"
                  style={{ fontSize: AXIS.titleFontSize }}
                >
                  {col.key}
                </text>
                <text
                  x={x}
                  y={pad.top + plotH + 14}
                  textAnchor="middle"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: AXIS.tickFontSize }}
                >
                  {formatNum(d.min)}
                </text>
                <text
                  x={x}
                  y={pad.top - 1}
                  textAnchor="middle"
                  className="mono fill-fg-subtle"
                  style={{ fontSize: AXIS.tickFontSize }}
                >
                  {formatNum(d.max)}
                </text>
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
