/**
 * Shared grid container for cards with drag-to-reorder and drop highlighting.
 *
 * Used by workspace, comparison, and can replace section grids in CardGrid.
 * Cards are wrapped in DraggableCard for the ≡ grip handle.
 */

import { useCallback, useRef, type ReactNode } from "react";
import DraggableCard, { CAIRN_CARD_MIME } from "./DraggableCard";

interface CardEntry {
  key: string;
  content: ReactNode;
}

interface Props {
  cards: CardEntry[];
  onReorder?: (fromKey: string, toKey: string) => void;
  className?: string;
  dataAttributes?: Record<string, string>;
}

function findCardUnderCursor(
  gridEl: HTMLElement,
  clientX: number,
  clientY: number,
): { el: HTMLElement; key: string } | null {
  // Find all .card elements and check which one contains the cursor
  const cardEls = Array.from(gridEl.querySelectorAll(".card")) as HTMLElement[];
  for (const cardEl of cardEls) {
    const rect = cardEl.getBoundingClientRect();
    if (
      clientY >= rect.top &&
      clientY <= rect.bottom &&
      clientX >= rect.left &&
      clientX <= rect.right
    ) {
      const wrapper = cardEl.closest("[data-card-key]");
      const key = wrapper?.getAttribute("data-card-key") ?? null;
      if (key) return { el: cardEl, key };
    }
  }
  return null;
}

export default function ReorderableCardGrid({
  cards,
  onReorder,
  className,
  dataAttributes,
}: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  const clearHighlight = useCallback(() => {
    gridRef.current
      ?.querySelectorAll(".cairn-drop-target")
      .forEach((el) => el.classList.remove("cairn-drop-target"));
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(CAIRN_CARD_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearHighlight();
      const gridEl = gridRef.current;
      if (!gridEl) return;
      const target = findCardUnderCursor(gridEl, e.clientX, e.clientY);
      if (target) target.el.classList.add("cairn-drop-target");
    },
    [clearHighlight],
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        clearHighlight();
      }
    },
    [clearHighlight],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      clearHighlight();
      const fromKey = e.dataTransfer.getData(CAIRN_CARD_MIME);
      if (!fromKey || !onReorder) return;
      e.preventDefault();
      const gridEl = gridRef.current;
      if (!gridEl) return;
      const target = findCardUnderCursor(gridEl, e.clientX, e.clientY);
      if (target && target.key !== fromKey) {
        onReorder(fromKey, target.key);
      }
    },
    [onReorder, clearHighlight],
  );

  return (
    <div
      ref={gridRef}
      className={`grid grid-cols-1 items-stretch gap-4 md:grid-cols-6 ${className ?? ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      {...(dataAttributes ?? {})}
    >
      {cards.map((card) => (
        <DraggableCard
          key={card.key}
          cardKey={card.key}
          section="grid"
          onDragStart={() => {}}
          onDragEnd={() => {}}
        >
          {card.content}
        </DraggableCard>
      ))}
    </div>
  );
}
