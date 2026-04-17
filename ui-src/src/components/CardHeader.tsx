import type { ReactNode } from "react";
import { useDraggableCard } from "./DraggableCard";

interface Props {
  /** Metric name, e.g. "train.loss". */
  title: string;
  /** Right-side subtle text, e.g. "step 15 of 50" or a count. */
  subtitle?: ReactNode;
  /** Action cluster on the right: quick-toggle buttons + ⚙️ settings button. */
  children?: ReactNode;
}

/**
 * Standardized card header.
 *
 * A grip icon (≡) is rendered to the left of the title. When the card is
 * wrapped in a ``DraggableCard``, the grip becomes the **sole** drag handle
 * (``draggable`` on the grip ``<span>``, not on the outer card wrapper) so
 * that pointer gestures elsewhere on the card (plot zoom, slider drag, etc.)
 * are never intercepted by the browser's HTML5 drag system.
 */
export default function CardHeader({ title, subtitle, children }: Props) {
  const drag = useDraggableCard();

  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span
          aria-hidden="true"
          draggable={!!drag}
          onDragStart={drag?.handleDragStart}
          onDragEnd={drag?.handleDragEnd}
          className={[
            "cairn-drag-grip select-none text-fg-subtle transition-opacity",
            drag ? "cursor-grab active:cursor-grabbing" : "",
            // Visible on hover when inside a DraggableCard (via CSS in index.css);
            // always opacity-0 otherwise.
            "opacity-0",
          ].join(" ")}
          title="Drag to reorder"
        >
          {"\u2630"}
        </span>
        <h3 className="mono text-sm font-semibold truncate">{title}</h3>
      </div>
      <div className="flex items-center gap-1 text-xs text-fg-subtle">
        {subtitle}
        {children}
      </div>
    </div>
  );
}
