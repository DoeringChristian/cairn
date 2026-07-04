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

/**
 * MIME used when dragging a concrete, already-resolved viewport (the pane's
 * own rendered content at the current step) rather than a series identity.
 * Dropping THIS onto a reference drop target initiates a GLOBAL reference
 * (one shared baseline for every pane); dropping a `CAIRN_SERIES_MIME` chip
 * (a series identity, no bound image) initiates a PER-RUN reference (each
 * pane resolves its own copy of that series name, step-matched). See
 * `card-kit/use-reference-drop.ts`, the one shared implementation of this
 * drop-target contract used by the image card and all 3D cards.
 */
export const CAIRN_IMAGE_MIME = "application/x-cairn-image";

export interface SeriesRef {
  runId?: string;
  name: string;
  context_hash: string;
}

/**
 * Start dragging a concrete rendered viewport (image pane or 3D pane) as a
 * `CAIRN_IMAGE_MIME` payload — "the viewport label" drag source referenced
 * throughout the media-compare drop-target docs. One implementation shared
 * by `ImagePane`/`CompositeMediaPane` labels (image card) and `MultiPaneGrid`
 * pane badges (3D cards), so both drag identical payloads.
 */
export function startViewportDrag(
  e: DragEvent<Element>,
  tag: SeriesRef,
  label: string,
): void {
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData(CAIRN_IMAGE_MIME, JSON.stringify(tag));
  e.dataTransfer.setData("text/plain", label);
}

interface Props {
  series: SeriesRef;
  color: string;
  label: string;
  runId: string;
  onRemove?: () => void;
  onClick?: () => void;
  selected?: boolean;
}

export default function SeriesChip({
  series,
  color,
  label,
  runId,
  onRemove,
  onClick,
  selected,
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
      onClick={onClick}
      className={`mono inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs cursor-grab active:cursor-grabbing ${
        dragging ? "opacity-50" : ""
      } ${selected ? "border-accent bg-accent/10 text-fg" : "border-border bg-bg text-fg-muted"} ${onClick ? "hover:border-accent/50" : ""}`}
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
