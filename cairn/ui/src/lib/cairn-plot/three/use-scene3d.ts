import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useContainerSize } from "../hooks/use-container-size";
import {
  makeCameraSyncSourceId,
  publishCameraState,
  subscribeCameraState,
  type CameraState,
} from "./camera-sync";
import { poolAcquire, poolRelease, poolTouch } from "./context-pool";

/**
 * How long (ms) a viewer sits idle — no orbit/zoom, no data/color/size
 * change — before its live WebGL context is released and replaced with a
 * cached snapshot `<img>` (WS-3DR2). Short enough that a burst of newly-
 * opened cards frees most of its contexts within ~a second; long enough
 * that a brief pause mid-inspection doesn't cause visible flicker.
 */
const IDLE_PARK_MS = 1200;

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
   * Show a `THREE.AxesHelper` (colored XYZ origin lines) + `THREE.
   * GridHelper`, sized off the current `fitToBounds` bounding radius.
   * `false`/absent (default) — no helpers, byte-identical to pre-WS-3DR2
   * rendering. Purely visual chrome; never affects the caller's own scene
   * content or the `onFrame` snapshot contract's *meaning* (a snapshot with
   * axes on just has axes baked into its pixels, same as any other visual
   * setting).
   */
  showAxes?: boolean;
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
  /** Render exactly once. On-demand only — call after any scene mutation.
   *  Transparently re-acquires a live WebGL context first if this viewer is
   *  currently parked (WS-3DR2) — callers never need to check/handle park
   *  state themselves. */
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
   *
   * `refs.renderer.current` becomes `null` whenever this viewer parks
   * (WS-3DR2) and is repopulated on the next `requestRender()` — consumers
   * that only touch `refs.scene`/`refs.camera`/`refs.controls` (every
   * existing renderer: Mesh/Boxes/Volume/PointCloud) are unaffected, since
   * those three persist for the component's whole lifetime regardless of
   * park state.
   */
  refs: {
    renderer: RefObject<THREE.WebGLRenderer | null>;
    scene: RefObject<THREE.Scene | null>;
    camera: RefObject<THREE.PerspectiveCamera | null>;
    controls: RefObject<OrbitControls | null>;
  };
  /**
   * The cached snapshot (`canvas.toDataURL()`) captured the moment this
   * viewer last parked, or `null` while live (never parked yet, or just
   * re-acquired). Consumers render this as a plain `<img>` OVER the
   * `<canvas>` (see e.g. `PointCloudViewer`) while parked — the canvas
   * itself goes visually blank once its context is released, so it must
   * stay covered. The `<img>` uses `pointer-events: none` so orbit/zoom
   * gestures still land on the canvas underneath (whose `OrbitControls`
   * listeners are what trigger re-acquisition — see the "start" listener
   * below), giving continuous, un-dropped drag gestures even across a
   * park→re-acquire transition.
   */
  cachedImageUrl: string | null;
}

/**
 * Reusable three.js scene lifecycle: `WebGLRenderer` + `Scene` +
 * `PerspectiveCamera` + `OrbitControls`, container-resize via
 * `useContainerSize`, on-demand rendering (no persistent rAF loop), full
 * disposal + `forceContextLoss` on unmount, dblclick-to-refit, background
 * color handling, an opt-in live camera-sync group, an opt-in axes/grid
 * helper, and — WS-3DR2 — bounded-pool context caching: this viewer parks
 * (snapshots to a cached image, releases its WebGL context) after a short
 * idle period and transparently re-acquires a fresh context on the next
 * interaction/render request, keeping the browser's total live-WebGL-context
 * count bounded regardless of how many 3D cards/panes are open. See
 * `context-pool.ts` for the pool's own doc comment and the WS-3DR2 report
 * (`docs/superpowers/sdd/ws-3DR2-report.md`) for the full design rationale.
 *
 * This is a behavior-preserving extraction of `PointCloudViewer`'s inline
 * scene lifecycle — every future 3D renderer (mesh/boxes/volume) should
 * build on this hook rather than re-implementing it. Callers own their own
 * scene *content* (geometry/material/mesh): add it to `refs.scene.current`
 * in their own effect and dispose it in their own cleanup.
 */
