/**
 * Shared grid container for cards with drag-to-reorder support.
 *
 * Used by workspace, comparison, and (optionally) the metrics tab.
 * Cards are wrapped in DraggableCard for the ≡ grip handle.
 * The grid accepts drops and highlights the target card.
 */

import { useCallback, useRef, type ReactNode } from "react";
import DraggableCard, { CAIRN_CARD_MIME } from "./DraggableCard";

interface CardEntry {
  /** Unique key for drag identification. */
  key: string;
  /** React node to render. */
  content: ReactNode;
}

interface Props {
  cards: CardEntry[];
  /** Called when a card is dropped onto another. */
  onReorder?: (fromKey: string, toKey: string) => void;
  /** Extra className for the grid container. */
  className?: string;
  /** data attributes to pass to the grid div. */
  dataAttributes?: Record<string, string>;
}

export default function ReorderableCardGrid({
  cards,
  onReorder,
  className,
  dataAttributes,
}: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);

  const findTargetKey = useCallback((gridEl: HTMLElement, clientX: number, clientY: number): string | null => {
    const cardEls = Array.from(gridEl.querySelectorAll(":scope > .cairn-draggable-card > .card, :scope > .cairn-draggable-card .card"));
    for (const cardEl of cardEls) {
      const rect = cardEl.getBoundingClientRect();
      if (
        clientY >= rect.top && clientY <= rect.bottom &&
        clientX >= rect.left && clientX <= rect.right
      ) {
        const wrapper = cardEl.closest("[data-card-key]");
        return wrapper?.getAttribute("data-card-key") ?? null;
      }
    }
    // If not over any card, target the last one
    const last = cardEls[cardEls.length - 1]?.closest("[data-card-key]");
    return last?.getAttribute("data-card-key") ?? null;
  }, []);

  const clearHighlight = useCallback(() => {
    gridRef.current?.querySelectorAll(".cairn-drop-target").forEach((el) =>
      el.classList.remove("cairn-drop-target"),
    );
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes(CAIRN_CARD_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      // Highlight the card under cursor
      clearHighlight();
      const gridEl = gridRef.current;
      if (!gridEl) return;
      const cardEls = Array.from(gridEl.querySelectorAll(":scope > .cairn-draggable-card > .card, :scope > .cairn-draggable-card .card"));
      for (const cardEl of cardEls) {
        const rect = cardEl.getBoundingClientRect();
        if (
          e.clientY >= rect.top && e.clientY <= rect.bottom &&
          e.clientX >= rect.left && e.clientX <= rect.right
        ) {
          (cardEl as HTMLElement).classList.add("cairn-drop-target");
          break;
        }
      }
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
      const toKey = findTargetKey(gridEl, e.clientX, e.clientY);
      if (toKey && toKey !== fromKey) {
        onReorder(fromKey, toKey);
      }
    },
    [onReorder, findTargetKey, clearHighlight],
  );

  return (
    <div
      ref={gridRef}
      className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${className ?? ""}`}
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
