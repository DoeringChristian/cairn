/**
 * `primitives/PlotLegend.tsx` — the shared interactive legend for cairn-plot's
 * multi-series charts (S6, Plotly legend parity).
 *
 * A row of swatch+label chips. Single-click toggles a series' visibility,
 * double-click isolates it (both delegated to a {@link SeriesVisibility} from
 * `hooks/use-series-visibility.ts`). Hidden series render at ~0.35 opacity with
 * a struck-through label, exactly like Plotly's dimmed legend entries. The
 * legend is presentational: it never hides marks itself, it only drives the
 * visibility state the renderer reads back to skip its series.
 *
 * An optional `onSelect` keeps the existing "click a series to select the run"
 * affordance available to hosts that want it, separate from show/hide.
 */
import type { SeriesVisibility } from "../hooks/use-series-visibility";

export interface LegendItem {
  key: string;
  label: string;
  color: string;
}

export interface PlotLegendProps {
  items: LegendItem[];
  visibility: SeriesVisibility;
  /** Optional trailing content per chip (e.g. ScalarPlot's promote button). */
  chipTrailing?: (item: LegendItem) => React.ReactNode;
  className?: string;
}

const HIDDEN_OPACITY = 0.35;

export default function PlotLegend({
  items,
  visibility,
  chipTrailing,
  className,
}: PlotLegendProps) {
  if (items.length === 0) return null;
  return (
    <ul
      className={`flex flex-wrap justify-center gap-x-3 gap-y-1 ${className ?? ""}`}
    >
      {items.map((item) => {
        const hidden = visibility.isHidden(item.key);
        return (
          <li
            key={item.key}
            className="inline-flex items-center gap-1 text-[11px] text-fg-muted"
          >
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-fg"
              style={{ opacity: hidden ? HIDDEN_OPACITY : 1 }}
              onClick={() => visibility.toggle(item.key)}
              onDoubleClick={(e) => {
                // Suppress the paired single-click's toggle so a dblclick is a
                // clean isolate, not toggle-then-isolate.
                e.preventDefault();
                visibility.isolate(item.key);
              }}
              title="Click to hide/show. Double-click to isolate."
              aria-pressed={!hidden}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 3,
                  borderRadius: 1,
                  background: item.color,
                  marginRight: 2,
                }}
              />
              <span
                style={{
                  textDecoration: hidden ? "line-through" : undefined,
                }}
              >
                {item.label}
              </span>
            </button>
            {chipTrailing?.(item)}
          </li>
        );
      })}
    </ul>
  );
}
