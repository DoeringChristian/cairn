import { useEffect, useId, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Scene3DSyncOptions } from "../../lib/cairn-plot/three/use-scene3d";
import {
  getLastCameraState,
  makeCameraSyncSourceId,
  publishCameraState,
  subscribeCameraState,
  type CameraState,
} from "../../lib/cairn-plot/three/camera-sync";
import { CrossTypeCompositeMediaPane, type MediaCompareModeKind } from "../../lib/cairn-plot/media-compare";
import type { FrameSource } from "../../lib/cairn-plot/viewport/types";
import type { Colormap, DiffMode } from "../../lib/cairn-plot/types";
import { useOffscreenSnapshot } from "./use-offscreen-snapshot";

/** Convert any `FrameSource` variant to a plain `<img src>`-compatible
 *  string. `canvas` is read back via `toDataURL` (same operation
 *  `useOffscreenSnapshot` already performs on every live-viewer frame). */
export function frameSourceToUrl(f: FrameSource): string {
  if (f.kind === "url") return f.url;
  if (f.kind === "dataUrl") return f.dataUrl;
  return f.canvas.toDataURL("image/png");
}

/**
 * One side of a compare pane: either a LIVE hidden 3D viewer (today's
 * same-type 3D-vs-3D case — participates in the shared camera-sync group and
 * is snapshotted every frame) or an already-resolved static `FrameSource`
 * (WS-VC6 cross-type — e.g. a foreign card's image artifact URL, or another
 * type's own offscreen render already captured once — see
 * `components/card-kit/cross-type-frame.tsx`). A "frame" side renders
 * nothing hidden and never re-snapshots; it just feeds its URL straight into
 * the compositor.
 */
export type ComparePaneSource =
  | { kind: "live"; render: (onFrame: (canvas: HTMLCanvasElement) => void, sync: Scene3DSyncOptions) => React.ReactNode }
  | { kind: "frame"; frameSource: FrameSource };

export interface OffscreenComparePanesProps {
  /** One of the core "one-pane" media-compare kinds (side/split/blend/diff)
   *  — "normal" doesn't need offscreen compositing (see the card-level
   *  caller: "normal" renders the primary viewer directly). "side" is
   *  included for WS-VC6 cross-type (a foreign-type reference has no
   *  same-type `SideBySideView`; routing "side" through this shared
   *  compositor too, exactly like split/blend/diff, covers it for free). */
  mode: Extract<MediaCompareModeKind, "side" | "split" | "blend" | "diff">;
  primary: ComparePaneSource;
  reference: ComparePaneSource;
  diffSubmode: DiffMode;
  colormap: Colormap;
  splitPosition: number;
  onSplitPositionChange: (p: number) => void;
  blendAlpha: number;
  primaryLabel: string;
  /** WS-VC6: route `diff` through the resample/letterbox alignment step
   *  (only meaningful — and only ever passed — for a cross-type pane; a
   *  same-type pane's two live snapshots are already the same offscreen
   *  render size, so alignment would be a no-op there). */
  alignForDiff?: boolean;
}

/**
 * Interaction controller for the compare overlay.
 *
 * Attaches a REAL `OrbitControls` to the transparent interaction surface —
 * driving a bare `PerspectiveCamera` (no renderer, so NO extra WebGL
 * context) that is a peer in the offscreen mirrors' private camera-sync
 * group. Pointer drag → orbit, wheel → zoom on the controller camera; every
 * `OrbitControls` "change" publishes `{position,target,zoom}` to the group,
 * which BOTH offscreen mirror viewers apply (re-render + re-snapshot →
 * recomposite). It also subscribes to the group so it adopts the mirrors'
 * fitted camera (via `getLastCameraState` on mount + live updates), so the
 * first drag continues smoothly instead of jumping from a default pose.
 *
 * On-demand only: `OrbitControls` fires "change" solely on genuine pointer/
 * wheel input (no `enableDamping`, no rAF loop); the mirrors render once per
 * received state via their existing `use-scene3d` subscription.
 */
function useCompareCameraController(
  overlayRef: React.RefObject<HTMLDivElement>,
  groupId: string,
): void {
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(2, 1.5, 2);
    const controls = new OrbitControls(camera, el);
    controls.enableDamping = false;

    const sourceId = makeCameraSyncSourceId();
    let applyingRemote = false;

    const applyState = (state: CameraState) => {
      applyingRemote = true;
      camera.position.fromArray(state.position);
      controls.target.fromArray(state.target);
      camera.zoom = state.zoom;
      camera.updateProjectionMatrix();
      controls.update();
      applyingRemote = false;
    };

    // Adopt the mirrors' already-published (fitted) camera if present, so the
    // controller starts aligned and the first drag doesn't jump.
    const initial = getLastCameraState(groupId);
    if (initial) applyState(initial);

    const onChange = () => {
      if (applyingRemote) return;
      publishCameraState(groupId, sourceId, {
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        zoom: camera.zoom,
      });
    };
    controls.addEventListener("change", onChange);

    const unsubscribe = subscribeCameraState(groupId, sourceId, applyState);

    return () => {
      controls.removeEventListener("change", onChange);
      unsubscribe();
      controls.dispose();
    };
  }, [overlayRef, groupId]);
}

