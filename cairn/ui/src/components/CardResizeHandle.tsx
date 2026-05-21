import { useCallback } from "react";

interface Props {
  /** Current persisted height in px; undefined = auto/default. */
  height: number | undefined;
  onHeightChange: (h: number | undefined) => void;
  /** Column span (1 = single column, 2 = double, etc.). */
  colSpan: number;
  onColSpanChange: (span: number) => void;
  /** Total grid columns available (default 6). */
  gridCols?: number;
  /** Minimum height in px (default 150). */
  minHeight?: number;
  /** Called with per-colSpan height when dragging. */
  onPerColHeightChange?: (patch: Record<string, unknown>) => void;
}

const MAX_HEIGHT = 2000;
const VALID_SPANS = [1, 2, 3, 6] as const;

/** Snap a raw column-span value to the nearest valid span. */
function snapToValidSpan(raw: number): number {
  let best: number = VALID_SPANS[0];
  let bestDist = Math.abs(raw - best);
  for (const v of VALID_SPANS) {
    const d = Math.abs(raw - v);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Corner resize handle for cards. Drag to resize both width (column span)
 * and height simultaneously.
 */
export default function CardResizeHandle({
  onHeightChange,
  colSpan,
  onColSpanChange,
  gridCols = 6,
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

      // Find sibling cards in the same grid row for height sync.
      const cardTop = card.getBoundingClientRect().top;
      const rowSiblings: HTMLElement[] = [];
      if (gridEl) {
        for (const el of gridEl.querySelectorAll(".card")) {
          if (el !== card && Math.abs(el.getBoundingClientRect().top - cardTop) < 2) {
            rowSiblings.push(el as HTMLElement);
          }
        }
      }

      let currentSpan = colSpan;
      const onPointerMove = (ev: PointerEvent) => {
        // Height: continuous
        const newH = Math.round(
          Math.min(MAX_HEIGHT, Math.max(minHeight, startHeight + (ev.clientY - startY))),
        );
        onHeightChange(newH);

        // Sync height to sibling cards in the same row (visual only during drag).
        for (const sib of rowSiblings) {
          sib.style.height = `${newH}px`;
        }

        // Also save to per-colSpan slot
        if (onPerColHeightChange) {
          onPerColHeightChange({ [`heights.${currentSpan}`]: newH, height: newH });
        }

        // Width: snap to valid column spans (skip on single-column mobile grid)
        if (actualCols > 1) {
          const targetWidth = startWidth + (ev.clientX - startX);
          const rawSpan = Math.max(1, Math.min(actualCols, Math.round(targetWidth / colWidth)));
          const newSpan = snapToValidSpan(rawSpan);
          if (newSpan !== currentSpan) currentSpan = newSpan;
          onColSpanChange(newSpan);
        }
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
        className="flex h-5 w-5 cursor-ns-resize md:cursor-nwse-resize items-end justify-end text-fg-muted hover:text-fg"
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
