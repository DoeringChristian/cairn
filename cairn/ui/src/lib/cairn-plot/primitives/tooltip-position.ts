import type { RefObject } from "react";

/**
 * Consistent gap (px) between the cursor tip and the tooltip. Shared with the
 * `Tooltip` primitive so the offset and its edge-flip use the exact same value.
 */
export const TOOLTIP_OFFSET = 12;

/**
 * A pointer position expressed in the renderer-container coordinate space,
 * bundled with that same container's measured size. This is the ONE model every
 * 2D cairn-plot renderer feeds to `Tooltip`: `x`/`y` and `containerW`/
 * `containerH` all come from a single `getBoundingClientRect()` call, so the
 * coordinate space the pointer lives in is identical to the box the tooltip
 * flips/clamps against.
 */
export interface TooltipAnchor {
  /** Pointer x relative to the container's left edge. */
  x: number;
  /** Pointer y relative to the container's top edge. */
  y: number;
  /** Container width (px) — same rect `x` is measured against. */
  containerW: number;
  /** Container height (px) — same rect `y` is measured against. */
  containerH: number;
}

/** Build an anchor from an already-measured container rect (avoids a second
 *  `getBoundingClientRect()` when the caller already has one for hit-testing). */
export function anchorFromRect(
  e: { clientX: number; clientY: number },
  rect: DOMRect,
): TooltipAnchor {
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    containerW: rect.width,
    containerH: rect.height,
  };
}

/**
 * Convert a pointer event into a `TooltipAnchor` in the container's coordinate
 * space. Returns null when the container isn't mounted/measured yet. Every 2D
 * renderer routes pointer -> tooltip position through this helper so placement
 * is computed identically everywhere.
 */
export function pointerAnchor(
  e: { clientX: number; clientY: number },
  container: RefObject<HTMLElement | null>,
): TooltipAnchor | null {
  const rect = container.current?.getBoundingClientRect();
  if (!rect) return null;
  return anchorFromRect(e, rect);
}
