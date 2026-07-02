import { useCallback, useEffect, useRef } from "react";
import { useModifierKey } from "./use-modifier-key";

export interface Viewport {
  zoom: number;
  pan: { x: number; y: number };
}

const DEFAULT_MIN_ZOOM = 0.25;
const DEFAULT_MAX_ZOOM = 16;

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
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, s.zoom * factor));
      if (s.zoom === nextZoom) return;
      const rect = el.getBoundingClientRect();
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
  }, [containerRef, !!onViewportChange, minZoom, maxZoom]);

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
