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

/**
 * WS-3DR2 frowny-face guard: is `url` a real, decodable PNG data URL (as
 * opposed to a degenerate readback)?
 *
 * `HTMLCanvasElement.toDataURL()` off a blank / just-released WebGL context can
 * return the empty sentinel `"data:,"` or a 0-pixel PNG whose base64 payload is
 * only a handful of bytes. Committed to `cachedImageUrl` and rendered as an
 * `<img src>` OVER the (correctly rendering) live canvas, either produces the
 * browser's broken-image "frowny face" icon painted on top of a working view.
 * A genuine PNG capture of a real viewport is many kilobytes, so a
 * `"data:image/"` prefix plus a generous minimum length reliably separates the
 * two. Kept intentionally loose (>100 chars) — well below any real capture,
 * well above every degenerate one — so it never rejects a legitimate frame.
 */
export function isValidPngDataUrl(url: string | null | undefined): url is string {
  return (
    typeof url === "string" &&
    url !== "data:," &&
    url.startsWith("data:image/") &&
    url.length > 100
  );
}

export interface Scene3DBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Scene3DSyncOptions {
  /** Viewers sharing a `groupId` mirror each other's orbit/zoom/pan live. */
  groupId: string;
}

/**
 * Camera orientation mode (#69 S1).
 *
 * - `"orbital"` (default) — free orbit: the full `OrbitControls` polar range
 *   (`0 … π`), so the camera can swing directly over either pole and view the
 *   model from straight above/below. Byte-identical to pre-#69 behavior.
 * - `"turntable"` — the conventional "record turntable" feel: horizontal drag
 *   spins the model about world-up (azimuth), vertical drag tilts elevation,
 *   and the up-vector stays locked (`camera.up=(0,1,0)`, which OrbitControls
 *   already enforces — the horizon never rolls in EITHER mode). What turntable
 *   adds on top is a small polar-angle margin at each pole so the camera can
 *   never reach or cross straight-up/straight-down, preventing the disorienting
 *   "flip over the top" tumble that free orbit allows.
 */
export type Scene3DCameraMode = "orbital" | "turntable";

/** Polar-angle margin (radians) kept from each pole in `"turntable"` mode, so
 *  the camera stops just shy of straight-up / straight-down and never flips
 *  over the pole. Small enough to still reach a near-top/near-bottom view. */
const TURNTABLE_POLE_MARGIN = 0.05;

/** Applies a `Scene3DCameraMode` to a live `OrbitControls`: turntable clamps
 *  the polar range away from both poles; orbital restores the full free-orbit
 *  range. Shared by the mode effect and any future caller. */
