import { useCallback, useEffect, useId, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useContainerSize } from "../hooks/use-container-size";
import {
  makeCameraSyncSourceId,
  publishCameraState,
  subscribeCameraState,
  type CameraState,
} from "./camera-sync";

export interface Scene3DBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Scene3DSyncOptions {
  /** Viewers sharing a `groupId` mirror each other's orbit/zoom/pan live. */
  groupId: string;
}

/**
 * Resolves the sync group a "side" mode's reference+foreground pair of live
 * viewers should share (WS-VCP fix 3).
 *
 * `sync` is the card-level group (non-null only when the card's "Sync 3D
 * views" toggle is on) — when present, every pane on the card/page shares
 * it, so the ref+run pair is already linked (and linked to every OTHER
 * pane too, by design). When `sync` is `null` (card-level sync off), the
 * ref+run pair must still always mirror each other (only DIFFERENT
 * comparison pairs stay independent) — so this falls back to a group id
 * derived from `useId()`, unique per `*SideBySideView` mount, shared by
 * that one call's two viewers and no one else's.
 *
 * Call once per `*SideBySideView` component (not per viewer) and pass the
 * result to BOTH the reference and foreground viewer's `sync` prop.
 */
export function usePairedSideBySideSync(sync: Scene3DSyncOptions | null): Scene3DSyncOptions {
  const localId = useId();
  return sync ?? { groupId: `side-pair-${localId}` };
}

export interface UseScene3DOptions {
  /** WebGLRenderer clear color, as a THREE-style hex integer (e.g. `0x0d1117`). */
  background: number;
  /** Camera vertical field of view, degrees. Default 50 (pointcloud viewer default). */
  fov?: number;
  /** Camera near plane. Default 0.01 (pointcloud viewer default); tightened by `fitToBounds`. */
  near?: number;
  /** Camera far plane. Default 1000 (pointcloud viewer default); loosened by `fitToBounds`. */
  far?: number;
  /** Opt-in live camera sync group. `null`/absent disables sync (default). */
  sync?: Scene3DSyncOptions | null;
  /**
   * Called with the live `<canvas>` element after every `requestRender()`
   * (including camera-sync-driven re-renders). Opt-in — absent by default,
   * zero overhead when unused. This is how 3D cards feed the media-compare
   * compositor for image-space split/blend/pixel-diff modes: snapshot this
   * canvas (`canvas.toDataURL()`) rather than each viewer re-implementing
   * render-to-image itself (spec-visual-compare.md WS-VC2 — reuse
   * `use-scene3d` machinery, don't fork it).
   */
  onFrame?: (canvas: HTMLCanvasElement) => void;
}

export interface Scene3DHandle {
  /** Attach to the pane's wrapper `<div>` — sized via ResizeObserver (`useContainerSize`). */
  containerRef: RefObject<HTMLDivElement>;
  /** Attach to the `<canvas>` the renderer draws into. */
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Render exactly once. On-demand only — call after any scene mutation. */
  requestRender: () => void;
  /**
   * Fits the camera to `bounds`: bounding-sphere framing along the
   * `(1, 0.75, 1)` direction (matches the original pointcloud viewer), and
   * remembers `bounds` so a dblclick on the canvas re-fits without the
   * caller having to re-supply them.
   */
  fitToBounds: (bounds: Scene3DBounds) => void;
  /**
   * Live three.js handles for renderers to add/remove/dispose their own
   * scene content. Populated once the mount effect runs (same commit as the
   * first render, before any consumer effect that runs after this hook's
   * call in the same component — see `PointCloudViewer` for the pattern).
   */
  refs: {
    renderer: RefObject<THREE.WebGLRenderer | null>;
    scene: RefObject<THREE.Scene | null>;
    camera: RefObject<THREE.PerspectiveCamera | null>;
    controls: RefObject<OrbitControls | null>;
  };
}

/**
 * Reusable three.js scene lifecycle: `WebGLRenderer` + `Scene` +
 * `PerspectiveCamera` + `OrbitControls`, container-resize via
 * `useContainerSize`, on-demand rendering (no persistent rAF loop), full
 * disposal + `forceContextLoss` on unmount, dblclick-to-refit, background
 * color handling, and an opt-in live camera-sync group.
 *
 * This is a behavior-preserving extraction of `PointCloudViewer`'s inline
 * scene lifecycle — every future 3D renderer (mesh/boxes/volume) should
 * build on this hook rather than re-implementing it. Callers own their own
 * scene *content* (geometry/material/mesh): add it to `refs.scene.current`
 * in their own effect and dispose it in their own cleanup.
 */