/**
 * Renders TWO hidden 3D viewers sharing a private live camera-sync group
 * (identical camera, per spec-visual-compare.md WS-VC2 §B), snapshots each
 * one's canvas to a data URL (`useOffscreenSnapshot`), and feeds those into
 * the SAME `CompositeMediaPane` an image card uses — this is the ONE
 * compositor (split/blend/pixel-diff), reused rather than forked, with
 * rendered-3D-canvas data URLs standing in for the artifact image URLs an
 * image card would fetch. Shared by every 3D card's 2-series compare
 * feature (mesh/pointcloud/boxes3d/volume) — not a per-card copy.
 *
 * The two source viewers are visually hidden (fixed off-screen position)
 * but still mounted at a real pixel size, since a WebGL canvas needs actual
 * dimensions to render into; only the composited `<img>`-based pane is
 * visible. A transparent interaction surface sits on top of the composite
 * (below the split divider's `z-20` handle, so split-drag still works) and
 * forwards drag/wheel gestures into the shared camera group via
 * `useCompareCameraController`, so the composited 3D output is fully
 * orbit/zoom interactive — both mirrors stay camera-locked because they
 * subscribe to the same group.
 *
 * WS-VC6: either side may instead be a `{kind:"frame"}` `ComparePaneSource`
 * (a foreign type's already-resolved raster — no hidden viewer, no
 * per-frame snapshot). The camera-sync group + interaction controller are
 * only meaningful when at least one side is `"live"`; when BOTH sides are
 * live (today's same-type case) behavior is byte-identical to before this
 * generalization.
 */
export function OffscreenComparePanes({
  mode,
  primary,
  reference,
  diffSubmode,
  colormap,
  splitPosition,
  onSplitPositionChange,
  blendAlpha,
  primaryLabel,
  alignForDiff,
}: OffscreenComparePanesProps) {
  // A private sync group, unrelated to the page-wide "Sync 3D views" group —
  // whichever side(s) are live + the interaction controller all share this
  // one camera while compare mode is active, independent of whether the
  // card's own panes join page sync.
  const groupId = `compare3d-${useId()}`;
  const sync: Scene3DSyncOptions = { groupId };

  const primarySnap = useOffscreenSnapshot();
  const referenceSnap = useOffscreenSnapshot();

  const anyLive = primary.kind === "live" || reference.kind === "live";
  const overlayRef = useRef<HTMLDivElement>(null);
  // Safe to call even when `!anyLive` (the overlay div below isn't rendered
  // in that case, so `overlayRef.current` stays null and the hook's own
  // `if (!el) return` guard makes it a no-op) — Rules of Hooks requires this
  // be called unconditionally regardless.
  useCompareCameraController(overlayRef, groupId);

  const primaryUrl = primary.kind === "live" ? primarySnap.dataUrl : frameSourceToUrl(primary.frameSource);
  const referenceUrl = reference.kind === "live" ? referenceSnap.dataUrl : frameSourceToUrl(reference.frameSource);

  return (
    <div className="relative h-full w-full">
      {primary.kind === "live" && (
        <div aria-hidden style={{ position: "absolute", left: -99999, top: 0, width: 640, height: 480 }}>
          {primary.render(primarySnap.onFrame, sync)}
        </div>
      )}
      {reference.kind === "live" && (
        <div aria-hidden style={{ position: "absolute", left: -99999, top: 0, width: 640, height: 480 }}>
          {reference.render(referenceSnap.onFrame, sync)}
        </div>
      )}
      <CrossTypeCompositeMediaPane
        mode={mode}
        imageUrl={primaryUrl}
        baselineUrl={referenceUrl}
        alignForDiff={alignForDiff}
        diffSubmode={diffSubmode}
        colormap={colormap}
        interpolation="auto"
        zoom={1}
        pan={{ x: 0, y: 0 }}
        splitPosition={splitPosition}
        blendAlpha={blendAlpha}
        onSplitPositionChange={onSplitPositionChange}
        label={primaryLabel}
      />
      {/* Transparent orbit/zoom surface. z-10 keeps it above the composited
          images but BELOW the split divider's z-20 handle, so split-drag
          still works while drags elsewhere orbit the shared 3D camera.
          Only mounted when at least one side is a live 3D viewer — a
          frame-vs-frame pane (not reachable today) would have nothing to
          orbit. */}
      {anyLive && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10"
          style={{ touchAction: "none", cursor: "grab" }}
        />
      )}
    </div>
  );
}

export default OffscreenComparePanes;