function applyCameraMode(controls: OrbitControls, mode: Scene3DCameraMode): void {
  if (mode === "turntable") {
    controls.minPolarAngle = TURNTABLE_POLE_MARGIN;
    controls.maxPolarAngle = Math.PI - TURNTABLE_POLE_MARGIN;
  } else {
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
  }
  controls.update();
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
  /** WebGLRenderer clear color, as a THREE-style hex integer (e.g. `0x0d1117`).
   *  Only actually painted when `opaqueBackground` is true — the DEFAULT is a
   *  TRANSPARENT clear (Q4), so 3D panes inherit whatever page/HTML background
   *  sits behind their `<canvas>` rather than a fixed fill. */
  background: number;
  /**
   * Q4 — solid-background opt-in. `false`/absent (DEFAULT) → the renderer
   * clears with alpha 0 (fully transparent), so the pane shows the page/HTML
   * background through every empty region (verified light + dark). `true` →
   * clear with `background` at full opacity, restoring the pre-Q4 solid fill
   * for callers that explicitly want an opaque backdrop. The renderer is
   * always created with `alpha: true` so this can toggle at runtime without
   * recreating the WebGL context. */
  opaqueBackground?: boolean;
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
   * Show three semi-transparent XY / YZ / XZ reference planes through the
   * origin (#69 S2), sized off the current `fitToBounds` bounding radius and
   * tinted toward each plane's normal axis (YZ=red, XZ=green, XY=blue). `false`/
   * absent (default) — no planes, byte-identical to pre-#69 rendering. Purely
   * visual chrome; plumbed exactly like `showAxes` (see its docstring).
   */
  showPlanes?: boolean;
  /**
   * Camera orientation mode (#69 S1). `"orbital"` (default) = free orbit;
   * `"turntable"` = up-locked spin with a pole margin. See `Scene3DCameraMode`.
   */
  cameraMode?: Scene3DCameraMode;
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
   * `refs.renderer.current` is the SAME `WebGLRenderer` instance for this
   * viewer's whole lifetime (created once at mount, disposed only on
   * unmount) — WS-3DR2's park/re-acquire cycle toggles the underlying WebGL
   * CONTEXT's lost/restored state via the `WEBGL_lose_context` extension
   * rather than destroying/recreating the renderer object (constructing a
   * second `WebGLRenderer` on a canvas whose context is still mid-restore
   * crashes inside three.js's capability probing — `getContext()` on an
   * already-bound canvas returns the SAME, still-lost context, not a fresh
   * one). `refs.scene`/`refs.camera`/`refs.controls` likewise persist
   * unconditionally.
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
  /**
   * Q10 — whether this viewport is currently ACTIVATED for wheel-zoom. Wheel
   * over an inactive pane does NOTHING (the page scrolls normally); the user
   * clicks the pane to activate it (then the wheel zooms via OrbitControls),
   * and clicking OR scrolling anywhere outside it de-activates. `Scene3DCanvas`
   * reads this to paint a very subtle 1px active-state border. Orbit/pan drag
   * are unaffected by this flag — only `OrbitControls.enableZoom` is gated. */
  active: boolean;
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
  const {
    background,
    fov = 50,
    near = 0.01,
    far = 1000,
    sync = null,
    showAxes = false,
    showPlanes = false,
    cameraMode = "orbital",
    opaqueBackground = false,
    onFrame,
  } = options;

  const { ref: containerRef, size } = useContainerSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const axesHelperRef = useRef<THREE.AxesHelper | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const planesRef = useRef<THREE.Mesh[]>([]);

  const boundsRef = useRef<Scene3DBounds | null>(null);
  const applyingRemoteRef = useRef(false);
  const syncRef = useRef<Scene3DSyncOptions | null>(sync);
  const showAxesRef = useRef(showAxes);
  const showPlanesRef = useRef(showPlanes);
  const cameraModeRef = useRef(cameraMode);
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
  // Q4: mirrors `opaqueBackground` so the mount effect / clear-color effect can
  // read the CURRENT value synchronously (default false → transparent clear).
  const opaqueBackgroundRef = useRef(opaqueBackground);
  const [cachedImageUrl, setCachedImageUrl] = useState<string | null>(null);
  // Mirrors `cachedImageUrl` synchronously (state updates aren't visible
  // until next render, but `park()` needs to know RIGHT NOW whether a prior
  // successful capture exists — see the blank-pane fix below).
  const cachedImageUrlRef = useRef<string | null>(null);
  /** WS-3DR2 blank-pane fix: true once this viewer has completed its first
   *  CONTENT-bearing render — i.e. `fitToBounds` has run at least once,
   *  meaning real geometry/bounds (not just the mount effect's empty
   *  scene) have been drawn. `park()` refuses to actually release the
   *  context until this is true: without the guard, the mount effect's own
   *  resize-triggered `requestRender()` draws (and starts the idle-park
   *  clock off of) an EMPTY scene well before slower-to-load data finishes,
   *  so a burst of many simultaneous panes — or just an unlucky idle timer
   *  — could park/get pool-evicted with nothing but a blank clear-color
   *  frame ever captured, leaving the pane visibly blank until the user
   *  interacts with it. */
  const hasRenderedContentRef = useRef(false);
  /** The `WEBGL_lose_context` extension for this viewer's one-and-only
   *  renderer, grabbed once at creation. `null` in the (essentially
   *  theoretical, per the WebGL spec every conformant implementation
   *  exposes it) case a browser doesn't support it — park()/acquireRenderer()
   *  degrade to a no-op in that case (the viewer just never parks, rather
   *  than crashing). */
  const loseContextExtRef = useRef<{ loseContext: () => void; restoreContext: () => void } | null>(null);

  // ── Q10: click-to-activate scroll-zoom ──────────────────────────────────
  // `active` (state) drives the subtle 1px border in `Scene3DCanvas`;
  // `activeRef` mirrors it synchronously for the DOM listeners below.
  // OrbitControls' wheel-zoom (`enableZoom`) is gated on this: inactive → the
  // wheel does nothing (OrbitControls returns before `preventDefault`, so the
  // page scrolls normally); active → the wheel zooms. Orbit/pan drag are never
  // gated.
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);

  // ── Q17: home camera pose ────────────────────────────────────────────────
  // Captured once at mount (initial pose). A dblclick re-fits to the current
  // bounds when known (the fit-to-content helper), else restores this pose.
  const homePoseRef = useRef<{
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
  } | null>(null);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  /** Q10: flips the active state, keeping `activeRef` and
   *  `OrbitControls.enableZoom` in lockstep. No-op when already in `next`. */
  const setActiveState = useCallback((next: boolean) => {
    if (activeRef.current === next) return;
    activeRef.current = next;
    setActive(next);
    const controls = controlsRef.current;
    if (controls) controls.enableZoom = next;
  }, []);

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
   * viewer's WebGL context via `WEBGL_lose_context.loseContext()` — NOT
   * `renderer.dispose()+forceContextLoss()` (that combination is reserved
   * for final unmount teardown; see `disposeRenderer`). The renderer OBJECT
   * survives; only its GPU-side context goes away, freeing the browser's
   * live-context budget while leaving a path back via `restoreContext()`
   * (see `acquireRenderer`). Idempotent (safe to call when already parked,
   * or called by the pool as an eviction callback on an instance that races
   * with its own idle timer). This IS the pool's per-entry `park` callback
   * (registered in `acquireRenderer` below), so pool-driven eviction and
   * this instance's own idle-timeout path are the exact same code.
   *
   * Re-renders ONE more time, synchronously, immediately before reading the
   * canvas back — WITHOUT `preserveDrawingBuffer` (deliberately not set,
   * see the mount effect: keeping it off is what makes parking actually
   * cheap for many simultaneous contexts), the browser is free to clear a
   * WebGL drawing buffer any time after compositing a frame to the screen,
   * which — since `park()` can fire up to `IDLE_PARK_MS` after the LAST
   * real render — had already happened by the time this ran, making
   * `toDataURL()` capture a blank/transparent canvas (caught in browser
   * self-verify: the cached `<img>` decoded fine per `naturalWidth`/
   * `complete`, but every pixel read back via a canvas 2D context was
   * `[0,0,0,0]`). A render()-then-read in the SAME synchronous tick is the
   * standard safe pattern (no async gap for the browser to clear anything
   * in between) — cheap here since it only runs once per park (a rare,
   * discrete event), not per frame.
   */
  const park = useCallback((): void => {
    const r = rendererRef.current;
    if (!r || parkedRef.current) return;
    // WS-3DR2 fix round 2 (blank-pane-on-load): never let this callback —
    // it's BOTH the pool's per-entry eviction callback and this instance's
    // own idle-timer callback, the exact same code path either way — leave
    // the pane parked with NOTHING real to show. `hasRenderedContentRef`
    // guards the first of two ways that used to happen: if real content
    // (`fitToBounds`) hasn't rendered yet, defer instead of parking an
    // empty/clear-color frame. Re-`poolAcquire` here because, when this is
    // running AS the pool's eviction callback, `context-pool.ts` already
    // removed us from its live-set before calling us — without this we'd
    // silently fall out of the pool's bookkeeping forever (never eligible
    // for eviction again, even once we DO have real content).
    if (!hasRenderedContentRef.current) {
      poolAcquire(sourceIdRef.current!, park);
      return;
    }
    // WS-3DR2 fix round: only attempt the render+capture if the GL context
    // is actually usable right now. This can be called (as the pool's
    // eviction callback, or via this instance's own idle timer) while the
    // context is lost/mid-restore — e.g. a sync-storm re-acquire raced with
    // eviction, or the browser hasn't dispatched `webglcontextrestored` yet
    // after our own `restoreContext()` call. Rendering/reading back a
    // lost context produces a BLANK frame (three.js silently skips
    // rendering, and `toDataURL()` reads back all-zero pixels — see the
    // longer note above), so previously this could stomp a perfectly good
    // cached image with a blank one. Skipping the capture here and keeping
    // whatever `cachedImageUrl` is already set is strictly better: worst
    // case the pane shows a slightly-stale-but-real frame instead of a
    // blank one — UNLESS there's no earlier cached image either (this
    // would be this viewer's first-ever successful capture racing with a
    // lost/mid-restore context): in that case parking now would leave
    // `cachedImageUrl` null while `parkedRef` flips true, i.e. exactly the
    // blank-pane bug. Guard round 2: defer instead of parking blind (same
    // re-`poolAcquire` reasoning as above), and let the persistent
    // `onContextRestored` listener's `requestRender()` (mount effect,
    // below) resume the normal idle-park cycle once the context actually
    // comes back.
    const gl = r.getContext();
    let captured = false;
    if (!gl.isContextLost()) {
      const s = sceneRef.current;
      const c = cameraRef.current;
      if (s && c) r.render(s, c);
      try {
        // WS-3DR2 frowny-face guard: even with a non-lost context and a
        // render() in the same tick, `toDataURL()` can hand back a degenerate
        // url ("data:," or a 0-pixel PNG) — e.g. mid-restore, or a drawing
        // buffer the browser cleared post-composite. Committing that would
        // OVERWRITE a perfectly good cached image with one that renders as the
        // broken-image frowny face. Only commit a valid PNG data url; a
        // degenerate readback is treated as "not captured" (captured stays
        // false), keeping whatever previous good url is already set.
        const url = r.domElement.toDataURL("image/png");
        if (isValidPngDataUrl(url)) {
          setCachedImageUrl(url);
          cachedImageUrlRef.current = url;
          captured = true;
        }
      } catch {
        // Tainted/unreadable canvas (shouldn't happen — same-origin app) —
        // fall through to the "already have a cached image?" check below,
        // same as a lost-context skip.
      }
    }
    if (!captured && cachedImageUrlRef.current == null) {
      poolAcquire(sourceIdRef.current!, park);
      return;
    }
    loseContextExtRef.current?.loseContext();
    parkedRef.current = true;
    poolRelease(sourceIdRef.current!);
    clearIdleTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearIdleTimer]);

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

  /** Removes+disposes any existing reference planes, then (if `showPlanes`)
   *  recreates the three origin-centered XY / YZ / XZ planes sized off the
   *  current `boundsRef` radius (same radius the axes/grid use). Each is a
   *  double-sided, depth-write-disabled, ~0.06-opacity `MeshBasicMaterial`
   *  tinted toward its NORMAL axis (YZ→red X, XZ→green Y, XY→blue Z), so the
   *  planes read as faint colored "walls/floor" without occluding the data.
   *  Called on every `fitToBounds` (new data → new size) and whenever
   *  `showPlanes` toggles — mirrors `updateAxesHelpers`. */
  const updateReferencePlanes = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    for (const plane of planesRef.current) {
      scene.remove(plane);
      plane.geometry.dispose();
      (plane.material as THREE.Material).dispose();
    }
    planesRef.current = [];
    if (!showPlanesRef.current) return;
    const bounds = boundsRef.current;
    const radius = bounds
      ? Math.max(
          new THREE.Vector3(...bounds.max).sub(new THREE.Vector3(...bounds.min)).length() * 0.5,
          1e-3,
        )
      : 1;
    const size = radius * 2;
    // PlaneGeometry lies in the XY plane (normal +Z) by default. Rotate each
    // copy onto its target plane; tint by the axis it's perpendicular to.
    const specs: Array<{ color: number; rotate: (m: THREE.Mesh) => void }> = [
      // XY plane (normal Z → blue): no rotation.
      { color: 0x3b82f6, rotate: () => {} },
      // XZ plane (normal Y → green): rotate -90° about X.
      { color: 0x22c55e, rotate: (m) => m.rotateX(-Math.PI / 2) },
      // YZ plane (normal X → red): rotate 90° about Y.
      { color: 0xef4444, rotate: (m) => m.rotateY(Math.PI / 2) },
    ];
    for (const spec of specs) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      spec.rotate(mesh);
      scene.add(mesh);
      planesRef.current.push(mesh);
    }
  }, []);

  /**
   * Re-acquires a live WebGL context for this viewer's (one, persistent)
   * renderer if it's currently parked, and registers with the pool. No-op
   * (besides an LRU touch) if already live.
   *
   * Requests an IMMEDIATE, deterministic restore via `WEBGL_lose_context.
   * restoreContext()` rather than waiting on the browser's own auto-restore
   * heuristics (which can take an unpredictable amount of time — fine for
   * the #52 accidental-loss safety net, not for "must feel live while
   * orbiting"). The actual pixels only become live once the browser
   * dispatches `webglcontextrestored` in response (typically near-
   * immediate for an explicit `restoreContext()` call) — the existing
   * `onContextRestored` listener (mount effect, below) is what actually
   * calls `requestRender()` and clears `cachedImageUrl` once that happens;
   * calling `requestRender()` right after this (as `requestRender` itself
   * already does) is a harmless no-op speculative attempt in the meantime
   * (three.js's own `render()` silently skips while its context is still
   * marked lost).
   */
  const acquireRenderer = useCallback(() => {
    if (!parkedRef.current) {
      poolTouch(sourceIdRef.current!);
      return;
    }
    loseContextExtRef.current?.restoreContext();
    parkedRef.current = false;
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
      // WS-3DR2 blank-pane fix: every viewer (Mesh/Boxes/Volume/PointCloud)
      // calls `fitToBounds` exactly once real geometry/bounds are known —
      // the natural "this pane now has actual content" signal. See
      // `hasRenderedContentRef`'s docstring for why `park()` needs this.
      hasRenderedContentRef.current = true;
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
      updateReferencePlanes();
      requestRender();
    },
    [requestRender, updateAxesHelpers, updateReferencePlanes],
  );

  // ── Mount: scene + camera + controls (persistent) + initial live renderer
  // ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Q4: `alpha: true` so the clear can be transparent (the default). The
    // context is created once for the renderer's whole lifetime, so alpha is
    // always enabled and the transparent↔solid choice is made purely via the
    // clear-color alpha below (0 = transparent default, 1 = opt-in solid).
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(backgroundRef.current, opaqueBackgroundRef.current ? 1 : 0);
    const initialSize = sizeRef.current;
    if (initialSize.w > 0 && initialSize.h > 0) renderer.setSize(initialSize.w, initialSize.h, false);
    rendererRef.current = renderer;
    // WS-3DR2: grab the lose/restore-context extension ONCE for this
    // renderer's whole lifetime — every conformant WebGL implementation
    // exposes it (it's not an optional/vendor extension); `null` here just
    // means park()/acquireRenderer() degrade to a no-op (this viewer stays
    // live forever, same as pre-WS-3DR2 behavior) rather than crashing.
    const gl = renderer.getContext();
    loseContextExtRef.current =
      (gl?.getExtension("WEBGL_lose_context") as { loseContext: () => void; restoreContext: () => void } | null) ??
      null;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    // Q10: wheel-zoom starts OFF — the pane is inactive until clicked. With
    // `enableZoom` false, OrbitControls' wheel handler returns before
    // `preventDefault`, so a wheel over the pane scrolls the page normally.
    // Orbit (rotate) + pan stay enabled regardless of active state.
    controls.enableZoom = activeRef.current;
    // #69 S1: apply the initial orientation mode (turntable clamps the polar
    // range; orbital leaves the full range). The dedicated effect below keeps
    // it in sync on later `cameraMode` changes.
    applyCameraMode(controls, cameraModeRef.current);
    controlsRef.current = controls;

    // Q17: remember the initial camera pose so a dblclick can restore it even
    // before any `fitToBounds` has run (once bounds are known, dblclick re-fits
    // instead — see `onDblClick`).
    homePoseRef.current = {
      position: camera.position.toArray() as [number, number, number],
      target: controls.target.toArray() as [number, number, number],
      zoom: camera.zoom,
    };

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

    // Q17: dblclick resets the camera. Prefer the fit-to-content helper
    // (`fitToBounds`) when bounds are known; otherwise restore the initial
    // home pose captured at mount.
    const onDblClick = () => {
      if (boundsRef.current) {
        fitToBounds(boundsRef.current);
        return;
      }
      const home = homePoseRef.current;
      const cam = cameraRef.current;
      const ctl = controlsRef.current;
      if (home && cam && ctl) {
        cam.position.fromArray(home.position);
        ctl.target.fromArray(home.target);
        cam.zoom = home.zoom;
        cam.updateProjectionMatrix();
        ctl.update();
        requestRender();
      }
    };
    canvas.addEventListener("dblclick", onDblClick);

    // ── Q10: click-to-activate / click-or-scroll-outside-to-deactivate ──────
    // A pointerdown INSIDE this pane's container activates it (enabling
    // wheel-zoom); a pointerdown anywhere OUTSIDE de-activates. A wheel event
    // outside also de-activates (so scrolling away from the pane releases it).
    // Both use capture so they see the event regardless of stopPropagation
    // downstream; the wheel listener is passive (it never needs to
    // preventDefault — OrbitControls owns that on the canvas itself).
    const onDocPointerDown = (event: PointerEvent) => {
      const c = containerRef.current;
      if (!c) return;
      setActiveState(c.contains(event.target as Node));
    };
    const onDocWheel = (event: WheelEvent) => {
      const c = containerRef.current;
      if (!c) return;
      if (!c.contains(event.target as Node)) setActiveState(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("wheel", onDocWheel, { capture: true, passive: true });

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
    // WS-3DR2 note: this recovery path is now the SAME code path used for
    // our own deliberate park()/acquireRenderer() cycle too (not a separate
    // mechanism) — `onContextRestored` below fires whenever the browser
    // actually restores the context, whether that restore was requested by
    // `acquireRenderer()`'s `restoreContext()` call or happened on the
    // browser's own initiative after an unexpected loss (e.g. driven by
    // some other tab/page, or a GPU-driver-level eviction that slips past
    // the new bounded pool below) — a single listener correctly handles
    // both, since `parkedRef`/`cachedImageUrl` only reflect OUR bookkeeping
    // and are always safe to reset once the context is confirmed live again.
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
      parkedRef.current = false;
      requestRender();
      setCachedImageUrl(null);
      cachedImageUrlRef.current = null;
    };
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);

    // Every viewer starts live (not parked) — register it with the pool
    // immediately (possibly evicting the least-recently-used entries if a
    // burst of simultaneous mounts pushes past the cap — see
    // `context-pool.ts`). It parks itself on its own idle timer shortly
    // after its first (fitted) render if nothing interacts with it.
    poolAcquire(sourceIdRef.current!, park);

    return () => {
      canvas.removeEventListener("dblclick", onDblClick);
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("wheel", onDocWheel, true);
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      controls.removeEventListener("change", onChange);
      controls.dispose();
      clearIdleTimer();
      poolRelease(sourceIdRef.current!);
      disposeRenderer();
      loseContextExtRef.current = null;
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
      for (const plane of planesRef.current) {
        plane.geometry.dispose();
        (plane.material as THREE.Material).dispose();
      }
      planesRef.current = [];
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

  // ── Reference-planes toggle (#69 S2) ────────────────────────────────────
  useEffect(() => {
    showPlanesRef.current = showPlanes;
    updateReferencePlanes();
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPlanes]);

  // ── Camera orientation mode (#69 S1) ────────────────────────────────────
  useEffect(() => {
    cameraModeRef.current = cameraMode;
    const controls = controlsRef.current;
    if (controls) applyCameraMode(controls, cameraMode);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode]);

  // ── Background (Q4: alpha follows `opaqueBackground`) ────────────────────
  useEffect(() => {
    backgroundRef.current = background;
    opaqueBackgroundRef.current = opaqueBackground;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setClearColor(background, opaqueBackground ? 1 : 0);
    requestRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background, opaqueBackground]);

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
    active,
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
