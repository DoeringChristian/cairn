import { useCallback, useEffect, useRef } from "react";
import { useModifierKey } from "./use-modifier-key";

export interface Viewport {
  zoom: number;
  pan: { x: number; y: number };
}

const DEFAULT_MIN_ZOOM = 0.25;
// Q25 fix: was 16 — too low to GUARANTEE the TEV pixel-value overlay
// (`PixelValueOverlay`'s `PIXEL_VALUE_MIN_SCREEN_PX = 30`) is ever reachable.
// A pane's max on-screen scale at this cap is `homeScale * DEFAULT_MAX_ZOOM`,
// where `homeScale = min(box.width/naturalW, box.height/naturalH)` — for a
// modest image (e.g. 128x96) inside a narrow multi-column grid cell
// (~230px wide), `homeScale` can be as low as ~1.8px/texel, giving a max
// reachable scale of only ~28.75px/texel: JUST under the 30px threshold, so
// the per-pixel numbers NEVER appear no matter how far the user zooms (the
// zoom is already pinned at its cap) — this affects ANY image pane using
// this shared hook (`ImagePane`/`HdrImagePane`/`GpuImagePane`/
// `CompositeMediaPane`/`GpuComparePane` alike; it is not specific to any one
// of them), it just happens to bite tighter/smaller-image layouts first. 64x
// (a common upper bound for TEV-style pixel inspectors) gives generous
// headroom for typical grid layouts instead of a near-miss.
const DEFAULT_MAX_ZOOM = 64;

/**
 * Q29: adaptive max-zoom — the zoom at which a single source texel fills the
 * viewport (spans its larger dimension), rather than a fixed multiple of the
 * home view. `homeScale = min(boxW/naturalW, boxH/naturalH)` is px-per-texel at
 * zoom 1; a texel is `homeScale * zoom` px on screen, so it fills
 * `max(boxW,boxH)` at `zoom = max(boxW,boxH)/homeScale`. This scales with the
 * image's native resolution — a 4K image gets a huge cap (inspect any pixel), a
 * 16x16 a small one — so ANY resolution can be zoomed to "1 pixel fills the
 * viewport". Floored so you can always zoom in a bit even for near-1:1 layouts.
 */
export function adaptiveMaxZoom(
  naturalW: number,
  naturalH: number,
  boxW: number,
  boxH: number,
): number {
  if (naturalW <= 0 || naturalH <= 0 || boxW <= 0 || boxH <= 0) return DEFAULT_MAX_ZOOM;
  const homeScale = Math.min(boxW / naturalW, boxH / naturalH);
  if (homeScale <= 0) return DEFAULT_MAX_ZOOM;
  return Math.max(Math.max(boxW, boxH) / homeScale, 8);
}

/**
 * Image-viewport interaction: modifier-gated wheel zoom-to-cursor and
 * pointer-capture panning. Self-contained — the wheel listener is attached
 * natively (non-passive) to `containerRef` so it can `preventDefault`.
 *
 * The `onViewportChange` callback is full-replace (both `zoom` and `pan`).
 */
export function useImageViewport(args: {
  containerRef: React.RefObject<HTMLElement | null>;
  zoom: number;
  pan: { x: number; y: number };
  onViewportChange?: (v: Viewport) => void;
  minZoom?: number;
  maxZoom?: number;
  /** Q29: when the image's natural pixel size is known, the max zoom becomes
   *  adaptive (zoom until one texel fills the viewport) instead of `maxZoom`. */
  naturalWidth?: number;
  naturalHeight?: number;
}): {
  containerProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    style: React.CSSProperties;
  };
  modifierActive: boolean;
} {
  const {
    containerRef,
    zoom,
    pan,
    onViewportChange,
    minZoom = DEFAULT_MIN_ZOOM,
    maxZoom = DEFAULT_MAX_ZOOM,
    naturalWidth,
    naturalHeight,
  } = args;

  // -----------------------------------------------------------------------
  // Modifier key tracking (Alt/Ctrl/Meta for zoom+pan)
  // -----------------------------------------------------------------------
  const modifierActive = useModifierKey();
  const altDownRef = useRef(modifierActive);
  altDownRef.current = modifierActive;

  // Latest viewport + callback, read imperatively from event handlers.
  const viewportRef = useRef({ zoom, pan });
  viewportRef.current = { zoom, pan };

  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  // -----------------------------------------------------------------------
  // Wheel zoom (local — zoom to cursor position)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onViewportChange) return;
    const handler = (e: WheelEvent) => {
      if (!altDownRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const s = viewportRef.current;
      const rect = el.getBoundingClientRect();
      // Q29: cap zoom by the FINAL resolution (one texel fills the viewport),
      // not a fixed multiple — falls back to `maxZoom` when natural size is
      // unknown. Uses the LIVE container rect so it tracks resizes.
      const effMax =
        naturalWidth && naturalHeight
          ? adaptiveMaxZoom(naturalWidth, naturalHeight, rect.width, rect.height)
          : maxZoom;
      const nextZoom = Math.max(minZoom, Math.min(effMax, s.zoom * factor));
      if (s.zoom === nextZoom) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const newPanX = cx - ((cx - s.pan.x) / s.zoom) * nextZoom;
      const newPanY = cy - ((cy - s.pan.y) / s.zoom) * nextZoom;
      onViewportChangeRef.current?.({
        zoom: nextZoom,
        pan: { x: newPanX, y: newPanY },
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [containerRef, !!onViewportChange, minZoom, maxZoom, naturalWidth, naturalHeight]);

  // -----------------------------------------------------------------------
  // Pointer pan (local)
  // -----------------------------------------------------------------------
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!altDownRef.current || !onViewportChangeRef.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: viewportRef.current.pan.x,
      panY: viewportRef.current.pan.y,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    onViewportChangeRef.current?.({
      zoom: viewportRef.current.zoom,
      pan: { x: s.panX + dx, y: s.panY + dy },
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragStateRef.current = null;
  }, []);

  const canPan = modifierActive && !!onViewportChange;

  return {
    containerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      style: {
        cursor: canPan ? "move" : undefined,
        touchAction: canPan ? "none" : undefined,
      },
    },
    modifierActive,
  };
}
