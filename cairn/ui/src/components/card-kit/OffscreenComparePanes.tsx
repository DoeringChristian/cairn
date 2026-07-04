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
import { CompositeMediaPane, type MediaCompareModeKind } from "../../lib/cairn-plot/media-compare";
import type { Colormap, DiffMode } from "../../lib/cairn-plot/types";
import { useOffscreenSnapshot } from "./use-offscreen-snapshot";

export interface OffscreenComparePanesProps {
  /** One of the core "one-pane" media-compare kinds (split/blend/diff) —
   *  "normal"/"side" don't need offscreen compositing (see the card-level
   *  caller: "normal" renders the primary viewer directly, "side" renders
   *  both viewers directly, neither goes through this component). */
  mode: Extract<MediaCompareModeKind, "split" | "blend" | "diff">;
  /** Renders the PRIMARY series' (hidden) viewer — must forward `onFrame`
   *  and `sync` to the underlying `use-scene3d`-based viewer unchanged. */
  renderPrimary: (onFrame: (canvas: HTMLCanvasElement) => void, sync: Scene3DSyncOptions) => React.ReactNode;
  /** Renders the REFERENCE series' (hidden) viewer, same contract. */
  renderReference: (onFrame: (canvas: HTMLCanvasElement) => void, sync: Scene3DSyncOptions) => React.ReactNode;
  diffSubmode: DiffMode;
  colormap: Colormap;
  splitPosition: number;
  onSplitPositionChange: (p: number) => void;
  blendAlpha: number;
  primaryLabel: string;
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
 */
export function OffscreenComparePanes({
  mode,
  renderPrimary,
  renderReference,
  diffSubmode,
  colormap,
  splitPosition,
  onSplitPositionChange,
  blendAlpha,
  primaryLabel,
}: OffscreenComparePanesProps) {
  // A private sync group, unrelated to the page-wide "Sync 3D views" group —
  // the two mirror viewers + the interaction controller all share this one
  // camera while compare mode is active, independent of whether the card's
  // own panes join page sync.
  const groupId = `compare3d-${useId()}`;
  const sync: Scene3DSyncOptions = { groupId };

  const primary = useOffscreenSnapshot();
  const reference = useOffscreenSnapshot();

  const overlayRef = useRef<HTMLDivElement>(null);
  useCompareCameraController(overlayRef, groupId);

  return (
    <div className="relative h-full w-full">
      <div
        aria-hidden
        style={{ position: "absolute", left: -99999, top: 0, width: 640, height: 480 }}
      >
        {renderPrimary(primary.onFrame, sync)}
      </div>
      <div
        aria-hidden
        style={{ position: "absolute", left: -99999, top: 0, width: 640, height: 480 }}
      >
        {renderReference(reference.onFrame, sync)}
      </div>
      <CompositeMediaPane
        mode={mode}
        imageUrl={primary.dataUrl}
        baselineUrl={reference.dataUrl}
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
          still works while drags elsewhere orbit the shared 3D camera. */}
      <div
        ref={overlayRef}
        className="absolute inset-0 z-10"
        style={{ touchAction: "none", cursor: "grab" }}
      />
    </div>
  );
}

export default OffscreenComparePanes;
