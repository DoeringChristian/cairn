import type { Scene3DHandle } from "./use-scene3d";

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
  return (
    <div ref={handle.containerRef} className={className ?? "relative h-full w-full"}>
      <canvas ref={handle.canvasRef} className="block h-full w-full rounded" />
      {handle.cachedImageUrl && (
        <img
          src={handle.cachedImageUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 block h-full w-full rounded object-cover"
        />
      )}
    </div>
  );
}

export default Scene3DCanvas;
