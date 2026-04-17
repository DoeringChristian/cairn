/**
 * Visual pill representing one plotted series in a card's chip strip.
 *
 * Shows a color swatch + label + optional × remove button. Chips are NOT
 * draggable — series management is done via the × button (to remove) and
 * the settings popover's MetricChips picker (to add). The drag-drop
 * approach caused cascading re-render bugs and has been disabled.
 */

export const CAIRN_SERIES_MIME = "application/x-cairn-series";

export interface SeriesRef {
  runId?: string;
  name: string;
  context_hash: string;
}

interface Props {
  series: SeriesRef;
  color: string;
  label: string;
  runId: string;
  onRemove?: () => void;
}

export default function SeriesChip({
  color,
  label,
  onRemove,
}: Props) {
  return (
    <span
      className="mono inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 10,
          height: 2,
          background: color,
          borderRadius: 1,
          flexShrink: 0,
        }}
      />
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          className="ml-0.5 text-fg-subtle hover:text-fg"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          {"\u00D7"}
        </button>
      )}
    </span>
  );
}
