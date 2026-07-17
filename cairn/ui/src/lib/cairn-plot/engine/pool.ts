/**
 * Many-panes GPU resource pool (Task 6 of the WebGPU engine, Sub-project 1) —
 * `acquirePane(canvas)` / `releasePane(handle)`, consumed by
 * `renderers/GpuImagePane.tsx`.
 *
 * ## Why a pool at all
 * A page can host MANY image panes (a gallery grid, a notebook with dozens of
 * plots). Two backend-specific resource walls make "just create a Device per
 * pane" wrong:
 *
 *   - **WebGPU**: one `GPUDevice` backs MANY `GPUCanvasContext`s just fine
 *     (`engine/device.ts`'s module doc) — so every pane SHARES the ONE
 *     `getSharedDevice()` instance. The per-pane cost here is each pane's own
 *     source texture (`Texture`) — potentially large for HDR float images —
 *     not the device itself.
 *   - **WebGL2**: a WebGL2 context is exclusive to the ONE canvas it was
 *     created from (`engine/webgl2/device.ts`'s module doc) — it cannot be
 *     re-homed. So a WebGL2-backend page needs one `createWebGL2Device()` PER
 *     on-screen pane. Browsers hard-cap the number of LIVE WebGL contexts per
 *     page (commonly ~16), so this is the harder resource wall of the two.
 *
 * Both walls converge on the same policy: cap the number of panes that hold
 * LIVE GPU resources ("swapchains" — a configured `Surface` + its source
 * `Texture`) at `MAX_LIVE_SWAPCHAINS`, tracked as an LRU. A pane that scrolls
 * off-screen is **parked**: its `Surface`/`Texture` are freed (for WebGL2,
 * the entire per-pane `Device`/GL-context is destroyed — that's the actual
 * scarce resource) while the CPU source buffer it was last given via
 * `setSource()` is RETAINED (owned by this pool entry, not by the caller) so
 * a scroll-back-into-view **restore** can re-upload without the caller
 * re-supplying the data. `render()` auto-restores a parked pane (marking it
 * most-recently-used) and — if that pushes the live count over the cap —
 * evicts (parks) the least-recently-used OTHER live pane, PREFERRING an
 * off-screen victim (`PaneHandle.setVisible`/`evictOverCap`) — only reaching
 * into the visible set when every live slot is visible (more visible panes
 * than the cap, the many-panes-gallery case this pool exists for). Critically,
 * `render()`'s auto-restore is unconditional: a pane the LRU parked while it
 * was STILL ON-SCREEN (visible-set eviction) transparently restores on its
 * very next render request (a viewport zoom/pan, an exposure/operator change,
 * the double-click reset, ...) — a re-render never paints into a parked/
 * destroyed GPU context. `GpuImagePane` additionally drives explicit
 * `park()`/`restore()`/`setVisible()` from its own `IntersectionObserver` so
 * off-screen panes free GPU memory promptly instead of only reactively at the
 * next over-cap render, and the pool always knows which live panes are
 * actually on-screen.
 *
 * `Surface` (`engine/types.ts`) exposes no explicit teardown (WebGPU's
 * `GPUCanvasContext` has no public "release the swapchain" call short of
 * `Device.destroy()` — see the RHI's doc notes) — so for the WebGPU-shared
 * case, "parking" frees the (often large) source `Texture` and simply stops
 * rendering to the canvas; re-`createSurface`-ing the SAME canvas on restore
 * is a safe idempotent re-configure (`webgpu/device.ts`'s `createSurface`).
 * For WebGL2, parking destroys the WHOLE per-pane `Device` (real GL-context
 * free — the actual scarce resource on that backend); restore creates a
 * fresh `createWebGL2Device()` and re-adopts the canvas.
 */
import { getSharedDevice } from "./device";
import { createWebGL2Device } from "./webgl2/device";
import { renderImage, type ImageParams } from "./image-engine";
import type { Backend, Device, Surface, Texture, TextureFormat } from "./types";
import { forceEngineFailRequested } from "./test-hooks";

