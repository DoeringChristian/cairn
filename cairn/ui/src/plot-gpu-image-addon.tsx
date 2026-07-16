/**
 * The OFFLINE **gpu-image addon** inline-bundle entry (Task 6 of the WebGPU
 * engine, Sub-project 1) — compiled by `vite.plot-gpu-image.config.ts` into
 * the self-contained `dist/plot-inline/gpu-image.iife.js`. Same generic addon
 * shape as `plot-figure-addon.tsx`/`plot-three-addon.tsx` (guard flag +
 * `window.__cairnPlotRegisterRenderer`), with ONE difference: registration is
 * gated behind a CAPABILITY CHECK, not just an include-once guard, because
 * unlike Plotly/three (always safe to run), the WebGPU/WebGL2 engine can fail
 * to initialize in an environment with neither backend available.
 *
 * ## Not wired into any live page yet
 * Per the Task 6 brief, this addon is INFRASTRUCTURE ONLY — nothing in the
 * Python emitter (`cairn/sdk/_plot_bundle.py`) includes this `<script>` on a
 * real gallery/standalone page today (that is Task 8's job, once
 * `GpuImagePane` has full compare/metrics parity — Task 7). It exists so the
 * browser test harness (`renderers/__tests__/gpu-image-pane.browser.ts`) can
 * load it directly to exercise the registration path end-to-end.
 *
 * ## Capability gate
 * Two independent opt-outs, checked BEFORE anything GPU-related runs:
 *   1. `window.__cairnPlotUseGpuImage === false` — an explicit escape hatch
 *      (harness/host can force the legacy CPU panes even when a GPU backend
 *      IS available) — the brief's "a `useGpuImage` flag" option.
 *   2. `getSharedDevice()` rejecting — no WebGPU AND no WebGL2 available (the
 *      "engine can't init" case). `getSharedDevice()` itself already falls
 *      back WebGPU → WebGL2 silently (`engine/device.ts`'s module doc); a
 *      REJECTION here means neither backend exists, so registration is
 *      skipped and core's already-registered legacy `ImagePane`/`HdrImagePane`
 *      (`plot-renderers.tsx`'s `registerCoreRenderers()`, which always runs
 *      first) remain the `"image"`/`"imagehdr"` renderers — the fallback the
 *      brief requires, with ZERO extra code here: this addon simply never
 *      overwrites them.
 */
import { getSharedDevice } from "./lib/cairn-plot/engine/device";
import GpuImagePane from "./lib/cairn-plot/renderers/GpuImagePane";

declare global {
  interface Window {
    /** Include-once guard the gpu-image addon sets after it registers. */
    __cairnPlotGpuImageLoaded?: boolean;
    /** Explicit opt-out: `false` skips GPU registration even when a backend
     *  is available, forcing the legacy CPU panes. Unset/`true` = default
     *  (attempt GPU registration, gated on `getSharedDevice()` resolving). */
    __cairnPlotUseGpuImage?: boolean;
  }
}

async function tryRegister(): Promise<void> {
  if (window.__cairnPlotGpuImageLoaded) return;
  if (window.__cairnPlotUseGpuImage === false) {
    console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");
    return;
  }
  if (typeof window.__cairnPlotRegisterRenderer !== "function") {
    // Core must run first (Python emits it before this addon). If it somehow
    // hasn't, fail loud in the console rather than silently no-op.
    console.error(
      "cairn-plot gpu-image addon: core bundle not installed " +
        "(window.__cairnPlotRegisterRenderer missing) — staying on legacy panes.",
    );
    return;
  }
  try {
    await getSharedDevice();
    window.__cairnPlotRegisterRenderer("image", GpuImagePane);
    window.__cairnPlotRegisterRenderer("imagehdr", GpuImagePane);
    window.__cairnPlotGpuImageLoaded = true;
  } catch (err) {
    // Neither WebGPU nor WebGL2 available — the legacy CPU panes core already
    // registered stay in place. This is an expected, non-fatal path.
    console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes", err);
  }
}

void tryRegister();
