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
 * A small drag handle for resizing a card's height, plus a full-width
 * toggle button.
 *
 * **Parent card requirements:** the card container must have
 * `position: relative` and `overflow: hidden` for this handle to
 * position correctly at the bottom-right corner.
 */
export default function CardResizeHandle({
  onHeightChange,
  fullWidth,
  onFullWidthToggle,
  minHeight = 100,
}: Props) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const parent = target.parentElement;
      if (!parent) return;

      const startY = e.clientY;
      const startHeight = parent.getBoundingClientRect().height;

      const onPointerMove = (ev: PointerEvent) => {
        const newH = Math.round(
          Math.min(MAX_HEIGHT, Math.max(minHeight, startHeight + (ev.clientY - startY))),
        );
        onHeightChange(newH);
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [minHeight, onHeightChange],
  );

  return (
    <div className="absolute bottom-0 right-0 flex items-end gap-0.5">
      <button
        type="button"
        onClick={onFullWidthToggle}
        className={`flex h-3 w-4 items-center justify-center rounded-sm text-[8px] leading-none ${
          fullWidth
            ? "text-accent hover:text-accent"
            : "text-fg-subtle hover:text-fg-muted"
        }`}
        title={fullWidth ? "Collapse to half width" : "Expand to full width"}
        aria-label={fullWidth ? "Collapse to half width" : "Expand to full width"}
        aria-pressed={fullWidth}
      >
        {"\u2194"}
      </button>
      <div
        onPointerDown={handlePointerDown}
        className="flex h-3 w-3 cursor-nwse-resize items-end justify-end text-fg-subtle hover:text-fg-muted"
        title="Drag to resize"
      >
        {/* Diagonal grip lines rendered as a small SVG */}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className="pointer-events-none"
          aria-hidden="true"
        >
          <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
          <line x1="9" y1="4" x2="4" y2="9" stroke="currentColor" strokeWidth="1" />
          <line x1="9" y1="7" x2="7" y2="9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}