/**
 * Cap on simultaneously-LIVE GPU swapchains (configured `Surface` + source
 * `Texture`) across every pane this pool has acquired. Named per the Task 6
 * brief ("cap live swapchains... make it a named const"). 12 is a sensible
 * default: comfortably under typical browser WebGL2 context caps (~16) while
 * still large enough that a normal viewport of on-screen panes all stay live.
 */
export const MAX_LIVE_SWAPCHAINS = 12;

/** A CPU-side source buffer + the GPU texture layout to upload it as. */
export interface SourceUpload {
  width: number;
  height: number;
  format: TextureFormat;
  data: ArrayBufferView;
}

export interface PaneHandle {
  readonly canvas: HTMLCanvasElement;
  /**
   * The page-wide shared device's backend (`"webgpu"` | `"webgl2"`). Exposed
   * because on-screen ORIENTATION differs by backend: the engine's shaders
   * (`shaders/passthrough.wgsl.ts`'s doc) guarantee `readback` row-order
   * parity, which forces the WebGL2 COMPOSITED canvas to be vertically
   * mirrored (texel row 0 → bottom scanline) while WebGPU displays row 0 at
   * top. A canvas-displaying consumer (`GpuImagePane`) must correct the
   * WebGL2 flip — see its render effect — so it needs to know the backend.
   */
  readonly backend: Backend;
  /** True while this pane's GPU resources are freed (parked). */
  readonly isParked: boolean;
  /**
   * Replace the CPU source buffer. Retained by the pool so `park()`/restore
   * cycles don't need the caller to re-supply it. If the pane is currently
   * live, uploads immediately; if parked, the upload is deferred to the next
   * `render()`/`restore()`.
   */
  setSource(src: SourceUpload): void;
  /**
   * Run the IMAGE render pass with `params` against the current source.
   * Auto-restores a parked pane first (marking it most-recently-used) and
   * evicts the LRU live pane if that pushes the pool over
   * `MAX_LIVE_SWAPCHAINS`. No-op (does not throw) if no source has been set
   * yet or the handle was disposed.
   *
   * NEVER THROWS (C1 fix — whole-branch review): a non-context-lost GPU
   * failure while (re)activating this pane's resources (e.g. WebGL2
   * `getContext` returning `null` under live-context exhaustion — see
   * `activateEntry`'s doc) or while running the render pass itself is caught
   * here, the entry is parked, and `false` is returned instead of letting the
   * exception propagate into the caller's `useEffect` (which would otherwise
   * unmount the caller's whole subtree — React 18 unmounts to the nearest
   * root on an uncaught effect throw). Returns `true` on success OR on the
   * transparently-retried context-LOST path (`webgl2` `isContextLost()` —
   * recoverable, not a hard failure). Callers (`renderers/GpuImagePane.tsx`)
   * treat a `false` return as "fall back to the legacy CPU pane".
   */
  render(params: ImageParams): boolean;
  /** Free this pane's live GPU resources (source texture; WebGL2: the whole
   *  per-pane Device/context), keeping the retained CPU source buffer. Safe
   *  to call on an already-parked or disposed handle (no-op). */
  park(): void;
  /** Re-acquire GPU resources and re-upload the retained CPU source buffer,
   *  marking this pane most-recently-used (may evict another pane over cap).
   *  Safe to call on an already-live or disposed handle (no-op). */
  restore(): void;
  /**
   * Report this pane's current on-screen visibility (driven by
   * `GpuImagePane`'s `IntersectionObserver`). Purely informational for the
   * LRU: `evictOverCap` prefers parking an OFF-SCREEN (`visible: false`)
   * entry over a visible one, so a still-on-screen pane that got LRU-parked
   * only because MORE panes are visible than `MAX_LIVE_SWAPCHAINS` (the
   * many-panes-gallery case this pool exists for) survives longer than an
   * off-screen one. Does NOT itself park/restore anything — no-op on a
   * disposed handle. Defaults to visible (`true`) until the caller reports
   * otherwise, since a freshly-acquired pane is typically on-screen.
   */
  setVisible(visible: boolean): void;
  /** Permanently release this pane: frees GPU resources AND drops the
   *  retained CPU buffer. The handle is unusable after this. */
  dispose(): void;
}

