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
 * evicts (parks) the least-recently-used OTHER live pane. `GpuImagePane`
 * additionally drives explicit `park()`/`restore()` from its own
 * `IntersectionObserver` so off-screen panes free GPU memory promptly instead
 * of only reactively at the next over-cap render.
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
   */
  render(params: ImageParams): void;
  /** Free this pane's live GPU resources (source texture; WebGL2: the whole
   *  per-pane Device/context), keeping the retained CPU source buffer. Safe
   *  to call on an already-parked or disposed handle (no-op). */
  park(): void;
  /** Re-acquire GPU resources and re-upload the retained CPU source buffer,
   *  marking this pane most-recently-used (may evict another pane over cap).
   *  Safe to call on an already-live or disposed handle (no-op). */
  restore(): void;
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

/** Evict (park) the least-recently-used live entry other than `except`,
 *  repeating until at/under `MAX_LIVE_SWAPCHAINS`. */
function evictOverCap(except: PaneEntry): void {
  while (live.length > MAX_LIVE_SWAPCHAINS) {
    const victim = live.find((e) => e !== except);
    if (!victim) break;
    parkEntry(victim);
  }
}

/** (Re-)acquire GPU resources for `entry` and upload its retained source (if
 *  any); marks it most-recently-used and enforces the live cap. */
function activateEntry(entry: PaneEntry): void {
  if (entry.disposed) return;
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
    render(params: ImageParams): void {
      if (entry.disposed || !entry.source) return;
      activateEntry(entry);
      if (!entry.device || !entry.surface || !entry.srcTexture) return;
      renderImage(entry.device, entry.surface, entry.srcTexture, params);
    },
    park(): void {
      if (entry.disposed) return;
      parkEntry(entry);
    },
    restore(): void {
      if (entry.disposed || !entry.source) return;
      activateEntry(entry);
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
