import { useCallback, useLayoutEffect, useState, type CSSProperties } from "react";

interface Rect { top: number; left: number; width: number; height: number }

export interface OverlaySlot {
  /** Ref for the empty box inside the overlay that reserves the content's area. */
  slotRef: (node: HTMLDivElement | null) => void;
  /** Style for the content box: `undefined` while closed, a fixed rect while open. */
  style: CSSProperties | undefined;
}

/**
 * Visually promote content into an overlay without moving it in the React tree.
 *
 * Rendering an expensive host (a mounted cairn-plot root, a WebGPU canvas) in
 * one tree position while the panel is closed and another while it is open
 * makes React unmount and rebuild it on every toggle — every pane loses its
 * decoded textures and repaints from "Loading…". So the content stays exactly
 * where it is and only its *style* changes: the overlay renders an empty slot,
 * this hook measures it, and the content is positioned `fixed` over that rect.
 *
 * The rect is measured in a layout effect on the same commit that mounts the
 * slot, so the promotion happens before the browser paints.
 */
export function useOverlaySlot(open: boolean): OverlaySlot {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const slotRef = useCallback((node: HTMLDivElement | null) => setSlot(node), []);

  useLayoutEffect(() => {
    if (!open || !slot) {
      setRect(null);
      return;
    }
    const measure = (): void => {
      const box = slot.getBoundingClientRect();
      setRect((prev) => (prev
        && prev.top === box.top && prev.left === box.left
        && prev.width === box.width && prev.height === box.height)
        ? prev
        : { top: box.top, left: box.left, width: box.width, height: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, slot]);

  const style: CSSProperties | undefined = !open
    ? undefined
    : rect
      ? { position: "fixed", top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex: 60 }
      // The slot has not been measured yet (it mounts in this same commit).
      // Stay hidden for that beat instead of flashing at the in-card position.
      : { position: "fixed", top: 0, left: 0, width: 0, height: 0, zIndex: 60, visibility: "hidden" };

  return { slotRef, style };
}
