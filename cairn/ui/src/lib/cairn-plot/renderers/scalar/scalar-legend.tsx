// Internal satellite of ScalarPlot. Exported for ScalarPlot's use only —
// intentionally NOT re-exported from the public cairn-plot barrels.

import type { PromotedSeriesConfig } from "../../types";

export interface LegendSeries {
  key: string;
  label: string;
  color: string;
}

export function CustomLegend({
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