export function useScene3D(options: UseScene3DOptions): Scene3DHandle {
  const { background, fov = 50, near = 0.01, far = 1000, sync = null, showAxes = false, onFrame } = options;

  const { ref: containerRef, size } = useContainerSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);

  const boundsRef = useRef<Scene3DBounds | null>(null);
  const applyingRemoteRef = useRef(false);
  const syncRef = useRef<Scene3DSyncOptions | null>(sync);
  const showAxesRef = useRef(showAxes);
  const onFrameRef = useRef<((canvas: HTMLCanvasElement) => void) | undefined>(onFrame);
  const sourceIdRef = useRef<string>();
  if (!sourceIdRef.current) sourceIdRef.current = makeCameraSyncSourceId();

  // ── WS-3DR2: park/re-acquire bookkeeping ────────────────────────────────
  // `parkedRef` is the source of truth (checked synchronously from
  // `requestRender`); `cachedImageUrl` state exists only so consumers can
  // render the cached `<img>` overlay declaratively.
  const parkedRef = useRef(false);
  const isInteractingRef = useRef(false);
  const idleTimerRef = useRef<number | null>(null);
  // Last-known size/background, so a fresh renderer created by `acquireRenderer`
  // (which may happen well after the size/background effects last ran, if this
  // viewer was parked at the time) can apply the CURRENT values immediately
  // instead of whatever stale defaults `new THREE.WebGLRenderer()` starts with.
  const sizeRef = useRef(size);
  const backgroundRef = useRef(background);
  const [cachedImageUrl, setCachedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const disposeRenderer = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.dispose();
    r.forceContextLoss();
    rendererRef.current = null;
  }, []);

  /**
   * Snapshots the current frame to `cachedImageUrl` and releases this
   * viewer's WebGL context. Idempotent (safe to call when already parked, or
   * called by the pool as an eviction callback on an instance that races
   * with its own idle timer). This IS the pool's per-entry `park` callback
   * (registered in `acquireRenderer` below), so pool-driven eviction and
   * this instance's own idle-timeout path are the exact same code.
   */
  const park = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;
    try {
      setCachedImageUrl(r.domElement.toDataURL("image/png"));
    } catch {
      // Tainted/unreadable canvas (shouldn't happen — same-origin app) —
      // release the context anyway rather than pinning it live forever;
      // the consumer just shows a blank canvas until the next re-acquire.
    }
    disposeRenderer();
    parkedRef.current = true;
    poolRelease(sourceIdRef.current!);
    clearIdleTimer();
  }, [disposeRenderer, clearIdleTimer]);

  const scheduleIdlePark = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      if (!isInteractingRef.current) park();
    }, IDLE_PARK_MS);
  }, [clearIdleTimer, park]);

  /** Removes+disposes any existing axes/grid helpers, then (if `showAxes`)
   *  recreates them sized off the current `boundsRef` (or a radius-1
   *  fallback before the first `fitToBounds`). Called on every `fitToBounds`
   *  (new data → new size) and whenever `showAxes` toggles. */
  const updateAxesHelpers = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (axesHelperRef.current) {
      scene.remove(axesHelperRef.current);
      axesHelperRef.current.geometry.dispose();
      (axesHelperRef.current.material as THREE.Material).dispose();
      axesHelperRef.current = null;
    }
    if (gridHelperRef.current) {
      scene.remove(gridHelperRef.current);
      gridHelperRef.current.geometry.dispose();
      (gridHelperRef.current.material as THREE.Material).dispose();
      gridHelperRef.current = null;
    }
    if (!showAxesRef.current) return;
    const bounds = boundsRef.current;
    const radius = bounds
      ? Math.max(
          new THREE.Vector3(...bounds.max).sub(new THREE.Vector3(...bounds.min)).length() * 0.5,
          1e-3,
        )
      : 1;
    const axes = new THREE.AxesHelper(radius * 1.2);
    scene.add(axes);
    axesHelperRef.current = axes;
    const grid = new THREE.GridHelper(radius * 2, 10);
    scene.add(grid);
    gridHelperRef.current = grid;
  }, []);

  /** Creates a fresh `WebGLRenderer` bound to the (persistent) canvas if one
   *  isn't already live, applying the last-known size/background, and
   *  registers with the pool. No-op (besides an LRU touch) if already live. */
  const acquireRenderer = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (rendererRef.current) {
      poolTouch(sourceIdRef.current!);
      return;
    }
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(backgroundRef.current, 1);
    const s = sizeRef.current;
    if (s.w > 0 && s.h > 0) renderer.setSize(s.w, s.h, false);
    rendererRef.current = renderer;
    parkedRef.current = false;
    setCachedImageUrl(null);
    poolAcquire(sourceIdRef.current!, park);
  }, [park]);

  const requestRender = useCallback(() => {
    if (parkedRef.current) acquireRenderer();
    const r = rendererRef.current;
    const s = sceneRef.current;
    const c = cameraRef.current;
    if (r && s && c) {
      r.render(s, c);
      onFrameRef.current?.(r.domElement);
    }
    poolTouch(sourceIdRef.current!);
    scheduleIdlePark();
  }, [acquireRenderer, scheduleIdlePark]);

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
      updateAxesHelpers();
      requestRender();
    },
    [requestRender, updateAxesHelpers],
  );

  // ── Mount: scene + camera + controls (persistent) + initial live renderer
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    // WS-3DR2: the FIRST touch of an interaction (pointerdown-drag-start or
    // wheel — three.js's OrbitControls dispatches "start" synchronously
    // around both) is the "ensure a live context" trigger from the Phase-0
    // design: if this viewer is currently parked (cached-image-only), wake
    // it immediately so the very first drag delta already has a live canvas
    // to orbit, rather than waiting for the first "change". `requestRender`
    // reschedules the idle timer too, so simply calling it here is enough;
    // "end" flips `isInteractingRef` back off and restarts the idle
    // countdown for real.
    const onStart = () => {
      isInteractingRef.current = true;
      requestRender();
    };
    const onEnd = () => {
      isInteractingRef.current = false;
      scheduleIdlePark();
    };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

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
    // WS-3DR2 note: this recovery path is kept as-is, UNCHANGED, as a safety
    // net for context loss the app did NOT itself request (e.g. driven by
    // some other tab/page, or a genuine GPU-driver-level eviction that slips
    // past the new bounded pool below) — `park()`'s own DELIBERATE
    // `forceContextLoss()` is handled by the normal re-acquire path
    // (`requestRender` → `acquireRenderer`, a brand new `WebGLRenderer`
    // instance), not by this listener; this listener only matters for
    // UNEXPECTED loss of a context this hook still believes is live.
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

    // Initial live render — every viewer starts live (not parked); it parks
    // itself on its own idle timer shortly after its first (fitted) render
    // if nothing interacts with it, and the pool additionally caps how many
    // simultaneously-mounting viewers can stay live at once (see
    // `context-pool.ts`).
    acquireRenderer();

    return () => {
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      clearIdleTimer();
      poolRelease(sourceIdRef.current!);
      disposeRenderer();
      if (axesHelperRef.current) {
        axesHelperRef.current.geometry.dispose();
        (axesHelperRef.current.material as THREE.Material).dispose();
        axesHelperRef.current = null;
      }
      if (gridHelperRef.current) {
        gridHelperRef.current.geometry.dispose();
        (gridHelperRef.current.material as THREE.Material).dispose();
        gridHelperRef.current = null;
      }
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
      // `controls.update()` dispatches "change" itself when the transform
      // actually moved, which runs `onChange` → `requestRender()` above —
      // that render call transparently re-acquires this viewer's context
      // first if it was parked, so a remote camera-sync update always wakes
      // a static/cached pane to reflect the new camera (WS-3DR2 design
      // point: "a camera change in the group → the parked pane re-acquires/
      // re-renders").
      controls.update();
      applyingRemoteRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.groupId]);

  // ── Axes/grid toggle ─────────────────────────────────────────────────────
  useEffect(() => {
    showAxesRef.current = showAxes;
    updateAxesHelpers();
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAxes]);

  // ── Background ─────────────────────────────────────────────────────────
  useEffect(() => {
    backgroundRef.current = background;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setClearColor(background, 1);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background]);

  // ── Resize ─────────────────────────────────────────────────────────────
  useEffect(() => {
    sizeRef.current = size;
    const camera = cameraRef.current;
    if (camera && size.w > 0 && size.h > 0) {
      camera.aspect = size.w / size.h;
      camera.updateProjectionMatrix();
    }
    const renderer = rendererRef.current;
    if (!renderer || size.w === 0 || size.h === 0) return;
    renderer.setSize(size.w, size.h, false);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  return {
    containerRef,
    canvasRef,
    requestRender,
    fitToBounds,
    refs: { renderer: rendererRef, scene: sceneRef, camera: cameraRef, controls: controlsRef },
    cachedImageUrl,
  };
}

/**
 * Reset every Scene3D viewer nested under `container` to its fitted view.
 * Reuses the dblclick-to-refit path each viewer already wires up above
 * (`canvas.addEventListener("dblclick", ...)`) by dispatching a synthetic
 * dblclick at each `<canvas>` — so a card's header "reset view" button
 * doesn't need its own camera-framing logic or a ref into each viewer, and
 * works uniformly across single-view and multi-pane (compare) layouts.
 *
 * Works whether or not the target canvas is currently parked (WS-3DR2):
 * `dispatchEvent` invokes listeners directly regardless of the canvas's
 * paint/hit-testing visibility, and the `dblclick` handler's `fitToBounds` →
 * `requestRender` call transparently re-acquires a live context first.
 */
export function resetScene3DViews(container: HTMLElement | null): void {
  if (!container) return;
  for (const canvas of container.querySelectorAll("canvas")) {
    canvas.dispatchEvent(new Event("dblclick", { bubbles: true }));
  }
}
