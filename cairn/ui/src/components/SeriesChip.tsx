/**
 * Visual pill representing one plotted series in a card's chip strip.
 *
 * Chips are draggable (copy semantics) so they can be used with the
 * comparison system or future interactions. Cards do NOT have drop
 * targets for chips — series management within a card uses the ×
 * button (remove) and the settings popover MetricChips picker (add).
 */

import { useState } from "react";
import type { DragEvent } from "react";

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
  series,
  color,
  label,
  runId,
  onRemove,
}: Props) {
  const [dragging, setDragging] = useState(false);

  const onDragStart = (e: DragEvent<HTMLSpanElement>) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData(
      CAIRN_SERIES_MIME,
      JSON.stringify({
        runId: series.runId ?? runId,
        name: series.name,
        context_hash: series.context_hash,
      }),
    );
    e.dataTransfer.setData("text/plain", label);
    setDragging(true);
  };

  const onDragEnd = () => {
    setDragging(false);
  };

  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`mono inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted cursor-grab active:cursor-grabbing ${
        dragging ? "opacity-50" : ""
      }`}
      style={{ WebkitUserDrag: "element" } as React.CSSProperties}
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
          draggable={false}
        >
          {"\u00D7"}
        </button>
      )}
    </span>
  );
}