interface PaneEntry {
  canvas: HTMLCanvasElement;
  sharedDevice: Device;
  /** The device actually used to render THIS pane — `sharedDevice` for
   *  WebGPU, a dedicated per-pane `createWebGL2Device()` instance for
   *  WebGL2 (recreated on every restore — see module doc). */
  device: Device | null;
  hdr: boolean;
  surface: Surface | null;
  srcTexture: Texture | null;
  source: SourceUpload | null;
  parked: boolean;
  disposed: boolean;
  /** Last-reported on-screen visibility (`PaneHandle.setVisible`) — read by
   *  `evictOverCap` to prefer parking off-screen panes first. */
  visible: boolean;
  /** Bounds the `render()` WebGL2-context-restore retry loop (see `render()`
   *  below) so a genuinely-unrecoverable context doesn't retry forever. */
  restoreRetries: number;
}

// Module-singleton LRU of currently-LIVE (non-parked) entries, oldest first.
const live: PaneEntry[] = [];

function touchMostRecentlyUsed(entry: PaneEntry): void {
  const i = live.indexOf(entry);
  if (i !== -1) live.splice(i, 1);
  live.push(entry);
}

function untrack(entry: PaneEntry): void {
  const i = live.indexOf(entry);
  if (i !== -1) live.splice(i, 1);
}

/** Free `entry`'s live GPU resources; leaves `entry.source` (CPU buffer) intact. */
function parkEntry(entry: PaneEntry): void {
  if (entry.parked) return;
  untrack(entry);
  if (entry.srcTexture) {
    entry.srcTexture.destroy();
    entry.srcTexture = null;
  }
  entry.surface = null;
  // WebGL2: the per-pane Device OWNS a scarce GL context — destroy it
  // outright (see module doc). WebGPU: `device` === the shared singleton;
  // never destroy it here, just stop using it for this canvas.
  if (entry.device && entry.device !== entry.sharedDevice) {
    entry.device.destroy();
  }
  entry.device = null;
  entry.parked = true;
}

/**
 * Evict (park) the least-recently-used live entry other than `except`,
 * repeating until at/under `MAX_LIVE_SWAPCHAINS`. Prefers the LRU entry among
 * OFF-SCREEN (`visible: false`) panes — parking a pane nobody can see is
 * always preferable to parking one that's on-screen. Only reaches into the
 * visible set when every other live slot is ALSO visible (the many-panes
 * gallery case: more visible panes than the cap, so an eviction among them is
 * unavoidable) — falls back to plain LRU across all live entries then.
 */
function evictOverCap(except: PaneEntry): void {
  while (live.length > MAX_LIVE_SWAPCHAINS) {
    const victim = live.find((e) => e !== except && !e.visible) ?? live.find((e) => e !== except);
    if (!victim) break;
    parkEntry(victim);
  }
}

/**
 * (Re-)acquire GPU resources for `entry` and upload its retained source (if
 * any); marks it most-recently-used and enforces the live cap.
 *
 * THROWS on a hard GPU-init failure — most realistically WebGL2's
 * `createWebGL2Device()`/`Device.createSurface()` (`webgl2/device.ts:157-158,
 * 417, 483`) when `canvas.getContext("webgl2")` returns `null` under live
 * -context exhaustion (the browser's ~16-context-per-page cap; see this
 * module's doc comment). Callers (`attemptRender`, below) MUST catch this —
 * it is a genuine "this pane can never activate right now" condition, not a
 * recoverable context-LOST case (that's `Device.isContextLost()`, checked
 * separately after a SUCCESSFUL activation). `?forceEngineFail` (test-only,
 * `./test-hooks`) deterministically triggers this same throw path without
 * needing to actually exhaust the browser's context cap.
 */
