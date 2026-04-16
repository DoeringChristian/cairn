/**
 * Thin wrapper that makes its children draggable via HTML5 native drag & drop.
 *
 * We stash the cardKey on the DataTransfer under a custom MIME type so
 * accidental drops onto non-card targets (e.g. a file input) can't misinterpret
 * the payload. The drag-image is whatever the browser picks (the element
 * itself, typically).
 *
 * Visual feedback: while being dragged, the element is rendered at 50% opacity.
 * The `.cairn-draggable-card` class wires up the hover-reveal grip styling
 * defined in `index.css`.
 */

import { useState } from "react";
import type { DragEvent, ReactNode } from "react";

export const CAIRN_CARD_MIME = "application/x-cairn-card";

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

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(CAIRN_CARD_MIME, cardKey);
    // Some browsers require at least one "text/plain" payload to treat the
    // drag as valid on certain drop targets. Include both.
    e.dataTransfer.setData("text/plain", cardKey);
    setDragging(true);
    onDragStart(cardKey, section);
  };

  const handleDragEnd = () => {
    setDragging(false);
    onDragEnd();
  };

  return (
    <div
      data-card-key={cardKey}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`cairn-draggable-card ${dragging ? "opacity-50" : ""}`}
    >
      {children}
    </div>
  );
}
