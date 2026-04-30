import { useCallback } from "react";

interface Props {
  /** Current persisted height in px; undefined = auto/default. */
  height: number | undefined;
  onHeightChange: (h: number | undefined) => void;
  /** Column span (1 = single column, 2 = double, etc.). */
  colSpan: number;
  onColSpanChange: (span: number) => void;
  /** Total grid columns available (default 2). */
  gridCols?: number;
  /** Minimum height in px (default 150). */
  minHeight?: number;
  /** Called with per-colSpan height when dragging. Saves to height1/height2. */
  onPerColHeightChange?: (patch: Record<string, unknown>) => void;
}

const MAX_HEIGHT = 2000;

/**
 * Corner resize handle for cards. Drag to resize both width (column span)
 * and height simultaneously.
 */
export default function CardResizeHandle({
  onHeightChange,
  colSpan,
  onColSpanChange,
  gridCols = 2,
  minHeight = 150,
  onPerColHeightChange,
}: Props) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const card = target.closest(".card") as HTMLElement | null;
      if (!card) return;

      const startY = e.clientY;
      const startX = e.clientX;
      const startHeight = card.getBoundingClientRect().height;
      const startWidth = card.getBoundingClientRect().width;

      // Find the grid container and detect actual column count from CSS
      let grid = card.parentElement;
      // Walk up past display:contents wrappers
      while (grid && getComputedStyle(grid).display === "contents") {
        grid = grid.parentElement;
      }
      if (!grid || !grid.closest(".grid")) {
        grid = card.closest(".grid")?.parentElement ?? card.parentElement;
      }
      const gridEl = grid?.closest(".grid") ?? grid;
      const gridWidth = gridEl?.getBoundingClientRect().width ?? startWidth * 2;
      // Detect actual column count from computed grid style
      const gridStyle = gridEl ? getComputedStyle(gridEl) : null;
      const actualCols = gridStyle?.gridTemplateColumns
        ? gridStyle.gridTemplateColumns.split(/\s+/).length
        : gridCols;
      const colWidth = gridWidth / actualCols;

      let currentSpan = colSpan;
      const onPointerMove = (ev: PointerEvent) => {
        // Height: continuous
        const newH = Math.round(
          Math.min(MAX_HEIGHT, Math.max(minHeight, startHeight + (ev.clientY - startY))),
        );
        onHeightChange(newH);

        // Also save to per-colSpan slot
        if (onPerColHeightChange) {
          const key = currentSpan > 1 ? "height2" : "height1";
          onPerColHeightChange({ [key]: newH, height: newH });
        }

        // Width: snap to column spans based on drag distance
        const targetWidth = startWidth + (ev.clientX - startX);
        const newSpan = Math.max(1, Math.min(actualCols, Math.round(targetWidth / colWidth)));
        if (newSpan !== currentSpan) currentSpan = newSpan;
        onColSpanChange(newSpan);
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [minHeight, onHeightChange, colSpan, onColSpanChange, gridCols, onPerColHeightChange],
  );

  return (
    <div className="absolute bottom-0 right-0 p-1">
      <div
        onPointerDown={handlePointerDown}
        className="flex h-5 w-5 cursor-nwse-resize items-end justify-end text-fg-muted hover:text-fg"
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