function activateEntry(entry: PaneEntry): void {
  if (entry.disposed) return;
  if (forceEngineFailRequested()) {
    throw new Error("cairn-plot engine: forced pane activation failure (?forceEngineFail test hook)");
  }
  if (!entry.parked && entry.surface) {
    touchMostRecentlyUsed(entry);
    evictOverCap(entry);
    return;
  }
  const device =
    entry.sharedDevice.backend === "webgl2" ? createWebGL2Device() : entry.sharedDevice;
  entry.device = device;
  entry.surface = device.createSurface(entry.canvas, { hdr: entry.hdr });
  if (entry.source) {
    entry.canvas.width = entry.source.width;
    entry.canvas.height = entry.source.height;
    entry.surface.configure(entry.source.width, entry.source.height);
    const tex = device.createTexture(entry.source.width, entry.source.height, entry.source.format);
    tex.write(entry.source.data);
    entry.srcTexture = tex;
  }
  entry.parked = false;
  touchMostRecentlyUsed(entry);
  evictOverCap(entry);
}

/** Bounds the WebGL2-context-restore retry loop in `attemptRender` below —
 *  ~0.5s at 60fps, generous for the browser's async restoration to
 *  complete, but finite so a genuinely-unrecoverable context doesn't retry
 *  forever. */
const MAX_CONTEXT_RESTORE_RETRIES = 30;

/**
 * Runs the IMAGE render pass for `entry`, transparently retrying via
 * `requestAnimationFrame` if the pane's (WebGL2) device reports its context
 * is still LOST after `activateEntry()` — see `webgl2/device.ts`'s
 * `createSurface` doc: re-adopting a canvas whose context was explicitly
 * PARKED (`WEBGL_lose_context.loseContext()`'d) triggers `restoreContext()`
 * but that completes ASYNCHRONOUSLY, so the very next `render()` call after
 * a restore can race a context that isn't usable YET. Each retry fully
 * re-parks (`parkEntry`) and re-attempts `activateEntry()` from scratch —
 * objects (texture/fbo/vao) created while the context was still lost are
 * dead per-spec placeholders even once restoration completes, so simply
 * retrying the SAME `renderImage()` call is not enough. WebGPU's
 * `isContextLost()` always returns `false` (see `types.ts`'s doc), so this
 * is a no-op there — `renderImage()` runs immediately, same as before.
 *
 * C1 fix (whole-branch review): `activateEntry()` — and thus the WebGL2
 * `getContext`-returns-`null` hard-failure vector — used to run OUTSIDE this
 * function's try/catch (only `renderImage()` was guarded). Both are now
 * inside ONE try/catch; a non-context-lost failure from EITHER parks the
 * entry and returns `false` instead of throwing into the caller
 * (`PaneHandle.render()` → `renderers/GpuImagePane.tsx`'s render effect),
 * which would otherwise unmount the caller's whole subtree.
 */
function attemptRender(entry: PaneEntry, params: ImageParams): boolean {
  if (entry.disposed || !entry.source) return true;
  try {
    activateEntry(entry);
    if (!entry.device || !entry.surface || !entry.srcTexture) return false;
    if (entry.device.isContextLost()) {
      retryAfterContextRestore(entry, params);
      return true;
    }
    renderImage(entry.device, entry.surface, entry.srcTexture, params);
    entry.restoreRetries = 0;
    return true;
  } catch (err) {
    // Belt-and-suspenders: a still-lost context at render time (missed by
    // the pre-check above, e.g. lost mid-call) retries the same recoverable
    // path; anything else is a genuine hard failure — park and report it
    // instead of rethrowing.
    if (entry.device?.isContextLost()) {
      retryAfterContextRestore(entry, params);
      return true;
    }
    // eslint-disable-next-line no-console
    console.warn("cairn-plot engine: pane activation/render failed, falling back to legacy pane", err);
    // Force a full teardown regardless of `parkEntry`'s early-return guard
    // (`entry.parked` may still read `true` if the throw happened mid
    // `activateEntry()`, before it flips to `false` — see that function).
    entry.parked = false;
    parkEntry(entry);
    return false;
  }
}

