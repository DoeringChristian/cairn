/**
 * Thin wrapper that enables drag-to-reorder for cards.
 *
 * IMPORTANT: The ``draggable`` attribute is NOT on this wrapper — that would
 * steal every pointer gesture (slider drags, plot pan, box-zoom, etc.) from
 * the card's body. Instead, only the grip icon inside ``CardHeader`` is
 * ``draggable``. This wrapper provides a React Context that the grip reads
 * to configure its ``dataTransfer`` payload and fire the correct callbacks.
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
      <div
        data-card-key={cardKey}
        className={`cairn-draggable-card ${dragging ? "opacity-50" : ""}`}
      >
        {children}
      </div>
    </DraggableCardCtx.Provider>
  );
}