export function useScene3D(options: UseScene3DOptions): Scene3DHandle {
  const { background, fov = 50, near = 0.01, far = 1000, sync = null, onFrame } = options;

  const { ref: containerRef, size } = useContainerSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const boundsRef = useRef<Scene3DBounds | null>(null);
  const applyingRemoteRef = useRef(false);
  const syncRef = useRef<Scene3DSyncOptions | null>(sync);
  const onFrameRef = useRef<((canvas: HTMLCanvasElement) => void) | undefined>(onFrame);
  const sourceIdRef = useRef<string>();
  if (!sourceIdRef.current) sourceIdRef.current = makeCameraSyncSourceId();

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const requestRender = useCallback(() => {
    const r = rendererRef.current;
    const s = sceneRef.current;
    const c = cameraRef.current;
    if (r && s && c) {
      r.render(s, c);
      onFrameRef.current?.(r.domElement);
    }
  }, []);

  const fitToBounds = useCallback(
    (bounds: Scene3DBounds) => {
      boundsRef.current = bounds;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) return;
      const min = new THREE.Vector3(...bounds.min);
      const max = new THREE.Vector3(...bounds.max);
      const center = min.clone().add(max).multiplyScalar(0.5);
      const radius = Math.max(max.clone().sub(min).length() * 0.5, 1e-3);
      const fovRad = (camera.fov * Math.PI) / 180;
      const dist = (radius / Math.sin(fovRad / 2)) * 1.15;
      camera.near = Math.max(dist / 1000, 1e-4);
      camera.far = dist * 10 + radius * 10;
      camera.up.set(0, 1, 0);
      camera.position
        .copy(center)
        .add(new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(dist));
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
      requestRender();
    },
    [requestRender],
  );

  // ── Mount: renderer + scene + camera + controls (once) ─────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(background, 1);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controlsRef.current = controls;

    const onChange = () => {
      requestRender();
      const activeSync = syncRef.current;
      if (activeSync && !applyingRemoteRef.current) {
        publishCameraState(activeSync.groupId, sourceIdRef.current!, {
          position: camera.position.toArray() as [number, number, number],
          target: controls.target.toArray() as [number, number, number],
          zoom: camera.zoom,
        });
      }
    };
    controls.addEventListener("change", onChange);

    const onDblClick = () => {
      if (boundsRef.current) fitToBounds(boundsRef.current);
    };
    canvas.addEventListener("dblclick", onDblClick);

    // BUG FIX (odd/even-pane "stuck loading" regression): a page with
    // several 3D panes/cards open at once — especially compare modes
    // (split/blend/diff/side), which each mount TWO live hidden viewers via
    // `OffscreenComparePanes` — can exceed the browser's WebGL context
    // budget. When that happens the browser force-loses the
    // least-recently-used context(s) (observable as "THREE.WebGLRenderer:
    // Context Lost." in the console), which — because of creation/render
    // ORDER across panes — tends to hit a consistent relative position among
    // a batch of newly-created contexts (reported by users as "every other
    // pane"/"odd indices", though it's a resource-exhaustion artifact, not a
    // literal index-parity bug in this app's pane-mapping code).
    //
    // `THREE.WebGLRenderer` already calls `event.preventDefault()` in its own
    // internal `webglcontextlost` handler (see three.js's WebGLRenderer
    // source) and re-initializes its GL state in `webglcontextrestored` — so
    // the browser DOES restore the context automatically. But three.js's
    // restore handler only resets internal state; it never re-renders, and
    // this hook is deliberately on-demand-only (no persistent rAF loop, see
    // the header comment). With no app-level `webglcontextrestored`
    // listener anywhere in this codebase, NOTHING ever calls
    // `requestRender()` again after a restore — so a lost-then-restored
    // canvas stays blank forever, `onFrame` never fires again, and the pane
    // (or its offscreen split/blend/diff snapshot) is stuck on its last
    // state ("loading…"/"no image"/"computing diff…") permanently, even
    // though the underlying WebGL context is technically alive again.
    //
    // Fix: request one fresh render the moment the context comes back, so
    // the canvas (and any `onFrame` snapshot consumer) recovers on its own
    // instead of hanging forever. `preventDefault` here is redundant with
    // three.js's own handler but kept explicit/defensive (harmless either
    // way, and this hook shouldn't rely on an internal three.js detail).
    const onContextLost = (event: Event) => {
      event.preventDefault();
    };
    const onContextRestored = () => {
      requestRender();
    };
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);

    return () => {
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
    // Renderer/scene/camera/controls are created once; `background`/`fov`/
    // `near`/`far` are applied via dedicated effects below so toggling
    // `sync` (see next effect) never tears down the WebGL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keep the "change" handler's view of `sync` current ──────────────────
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  // ── Camera-sync subscription (independent of the renderer lifecycle) ───
  useEffect(() => {
    if (!sync) return;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    return subscribeCameraState(sync.groupId, sourceIdRef.current!, (state: CameraState) => {
      applyingRemoteRef.current = true;
      camera.position.fromArray(state.position);
      controls.target.fromArray(state.target);
      camera.zoom = state.zoom;
      camera.updateProjectionMatrix();
      controls.update();
      applyingRemoteRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.groupId]);

  // ── Background ─────────────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setClearColor(background, 1);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background]);

  // ── Resize ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    if (!renderer || !camera || size.w === 0 || size.h === 0) return;
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  return {
    containerRef,
    canvasRef,
    requestRender,
    fitToBounds,
    refs: { renderer: rendererRef, scene: sceneRef, camera: cameraRef, controls: controlsRef },
  };
}

/**
 * Reset every Scene3D viewer nested under `container` to its fitted view.
 * Reuses the dblclick-to-refit path each viewer already wires up above
 * (`canvas.addEventListener("dblclick", ...)`) by dispatching a synthetic
 * dblclick at each `<canvas>` — so a card's header "reset view" button
 * doesn't need its own camera-framing logic or a ref into each viewer, and
 * works uniformly across single-view and multi-pane (compare) layouts.
 */
export function resetScene3DViews(container: HTMLElement | null): void {
  if (!container) return;
  for (const canvas of container.querySelectorAll("canvas")) {
    canvas.dispatchEvent(new Event("dblclick", { bubbles: true }));
  }
}
