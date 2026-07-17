/**
 * Backend selection + page-wide shared-device singleton (Task 4 of the
 * WebGPU engine, Sub-project 1; simplified to WebGPU-only when the WebGL2
 * backend was removed — see `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`).
 * Sits above the one concrete backend (`webgpu/device.ts`'s
 * `createWebGPUDevice()`) and answers "which ONE `Device` does the whole
 * page share".
 *
 * ## Why a page-wide singleton (not one `Device` per pane/canvas)
 * A `GPUDevice` is NOT tied to a single canvas — one WebGPU device can back
 * many `GPUCanvasContext`s (`createSurface` per canvas), so every pane on a
 * page shares ONE `Device` instance rather than each requesting its own
 * adapter/device. This module only decides whether WebGPU is available and
 * hands back one shared instance; it does not know about canvases at all
 * (that's `engine/pool.ts`'s job).
 *
 * ## Selection policy — WebGPU-ONLY
 * `navigator.gpu` must be present AND `createWebGPUDevice()` (its own
 * `requestAdapter`/`requestDevice` calls) must resolve without throwing.
 * There is no fallback backend inside the engine: when WebGPU is
 * unavailable or fails to initialize, `getSharedDevice()` REJECTS. Callers
 * that need a page to still render without WebGPU must catch that rejection
 * and fall back to the LEGACY CPU/2D-canvas pane (`ImagePane`/
 * `HdrImagePane`/`CompositeMediaPane`) — see `plot-renderers.tsx`'s
 * `resolveImageRenderer` seam and `plot-gpu-image-addon.tsx`'s capability
 * gate for where that boundary lives. This module itself does no CPU
 * fallback — it is WebGPU-or-nothing by design, so the engine has exactly
 * one code path to maintain.
 *
 * ## Memoization
 * `getSharedDevice()` memoizes the IN-FLIGHT PROMISE (not just the resolved
 * value), so concurrent callers during the async WebGPU
 * adapter/device-request window all await the same promise and resolve to
 * the same `Device` instance — no duplicate `requestAdapter()`/
 * `requestDevice()` races. `resetSharedDevice()` clears the memo (for tests)
 * and best-effort `destroy()`s whatever device the cleared memo resolves to,
 * so a subsequent `getSharedDevice()` call creates a genuinely fresh
 * instance rather than reusing a destroyed one.
 */
import type { Device } from "./types";
import { createWebGPUDevice } from "./webgpu/device";

let sharedDevicePromise: Promise<Device> | null = null;

async function selectDevice(): Promise<Device> {
  if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu) {
    throw new Error("cairn-plot engine: WebGPU is not available (no navigator.gpu) — no fallback backend in the engine, caller must use the legacy CPU pane");
  }
  return createWebGPUDevice();
}

/**
 * Returns the ONE page-wide `Device`, creating it on first call and
 * memoizing it for every call after (including concurrent calls made before
 * the first resolves) — see module doc comment for the selection policy and
 * memoization contract. REJECTS when WebGPU is unavailable/fails to
 * initialize — there is no in-engine fallback (see module doc); callers must
 * catch and render the legacy CPU pane instead.
 */
export function getSharedDevice(): Promise<Device> {
  if (!sharedDevicePromise) {
    sharedDevicePromise = selectDevice();
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
      // Device never resolved (a rejected selectDevice()) — nothing to destroy.
    });
  }
}
