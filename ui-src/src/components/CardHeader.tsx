import type { ReactNode } from "react";

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
 * A small grip-icon (≡) is rendered to the left of the title and stays hidden
 * by default. When the card is wrapped in a `DraggableCard`, CSS in
 * `index.css` reveals the grip on hover and switches the cursor to `grab`.
 * The actual HTML5 `draggable` attribute lives on the outer wrapper, not
 * here — this icon is purely a visual affordance.
 */
export default function CardHeader({ title, subtitle, children }: Props) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-1.5 min-w-0">
        <span
          aria-hidden="true"
          className="cairn-drag-grip select-none text-fg-subtle opacity-0 transition-opacity"
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
