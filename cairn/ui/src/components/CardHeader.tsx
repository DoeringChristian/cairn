import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useDraggableCard } from "./DraggableCard";

interface Props {
  /** Metric name, e.g. "train.loss". */
  title: string;
  /** Right-side subtle text, e.g. "step 15 of 50" or a count. */
  subtitle?: ReactNode;
  /**
   * Card-specific action buttons rendered to the LEFT of the standard
   * buttons (settings, add-to-comparison, remove). Use this for quick
   * toggles like smoothing badge, y-scale, zoom reset, etc.
   */
  children?: ReactNode;
  /** If provided, the title becomes editable. */
  onTitleChange?: (newTitle: string) => void;
  /** Whether the card body is collapsed (only header visible). */
  collapsed?: boolean;
  /** Toggle collapse state. When provided, a chevron is rendered. */
  onToggleCollapse?: () => void;
  /** Opens the card settings modal / popover. Renders ⚙ button. */
  onSettings?: () => void;
  /** Toggle full-width. Renders ↔ button. */
  onToggleFullWidth?: () => void;
  /** Whether the card is currently full width. */
  isFullWidth?: boolean;
  /** Fit card height to content. Renders ↕ button. */
  onFitHeight?: () => void;
  /** Remove the card. Renders × button in upper-right. */
  onRemove?: () => void;
}

export default function CardHeader({
  title,
  subtitle,
  children,
  onTitleChange,
  collapsed,
  onToggleCollapse,
  onSettings,
  onToggleFullWidth,
  isFullWidth,
  onFitHeight,
  onRemove,
}: Props) {
  const drag = useDraggableCard();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

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
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="select-none text-fg-subtle hover:text-fg text-xs leading-none transition-transform"
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
            aria-label={collapsed ? "Expand card" : "Collapse card"}
            title={collapsed ? "Expand card" : "Collapse card"}
          >
            {"\u25BC"}
          </button>
        )}
        <span
          aria-hidden="true"
          draggable={!!drag}
          onDragStart={drag?.handleDragStart}
          onDragEnd={drag?.handleDragEnd}
          className={[
            "cairn-drag-grip select-none text-fg-subtle transition-opacity",
            drag ? "cursor-grab active:cursor-grabbing" : "",
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
      <div className="flex items-center gap-1 text-xs text-fg-subtle shrink-0">
        {subtitle}
        {/* Card-specific buttons (passed as children) */}
        {children}
        {/* Standard buttons: full-width, settings, remove */}
        {onFitHeight && (
          <button
            type="button"
            onClick={onFitHeight}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Fit height to content"
            title="Fit height to content"
          >
            {"\u2195"}
          </button>
        )}
        {onToggleFullWidth && (
          <button
            type="button"
            onClick={onToggleFullWidth}
            className={`h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover ${isFullWidth ? "text-accent" : "text-fg-muted hover:text-fg"}`}
            aria-label={isFullWidth ? "Half width" : "Full width"}
            title={isFullWidth ? "Half width" : "Full width"}
          >
            {"\u2194"}
          </button>
        )}
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Settings"
            title="Settings"
          >
            {"\u2699"}
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
            aria-label="Remove card"
            title="Remove card"
          >
            {"\u00D7"}
          </button>
        )}
      </div>
    </div>
  );
}
