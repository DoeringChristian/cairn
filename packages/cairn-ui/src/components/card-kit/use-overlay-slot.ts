import { useCallback, useLayoutEffect, useState, type CSSProperties } from "react";

interface Rect { top: number; left: number; width: number; height: number }

/**
 * One above `CardDetailModal`'s `z-50` container, so the promoted content
 * paints over the modal's backdrop and inside its reserved slot. Keep the two
 * in step if either changes.
 */
const ABOVE_CARD_MODAL_Z = 60;

export interface OverlaySlot {
  /** Ref for the empty box inside the overlay that reserves the content's area. */
  slotRef: (node: HTMLDivElement | null) => void;
  /** Style for the content box: `undefined` while closed, a fixed rect while open. */
  style: CSSProperties | undefined;
}

function readRect(node: HTMLElement): Rect {
  const box = node.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return a !== null && a.top === b.top && a.left === b.left
    && a.width === b.width && a.height === b.height;
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
 * The first measurement happens in the ref callback, i.e. during the commit
 * that inserts the slot and before any layout effect, so no 0×0 or unpositioned
 * frame is ever painted. The layout effect deliberately does not reset the rect
 * on that commit — its `slot` is still stale there — and re-measures once the
 * node is known: it runs after the overlay's own layout effects (child-first
 * ordering), e.g. the body-scroll lock in `use-modal-behavior`, so it sees the
 * post-lock viewport, still before paint. It then tracks `ResizeObserver`,
 * `resize`, and capture-phase `scroll` (rAF-coalesced) — the last one because a
 * scroll in any ancestor scroller moves the slot without resizing it.
 *
 * CONSTRAINT: no ancestor of the promoted content may establish a containing
 * block for `position: fixed` — that is, none of them may set `transform`,
 * `perspective`, `filter`, `backdrop-filter`, `contain: paint/layout/strict`, or
 * `will-change` on any of those. The rect this hook produces is viewport-
 * relative; under such an ancestor the content would be positioned against that
 * ancestor's box instead and land in the wrong place. (Verified for the card
 * chain and `index.css` when this was written.)
 */
export function useOverlaySlot(open: boolean): OverlaySlot {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const slotRef = useCallback((node: HTMLDivElement | null) => {
    // Measure here, in the commit that inserts the slot and before any layout
    // effect, so the promoted box is already positioned on its first painted
    // frame. The effect below must not clobber this with a stale `slot`.
    setRect(node ? readRect(node) : null);
    setSlot(node);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    // `slot` is still the pre-ref-callback value on the commit that mounts the
    // slot (state set from a ref callback is only visible on the next render),
    // so bail out rather than discarding the ref callback's measurement. The
    // `slot` dependency re-runs this the moment the real node is known.
    if (!slot) return;

    let frame = 0;
    const measure = (): void => {
      const box = readRect(slot);
      setRect((prev) => (sameRect(prev, box) ? prev : box));
    };
    // Scroll fires far faster than the screen updates; one measurement per
    // frame is all a repositioned box can use.
    const measureNextFrame = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    // Runs after the overlay's own layout effects (child-first ordering), so
    // this sees the post-scroll-lock viewport, still before paint.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    // Capture phase: scroll does not bubble from an inner scroller.
    window.addEventListener("scroll", measureNextFrame, true);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measureNextFrame, true);
    };
  }, [open, slot]);

  const style: CSSProperties | undefined = !open
    ? undefined
    : rect
      ? {
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        zIndex: ABOVE_CARD_MODAL_Z,
      }
      // Defensive: the slot measures itself in its ref callback, so this only
      // covers a commit where the overlay is open but no slot is mounted yet.
      // Stay hidden rather than flashing at the in-card position.
      : {
        position: "fixed",
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        zIndex: ABOVE_CARD_MODAL_Z,
        visibility: "hidden",
      };

  return { slotRef, style };
}
