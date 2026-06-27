import { useCallback, useEffect, useRef } from "react";

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
 * and height simultaneously. ColSpan changes are broadcast to all sibling
 * cards in the same grid (section) via a custom DOM event.
 */
export default function CardResizeHandle({
  onHeightChange,
  colSpan,
  onColSpanChange,
  gridCols = 6,
  minHeight = 150,
  onPerColHeightChange,
}: Props) {
  const handleRef = useRef<HTMLDivElement>(null);
  const colSpanCbRef = useRef(onColSpanChange);
  colSpanCbRef.current = onColSpanChange;
  const heightCbRef = useRef(onHeightChange);
  heightCbRef.current = onHeightChange;

  // Listen for colSpan/height changes broadcast by sibling CardResizeHandles.
  useEffect(() => {
    const el = handleRef.current;
    if (!el) return;
    let grid = el.closest(".card")?.parentElement;
    while (grid && getComputedStyle(grid).display === "contents") grid = grid.parentElement;
    if (!grid || !grid.closest(".grid")) grid = el.closest(".grid")?.parentElement ?? grid;
    const gridEl = (grid?.closest(".grid") ?? grid) as HTMLElement | null;
    if (!gridEl) return;
    const onColSpan = (e: Event) => {
      colSpanCbRef.current((e as CustomEvent).detail.colSpan);
    };
    const card = el.closest(".card") as HTMLElement | null;
    const onHeight = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!card) return;
      const myTop = card.getBoundingClientRect().top;
      if (Math.abs(myTop - d.rowTop) < 2) {
        heightCbRef.current(d.height);
      }
    };
    gridEl.addEventListener("cairn:colSpanChange", onColSpan);
    gridEl.addEventListener("cairn:heightChange", onHeight);
    return () => {
      gridEl.removeEventListener("cairn:colSpanChange", onColSpan);
      gridEl.removeEventListener("cairn:heightChange", onHeight);
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      const card = target.closest(".card") as HTMLElement | null;
      if (!card) return;

      const startPageY = e.clientY + window.scrollY;
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

      // Collect all siblings for colSpan sync.
      const allSiblings: HTMLElement[] = [];
      if (gridEl) {
        for (const el of gridEl.querySelectorAll(".card")) {
          if (el !== card) allSiblings.push(el as HTMLElement);
        }
      }

      let currentSpan = colSpan;
      let lastH = startHeight;
      const heightTouched = new Set<HTMLElement>();

      // Add temporary spacer so the last card has room to resize into.
      // Append to the grid's parent (a <section>), which is in the document
      // flow and will extend the scrollable area.
      const spacerParent = (gridEl as HTMLElement)?.parentElement ?? card.parentElement!;
      const spacer = document.createElement("div");
      spacer.style.height = `${MAX_HEIGHT}px`;
      spacer.style.flexShrink = "0";
      spacerParent.appendChild(spacer);

      let scrollRaf = 0;
      let lastClientY = 0;

      const updateCardHeight = () => {
        const pageY = lastClientY + window.scrollY;
        const newH = Math.round(
          Math.min(MAX_HEIGHT, Math.max(minHeight, startHeight + (pageY - startPageY))),
        );
        lastH = newH;
        card.style.height = `${newH}px`;

        const cardTop = card.getBoundingClientRect().top;
        for (const sib of allSiblings) {
          if (Math.abs(sib.getBoundingClientRect().top - cardTop) < 2) {
            sib.style.height = `${newH}px`;
            heightTouched.add(sib);
          } else if (heightTouched.has(sib)) {
            sib.style.height = "";
            heightTouched.delete(sib);
          }
        }
      };

      const scrollTick = () => {
        const threshold = 48;
        const vh = window.innerHeight;
        if (lastClientY > vh - threshold) {
          const speed = 8 + 12 * ((lastClientY - (vh - threshold)) / threshold);
          window.scrollBy(0, speed);
          updateCardHeight();
          scrollRaf = requestAnimationFrame(scrollTick);
        } else if (lastClientY < threshold) {
          const speed = 8 + 12 * ((threshold - lastClientY) / threshold);
          window.scrollBy(0, -speed);
          updateCardHeight();
          scrollRaf = requestAnimationFrame(scrollTick);
        }
      };

      const onPointerMove = (ev: PointerEvent) => {
        lastClientY = ev.clientY;
        updateCardHeight();

        cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(scrollTick);

        if (actualCols > 1) {
          const targetWidth = startWidth + (ev.clientX - startX);
          const rawSpan = Math.max(1, Math.min(actualCols, Math.round(targetWidth / colWidth)));
          const newSpan = snapToValidSpan(rawSpan);
          if (newSpan !== currentSpan) {
            currentSpan = newSpan;
            for (const sib of allSiblings) {
              sib.style.gridColumn = `span ${newSpan}`;
            }
          }
          onColSpanChange(newSpan);
        }
      };

      const onPointerUp = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        cancelAnimationFrame(scrollRaf);
        spacer.remove();
        // Persist final height to React state (triggers one re-render).
        onHeightChange(lastH);
        if (onPerColHeightChange) {
          onPerColHeightChange({ [`heights.${currentSpan}`]: lastH, height: lastH });
        }
        // Broadcast changes to all sibling cards via custom events.
        if (gridEl) {
          gridEl.dispatchEvent(new CustomEvent("cairn:heightChange", { detail: { height: lastH, rowTop: card.getBoundingClientRect().top } }));
          gridEl.dispatchEvent(new CustomEvent("cairn:colSpanChange", { detail: { colSpan: currentSpan } }));
        }
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    },
    [minHeight, onHeightChange, colSpan, onColSpanChange, gridCols, onPerColHeightChange],
  );

  return (
    <div ref={handleRef} className="absolute bottom-0 right-0 p-1 hidden md:block">
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
