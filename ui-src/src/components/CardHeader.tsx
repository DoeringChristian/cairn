import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useDraggableCard } from "./DraggableCard";

interface Props {
  /** Metric name, e.g. "train.loss". */
  title: string;
  /** Right-side subtle text, e.g. "step 15 of 50" or a count. */
  subtitle?: ReactNode;
  /** Action cluster on the right: quick-toggle buttons + ⚙️ settings button. */
  children?: ReactNode;
  /** If provided, the title becomes editable. */
  onTitleChange?: (newTitle: string) => void;
}

/**
 * Standardized card header.
 *
 * A grip icon (≡) is rendered to the left of the title. When the card is
 * wrapped in a ``DraggableCard``, the grip becomes the **sole** drag handle
 * (``draggable`` on the grip ``<span>``, not on the outer card wrapper) so
 * that pointer gestures elsewhere on the card (plot zoom, slider drag, etc.)
 * are never intercepted by the browser's HTML5 drag system.
 *
 * When ``onTitleChange`` is provided the title becomes editable: a pencil icon
 * appears on hover, and clicking it (or double-clicking the title) switches to
 * an inline input. Blur or Enter commits; Escape cancels.
 */
export default function CardHeader({
  title,
  subtitle,
  children,
  onTitleChange,
}: Props) {
  const drag = useDraggableCard();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep draft in sync when title prop changes while not editing.
  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    onTitleChange?.(trimmed || title);
  }, [draft, title, onTitleChange]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft(title);
  }, [title]);

  const startEditing = useCallback(() => {
    if (!onTitleChange) return;
    setDraft(title);
    setEditing(true);
  }, [onTitleChange, title]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
    },
    [commitEdit, cancelEdit],
  );

  return (
    <div className="group mb-2 flex items-baseline justify-between gap-2">
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

        {editing ? (
          <input
            ref={inputRef}
            className="input mono text-sm font-semibold"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <>
            <h3
              className="mono text-sm font-semibold truncate"
              onDoubleClick={startEditing}
            >
              {title}
            </h3>
            {onTitleChange && (
              <button
                type="button"
                onClick={startEditing}
                className="text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
                title="Edit title"
                aria-label="Edit title"
              >
                {"\u270E"}
              </button>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 text-xs text-fg-subtle">
        {subtitle}
        {children}
      </div>
    </div>
  );
}
