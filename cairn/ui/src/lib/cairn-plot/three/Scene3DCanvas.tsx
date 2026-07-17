import { useState } from "react";
import { isValidPngDataUrl, type Scene3DHandle } from "./use-scene3d";

export interface Scene3DCanvasProps {
  handle: Scene3DHandle;
  className?: string;
}

/**
 * Shared `<div>` (container) + `<canvas>` (+ cached-image overlay, WS-3DR2)
 * markup for a `useScene3D` consumer's root. Every renderer (Mesh/Boxes/
 * Volume/PointCloud viewer) used to inline this container+canvas pair
 * identically; factored out so the park/re-acquire cached-image overlay
 * (`handle.cachedImageUrl`) is implemented ONCE, not duplicated per
 * renderer.
 *
 * The overlay `<img>` sits ON TOP of the canvas (so a parked — visually
 * blank, context-released — canvas stays covered by its last real frame)
 * but is `pointer-events: none`, so orbit/zoom gestures always land on the
 * canvas underneath regardless of park state — that's what lets
 * `OrbitControls`' own "start"/"change" listeners (attached to the canvas in
 * `useScene3D`) drive re-acquisition without any special event re-dispatch
 * here.
 */
export function Scene3DCanvas({ handle, className }: Scene3DCanvasProps) {
  // WS-3DR2 frowny-face guard: a src that already failed to decode is remembered
  // so we never re-render it (which would repaint the browser's broken-image
  // icon on top of the live canvas). Reset implicitly whenever `cachedImageUrl`
  // becomes a NEW value — the render guard below compares against it, so a fresh
  // good capture always shows.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // Only overlay the cached snapshot when it is a real, decodable PNG data url
  // (not the degenerate "data:," / 0-pixel readback a blank/released WebGL
  // context can produce) AND it isn't a src we've already seen fail to decode.
  const showCached =
    isValidPngDataUrl(handle.cachedImageUrl) && handle.cachedImageUrl !== failedSrc;

  return (
    <div ref={handle.containerRef} className={className ?? "relative h-full w-full"}>
      <canvas ref={handle.canvasRef} className="block h-full w-full rounded" />
      {showCached && (
        <img
          src={handle.cachedImageUrl!}
          alt=""
          aria-hidden
          onError={() => setFailedSrc(handle.cachedImageUrl)}
          className="pointer-events-none absolute inset-0 block h-full w-full rounded object-fill"
        />
      )}
      {/* Q10: very subtle 1px active-state border, shown only while this pane
          is activated for wheel-zoom. An overlay ring (not a real border on
          the container) so it never shifts layout; pointer-events:none so it
          never intercepts orbit/zoom gestures. */}
      {handle.active && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded border border-accent/50"
        />
      )}
    </div>
  );
}

export default Scene3DCanvas;