function retryAfterContextRestore(entry: PaneEntry, params: ImageParams): void {
  if (entry.disposed) return;
  if (entry.restoreRetries >= MAX_CONTEXT_RESTORE_RETRIES) {
    entry.restoreRetries = 0;
    return; // Give up silently — a subsequent render() call starts fresh.
  }
  entry.restoreRetries++;
  parkEntry(entry);
  requestAnimationFrame(() => attemptRender(entry, params));
}

function makeHandle(entry: PaneEntry): PaneHandle {
  return {
    canvas: entry.canvas,
    backend: entry.sharedDevice.backend,
    get isParked() {
      return entry.parked;
    },
    setSource(src: SourceUpload): void {
      if (entry.disposed) return;
      entry.source = src;
      if (!entry.parked && entry.device && entry.surface) {
        entry.canvas.width = src.width;
        entry.canvas.height = src.height;
        entry.surface.configure(src.width, src.height);
        if (entry.srcTexture) entry.srcTexture.destroy();
        const tex = entry.device.createTexture(src.width, src.height, src.format);
        tex.write(src.data);
        entry.srcTexture = tex;
      }
      // Parked: the new source is picked up by the next activateEntry().
    },
    render(params: ImageParams): boolean {
      return attemptRender(entry, params);
    },
    park(): void {
      if (entry.disposed) return;
      parkEntry(entry);
    },
    restore(): void {
      if (entry.disposed || !entry.source) return;
      activateEntry(entry);
    },
    setVisible(visible: boolean): void {
      if (entry.disposed) return;
      entry.visible = visible;
    },
    dispose(): void {
      if (entry.disposed) return;
      parkEntry(entry);
      entry.source = null;
      entry.disposed = true;
    },
  };
}

/**
 * Acquire a pane bound to `canvas`. Resolves the page-wide shared `Device`
 * (`getSharedDevice()`) to decide the backend, but does NOT allocate any
 * live GPU resources yet — the pane starts PARKED; the first `setSource()` +
 * `render()` (or explicit `restore()`) activates it. Cheap to call for many
 * canvases up front (e.g. a gallery mounting 100 panes) since nothing GPU-side
 * happens until a pane actually needs to draw.
 */
export async function acquirePane(
  canvas: HTMLCanvasElement,
  opts?: { hdr?: boolean },
): Promise<PaneHandle> {
  const sharedDevice = await getSharedDevice();
  const entry: PaneEntry = {
    canvas,
    sharedDevice,
    device: null,
    hdr: opts?.hdr ?? false,
    surface: null,
    srcTexture: null,
    source: null,
    parked: true,
    disposed: false,
    visible: true,
    restoreRetries: 0,
  };
  return makeHandle(entry);
}

/** Permanently release `handle` — equivalent to `handle.dispose()`. */
export function releasePane(handle: PaneHandle): void {
  handle.dispose();
}

/** Number of currently-LIVE (non-parked) panes across the whole pool —
 *  test/introspection hook (mirrors `engine/device.ts`'s test helpers). */
export function getLiveSwapchainCount(): number {
  return live.length;
}

/** True if `canvas`'s pane is currently LIVE (not parked) — test/introspection
 *  hook, used by the many-panes-gallery harness to find a pane the LRU cap
 *  parked without needing access to its `PaneHandle`. */
export function isCanvasLive(canvas: HTMLCanvasElement): boolean {
  return live.some((e) => e.canvas === canvas);
}
