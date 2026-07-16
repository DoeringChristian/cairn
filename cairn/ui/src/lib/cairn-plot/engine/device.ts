/**
 * Backend selection + page-wide shared-device singleton (Task 4 of the
 * WebGPU engine, Sub-project 1). Sits above the two concrete backends
 * (`webgl2/device.ts`'s `createWebGL2Device()`, `webgpu/device.ts`'s
 * `createWebGPUDevice()`) and answers "which ONE `Device` does the whole
 * page share".
 *
 * ## Why a page-wide singleton (not one `Device` per pane/canvas)
 * A `GPUDevice` is NOT tied to a single canvas — one WebGPU device can back
 * many `GPUCanvasContext`s (`createSurface` per canvas), so every pane on a
 * page should share ONE `Device` instance rather than each requesting its
 * own adapter/device. `engine/webgl2/device.ts`'s module doc documents the
 * opposite constraint for its backend (one WebGL2 context IS exclusive to
 * one canvas) — that per-canvas wall is a concern for `engine/pool.ts`
 * (Task 6), which owns creating one `createWebGL2Device()` per on-screen
 * canvas when the shared device resolves to `"webgl2"`. This module only
 * decides which backend the page uses and hands back one shared instance;
 * it does not know about canvases at all.
 *
 * ## Selection policy
 * WebGPU is preferred: `navigator.gpu` must be present AND
 * `createWebGPUDevice()` (its own `requestAdapter`/`requestDevice` calls)
 * must resolve without throwing. Any failure along that path (no adapter,
 * `requestDevice` rejection, etc.) is caught and silently falls back to
 * `createWebGL2Device()` — WebGL2 has no equivalent async failure mode
 * (`createWebGL2Device` is synchronous and either returns a `Device` or
 * throws), so no further fallback exists beneath it.
 *
 * ## `?forceWebGL2` override
 * Skips the WebGPU attempt entirely and returns `createWebGL2Device()` when
 * either the current page URL has a `forceWebGL2` query parameter (any
 * value, including empty — `location.search` is parsed with
 * `URLSearchParams`) or the caller passes `{ forceWebGL2: true }` explicitly
 * to `getSharedDevice()` (mainly useful for tests/harnesses that don't want
 * to navigate to a real `?forceWebGL2` URL just to exercise this path).
 * This is the mechanism Task 8's cross-backend parity gate uses to force
 * every feature check to also run against the WebGL2 fallback.
 *
 * ## Memoization
 * `getSharedDevice()` memoizes the IN-FLIGHT PROMISE (not just the resolved
 * value), so concurrent callers during the async WebGPU
 * adapter/device-request window all await the same promise and resolve to
 * the same `Device` instance — no duplicate `requestAdapter()`/
 * `requestDevice()` races. `resetSharedDevice()` clears the memo (for tests)
 * and best-effort `destroy()`s whatever device the cleared memo resolves to,
 * so a subsequent `getSharedDevice()` call creates and returns a genuinely
 * fresh instance rather than reusing a destroyed one.
 */
import type { Device } from "./types";
import { createWebGL2Device } from "./webgl2/device";
import { createWebGPUDevice } from "./webgpu/device";

export interface GetSharedDeviceOptions {
  /**
   * Force the WebGL2 fallback, skipping the WebGPU attempt entirely — same
   * effect as a `?forceWebGL2` URL query param, but settable directly
   * (mainly for tests/harnesses). `undefined` (the default) defers to the
   * URL check.
   */
  forceWebGL2?: boolean;
}

let sharedDevicePromise: Promise<Device> | null = null;

/** Reads the `forceWebGL2` query param off the current page URL, if any. */
function urlRequestsForceWebGL2(): boolean {
  if (typeof location === "undefined") return false;
  try {
    return new URLSearchParams(location.search).has("forceWebGL2");
  } catch {
    return false;
  }
}

async function selectDevice(forceWebGL2: boolean): Promise<Device> {
  const wantWebGPU = !forceWebGL2 && typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;
  if (wantWebGPU) {
    try {
      return await createWebGPUDevice();
    } catch {
      // Adapter unavailable, requestDevice() rejected, etc. — fall through
      // to the WebGL2 fallback below rather than rejecting the shared
      // promise (a page with no WebGPU support must still render).
    }
  }
  return createWebGL2Device();
}

/**
 * Returns the ONE page-wide `Device`, creating it on first call and
 * memoizing it for every call after (including concurrent calls made before
 * the first resolves) — see module doc comment for the selection policy and
 * memoization contract.
 */
export function getSharedDevice(opts?: GetSharedDeviceOptions): Promise<Device> {
  if (!sharedDevicePromise) {
    const forceWebGL2 = opts?.forceWebGL2 ?? urlRequestsForceWebGL2();
    sharedDevicePromise = selectDevice(forceWebGL2);
  }
  return sharedDevicePromise;
}

/**
 * Clears the memoized shared device (for tests) and best-effort `destroy()`s
 * whatever device the cleared memo resolves to. The next `getSharedDevice()`
 * call creates a genuinely fresh `Device` rather than reusing a destroyed
 * one. Safe to call when no device has been created yet (no-op).
 */
export function resetSharedDevice(): void {
  const previous = sharedDevicePromise;
  sharedDevicePromise = null;
  if (previous) {
    previous.then((device) => device.destroy()).catch(() => {
      // Device never resolved (selectDevice itself doesn't reject, but stay
      // defensive) — nothing to destroy.
    });
  }
}
