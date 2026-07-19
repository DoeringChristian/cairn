// Internal satellite of ScalarPlot. Exported for ScalarPlot's use only —
// intentionally NOT re-exported from the public cairn-plot barrels.

import type { AxisSource } from "../../transforms/x-axis";
import { formatNum, formatXTick } from "../../format";
import { TOOLTIP_CHROME_CLASS } from "../../primitives/Tooltip";
import type { LegendSeries } from "./scalar-legend";

interface TooltipPayloadEntry {
  dataKey?: string | number;
  name?: string | number;
  color?: string;
  value?: number | string | Array<number | string>;
  payload?: Record<string, unknown>;
}

export function CustomTooltip({
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
  const labelNum = typeof label === "number" ? label : Number(label);
  return (
    // Same shared chrome (rounded, token bg/border, shadow) as every other
    // cairn-plot tooltip; only the min-width is scalar-specific.
    <div className={TOOLTIP_CHROME_CLASS} style={{ minWidth: 140 }}>
      <div style={{ color: "var(--color-fg-muted, #656d76)", marginBottom: 4 }}>
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
            <div style={{ color: meta?.color ?? entry.color ?? "var(--color-fg-muted, #656d76)" }}>
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
