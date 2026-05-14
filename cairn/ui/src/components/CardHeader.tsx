import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useDraggableCard } from "./DraggableCard";

interface Props {
  /** Metric name, e.g. "train.loss". */
  title: string;
  /** Subtle text shown after the title in the left section. */
  subtitle?: ReactNode;
  /**
   * Card-specific action buttons rendered to the LEFT of the standard
   * buttons (settings, download, remove). When present a 1px divider
   * separates them from the standard group.
   */
  cardActions?: ReactNode;
  /** @deprecated Use `cardActions` instead. */
  children?: ReactNode;
  /** If provided, the title becomes editable. */
  onTitleChange?: (newTitle: string) => void;
  /** Whether the card body is collapsed (only header visible). */
  collapsed?: boolean;
  /** Toggle collapse state. When provided, a chevron is rendered. */
  onToggleCollapse?: () => void;
  /** Opens the card settings modal / popover. Renders gear button. */
  onSettings?: () => void;
  /** Download/export. Renders download button. */
  onDownload?: () => void;
  /** Slot for AddToComparisonButton in the standard cluster. */
  addToComparisonSlot?: ReactNode;
  /** Remove the card. Renders close button in upper-right. */
  onRemove?: () => void;
}

export default function CardHeader({
  title,
  subtitle,
  cardActions,
  children,
  onTitleChange,
  collapsed,
  onToggleCollapse,
  onSettings,
  onDownload,
  addToComparisonSlot,
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

  const resolvedActions = cardActions ?? children;
  const hasStandardActions = !!(onDownload || addToComparisonSlot || onSettings || onRemove);

  return (
    <div className="group mb-2 flex items-baseline justify-between gap-2">
      {/* Left section: collapse chevron, drag grip, title, edit, subtitle */}
      <div className="flex items-baseline gap-1.5 min-w-0">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="h-[22px] min-w-[22px] inline-flex items-center justify-center select-none text-fg-subtle hover:text-fg text-xs leading-none transition-transform"
            style={{ transform: collapsed ? "rotate(-90deg)" : undefined }}
            aria-label={collapsed ? "Expand card" : "Collapse card"}
            title={collapsed ? "Expand card" : "Collapse card"}
          >
            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
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
          <i className="fa-solid fa-grip-vertical" aria-hidden="true" />
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
                className="h-[22px] min-w-[22px] inline-flex items-center justify-center text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
                title="Edit title"
                aria-label="Edit title"
              >
                <i className="fa-solid fa-pencil" aria-hidden="true" />
              </button>
            )}
          </>
        )}
        {subtitle && (
          <span className="text-xs text-fg-subtle shrink-0">{subtitle}</span>
        )}
      </div>

      {/* Right section: card-specific actions | divider | standard actions */}
      <div className="flex items-center gap-1 text-xs text-fg-subtle shrink-0">
        {/* Card-specific actions */}
        {resolvedActions}

        {/* Standard buttons: download, settings, remove */}
        {hasStandardActions && (
          <div className={resolvedActions ? "border-l border-border pl-1.5 flex items-center gap-1" : "flex items-center gap-1"}>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="h-[22px] min-w-[22px] inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
                aria-label="Save"
                title="Save"
              >
                <i className="fa-solid fa-arrow-down" aria-hidden="true" />
              </button>
            )}
            {addToComparisonSlot}
            {onSettings && (
              <button
                type="button"
                onClick={onSettings}
                className="h-[22px] min-w-[22px] inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
                aria-label="Settings"
                title="Settings"
              >
                <i className="fa-solid fa-gear" aria-hidden="true" />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="h-[22px] min-w-[22px] inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
                aria-label="Remove card"
                title="Remove card"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
