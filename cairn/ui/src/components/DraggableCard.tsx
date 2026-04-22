/**
 * Wrapper that enables drag-to-reorder for cards.
 *
 * The wrapper div is completely inert — no draggable, no onDragStart. The
 * ONLY drag source is the grip icon (≡) inside CardHeader, which reads the
 * context provided here. This ensures plot zoom, slider drags, image pan,
 * etc. are never intercepted by the browser's HTML5 drag system.
 *
 * The grip's onDragStart sets the drag image to the whole card container
 * (via closest(".cairn-draggable-card")) so the user sees the full card
 * being dragged, not just the tiny grip icon.
 */

import { createContext, useContext, useState } from "react";
import type { DragEvent, ReactNode } from "react";

export const CAIRN_CARD_MIME = "application/x-cairn-card";

// ---------- Context for the grip handle ------------------------------------

interface DragCtx {
  cardKey: string;
  section: string;
  dragging: boolean;
  handleDragStart: (e: DragEvent<HTMLSpanElement>) => void;
  handleDragEnd: () => void;
}

const DraggableCardCtx = createContext<DragCtx | null>(null);

/** Used by ``CardHeader``'s grip icon to wire into the drag system. */
export function useDraggableCard(): DragCtx | null {
  return useContext(DraggableCardCtx);
}

// ---------- Wrapper --------------------------------------------------------

interface Props {
  cardKey: string;
  section: string;
  children: ReactNode;
  onDragStart: (cardKey: string, section: string) => void;
  onDragEnd: () => void;
}

export default function DraggableCard({
  cardKey,
  section,
  children,
  onDragStart,
  onDragEnd,
}: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDragStart = (e: DragEvent<HTMLSpanElement>) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(CAIRN_CARD_MIME, cardKey);
    e.dataTransfer.setData("text/plain", cardKey);

    // Use the whole card as the drag ghost, not just the tiny grip icon.
    const cardEl = (e.target as HTMLElement).closest(".cairn-draggable-card");
    if (cardEl) {
      e.dataTransfer.setDragImage(cardEl, 20, 20);
    }

    setDragging(true);
    onDragStart(cardKey, section);
  };

  const handleDragEnd = () => {
    setDragging(false);
    onDragEnd();
  };

  return (
    <DraggableCardCtx.Provider
      value={{ cardKey, section, dragging, handleDragStart, handleDragEnd }}
    >
      {/* Completely inert: NO draggable, NO onDragStart on this div. */}
      <div
        data-card-key={cardKey}
        className={`cairn-draggable-card ${dragging ? "opacity-50" : ""}`}
        style={{ display: "contents" }}
      >
        {children}
      </div>
    </DraggableCardCtx.Provider>
  );
}
