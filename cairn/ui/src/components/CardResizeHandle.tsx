import { useCallback } from "react";

interface Props {
  /** Current persisted height; undefined = auto. */
  height: number | undefined;
  /** Called with the new height, or undefined to reset to auto. */
  onHeightChange: (h: number | undefined) => void;
  /** Whether the card currently spans all grid columns. */
  fullWidth: boolean;
  /** Toggle between single-column and full-width. */
  onFullWidthToggle: () => void;
  /** Minimum height in px (default 100). */
  minHeight?: number;
}

const MAX_HEIGHT = 2000;

/**
 * Corner resize handle for cards. Drag vertically to resize height;
 * drag horizontally past a threshold to toggle full-width.
 *
 * **Parent requirements:** `position: relative` and `overflow: visible`
 * (or `hidden` if you don't want the grip to overflow).
 */
export default function CardResizeHandle({
  height: _height,
  onHeightChange,
  fullWidth,
  onFullWidthToggle,
  minHeight = 100,
}: Props) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const parent = target.closest(".card") as HTMLElement | null;
      if (!parent) return;

      const startX = e.clientX;
      const startY = e.clientY;
      // Always measure from DOM for accurate starting height.
      const startHeight = parent.getBoundingClientRect().height;
      const startFullWidth = fullWidth;
      let toggled = false;

      const onPointerMove = (ev: PointerEvent) => {
        // Height resize (vertical drag)
        const newH = Math.round(
          Math.min(
            MAX_HEIGHT,
            Math.max(minHeight, startHeight + (ev.clientY - startY)),
          ),
        );
        onHeightChange(newH);

        // Width toggle: if dragged >80px horizontally, toggle full-width once.
        const dx = ev.clientX - startX;
        if (!toggled && Math.abs(dx) > 80) {
          // Dragging right when half-width → expand. Dragging left when full → collapse.
          if (dx > 0 && !startFullWidth) {
            onFullWidthToggle();
            toggled = true;
          } else if (dx < 0 && startFullWidth) {
            onFullWidthToggle();
            toggled = true;
          }
        }
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [minHeight, onHeightChange, fullWidth, onFullWidthToggle],
  );

  return (
    <div className="absolute bottom-0 right-0 flex items-end gap-0.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFullWidthToggle(); }}
        className={`flex h-5 w-5 items-center justify-center rounded text-xs leading-none hover:bg-bg-hover ${
          fullWidth
            ? "text-accent"
            : "text-fg-subtle hover:text-fg-muted"
        }`}
        title={fullWidth ? "Half width" : "Full width"}
        aria-label={fullWidth ? "Half width" : "Full width"}
        aria-pressed={fullWidth}
      >
        {"\u2194"}
      </button>
      <div
        onPointerDown={handlePointerDown}
        className="flex h-5 w-5 cursor-nwse-resize items-end justify-end text-fg-subtle hover:text-fg-muted"
        title="Drag to resize"
        style={{ touchAction: "none" }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          className="pointer-events-none"
          aria-hidden="true"
        >
          <line x1="11" y1="1" x2="1" y2="11" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="5" x2="5" y2="11" stroke="currentColor" strokeWidth="1.5" />
          <line x1="11" y1="9" x2="9" y2="11" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
}
