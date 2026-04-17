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
  /** Called after a successful drop on another target (move semantics). */
  onDraggedOut?: () => void;
}

export default function SeriesChip({
  series,
  color,
  label,
  runId,
  onRemove,
  onDraggedOut,
}: Props) {
  const [dragging, setDragging] = useState(false);

  const onDragStart = (e: DragEvent<HTMLSpanElement>) => {
    // "move" tells the drop target we want move semantics (source removes).
    e.dataTransfer.effectAllowed = "move";
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

  const onDragEnd = (e: DragEvent<HTMLSpanElement>) => {
    setDragging(false);
    // If the drop was accepted (dropEffect === "move"), notify the source
    // card so it can remove this series. If the drag was cancelled (e.g.
    // user pressed Escape or dropped on a non-target), dropEffect is "none".
    if (e.dataTransfer.dropEffect === "move" && onDraggedOut) {
      onDraggedOut();
    }
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
