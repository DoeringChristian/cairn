import { useCallback, useEffect, useRef, useState } from "react";

export interface UseOffscreenSnapshotResult {
  /** Latest PNG data URL of the snapshotted canvas, or `null` before the
   *  first frame. */
  dataUrl: string | null;
  /** Pass as a 3D viewer's `onFrame` prop. */
  onFrame: (canvas: HTMLCanvasElement) => void;
}

/**
 * Turns a live `<canvas>` (via a viewer's `onFrame` — see `use-scene3d.ts`)
 * into a `dataUrl` state value, coalesced to at most one encode per
 * animation frame (camera-sync can fire `onFrame` many times per user
 * drag-gesture; `canvas.toDataURL()` is comparatively expensive, so this
 * avoids encoding every single one).
 *
 * This is how 3D cards feed the shared media-compare compositor
 * (`CompositeMediaPane`) for image-space split/blend/pixel-diff modes: two
 * of these (one per series, both viewers sharing a live camera-sync group —
 * see `lib/camera-sync.ts`) stand in for the "fetch two image URLs" step an
 * image card does, so the SAME compositor renders side/split/blend/diff for
 * a rendered 3D pane, not a second implementation (spec-visual-compare.md
 * WS-VC2 / quality bar #2).
 */
export function useOffscreenSnapshot(): UseOffscreenSnapshotResult {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const onFrame = useCallback((canvas: HTMLCanvasElement) => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      try {
        setDataUrl(canvas.toDataURL("image/png"));
      } catch {
        // Tainted canvas or an otherwise unreadable context — leave the
        // previous snapshot in place rather than throwing.
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  return { dataUrl, onFrame };
}
