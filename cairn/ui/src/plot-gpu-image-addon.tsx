/**
 * The OFFLINE **gpu-image addon** inline-bundle entry (Task 6/7/8 of the
 * WebGPU engine, Sub-project 1) — compiled by `vite.plot-gpu-image.config.ts`
 * into the self-contained `dist/plot-inline/gpu-image.iife.js`. Same generic
 * addon SHAPE as `plot-figure-addon.tsx`/`plot-three-addon.tsx` (an
 * include-once guard flag, reuses core's React), with ONE difference:
 * activation is gated behind a CAPABILITY CHECK, not just the include-once
 * guard, because unlike Plotly/three (always safe to run), the WebGPU-only
 * engine can fail to initialize in an environment without WebGPU.
 *
 * ## Task 8 — wired into the real emit path
 * `cairn/sdk/elements.py`'s `_gpu_image_addon_html()` now includes this
 * `<script>` on any page whose descriptor contains an `image`/`imagehdr` leaf
 * or a `compare` node (`_plot_bundle.inline_gpu_image_addon_js()`).
 *
 * ## Window seam, NOT a registry overwrite (Task 8 fix)
 * Earlier (Task 6) this addon called
 * `window.__cairnPlotRegisterRenderer("image"/"imagehdr", GpuImagePane)`,
 * REPLACING the registry entries `plot-renderers.tsx`'s
 * `registerCoreRenderers()` already populated with `ImageStandalone`/
 * `ImageHdrStandalone` — the standalone adapters that own the local
 * `zoom`/`pan` viewport `useState` a raw, uncontrolled `GpuImagePane` has no
 * way to get (see `use-image-viewport.ts`: `onViewportChange` is required for
 * wheel-zoom/pan to do anything). That overwrite also raced the mount: a
 * `LeafView` only re-subscribes to `plot-registry.tsx`'s `onRegister` when
 * its renderer is NOT YET registered, and core registers `"image"` at page
 * bootstrap — long before this addon's async `getSharedDevice()` settles —
 * so a swap arriving after mount was invisible to an already-rendered leaf.
 *
 * Task 8 fixes both problems the same way `GpuComparePane` already does it
 * (`media-compare/compositor.tsx`'s `__cairnPlotGpuComparePane`): expose the
 * PANE COMPONENT on a window seam (`__cairnPlotGpuImagePane`) instead of
 * mutating the registry, and let `plot-renderers.tsx`'s `ImageStandalone`/
 * `ImageHdrStandalone` (which keep owning the local viewport state) pick it
 * up via `resolveImageRenderer()` — the formalized capability-gated seam
 * (see that function's doc comment) that also listens for the
 * `GPU_IMAGE_READY_EVENT` this addon dispatches on success, so an
 * already-mounted leaf re-renders onto the engine pane the instant it becomes
 * available instead of only picking it up on a later, unrelated re-render.
 *
 * ## Capability gate + legacy fallback
 * Two independent opt-outs, checked BEFORE anything GPU-related runs:
 *   1. `window.__cairnPlotUseGpuImage === false` — an explicit escape hatch
 *      (harness/host can force the legacy CPU panes even when WebGPU IS
 *      available).
 *   2. `getSharedDevice()` rejecting — no WebGPU available (the engine is
 *      WebGPU-ONLY; there is no second GPU backend to fall back to inside
 *      the engine — see `engine/device.ts`'s module doc). A REJECTION here
 *      means the window seams are never set and `__cairnPlotUseGpuImage` is
 *      never flipped to `true` — `ImageStandalone`/`ImageHdrStandalone`/
 *      `CompositeMediaPane` all keep rendering the legacy CPU panes, with
 *      ZERO extra code on their side: they simply never see a truthy seam.
 * On success (capability check passes and neither opt-out fired),
 * `__cairnPlotUseGpuImage` defaults to `true` — the standalone gallery uses
 * the engine BY DEFAULT once it's available, per the Task 8 brief — unless
 * the host already forced it to `false`.
 */
import { getSharedDevice } from "./lib/cairn-plot/engine/device";
import GpuImagePane from "./lib/cairn-plot/renderers/GpuImagePane";
import GpuComparePane from "./lib/cairn-plot/media-compare/GpuComparePane";

/**
 * Dispatched on `window` once registration succeeds. Name duplicated (not
 * imported) in `plot-renderers.tsx` / `media-compare/compositor.tsx` — those
 * are CORE files this addon may depend on, but core must never depend back on
 * an addon file, so the string is kept in sync by comment instead of a shared
 * import.
 */
const GPU_IMAGE_READY_EVENT = "cairn-plot:gpu-image-ready";

declare global {
  interface Window {
    /** Include-once guard the gpu-image addon sets after it registers. */
    __cairnPlotGpuImageLoaded?: boolean;
    /** Explicit opt-out: `false` skips GPU registration even when a backend
     *  is available, forcing the legacy CPU panes. Unset defaults to `true`
     *  once the engine is confirmed available (see module doc); a host page
     *  may also set it to `true` itself before this addon runs. */
    __cairnPlotUseGpuImage?: boolean;
  }
}

// NOTE: `__cairnPlotGpuImagePane` (the image/HDR-image pane seam) is declared
// globally in `plot-renderers.tsx` as `ComponentType<any>` — the CORE file
// that actually reads it. Re-declaring it here with the narrower
// `typeof GpuImagePane` would conflict (TS2717: a `Window` augmentation must
// have ONE type across the whole program). Assign through an `any`-typed cast
// instead, same as the compare-pane seam below.

async function tryRegister(): Promise<void> {
  if (window.__cairnPlotGpuImageLoaded) return;
  if (window.__cairnPlotUseGpuImage === false) {
    console.info("cairn-plot gpu-image addon: skipped (__cairnPlotUseGpuImage === false)");
    return;
  }
  try {
    await getSharedDevice();
    (window as unknown as { __cairnPlotGpuImagePane?: typeof GpuImagePane }).__cairnPlotGpuImagePane =
      GpuImagePane;
    // Inject the engine-backed split/blend/diff compare pane for
    // `media-compare/compositor.tsx` to pick up at runtime (Task 7). Kept off
    // the static `core` graph — see that file's `__cairnPlotGpuComparePane`
    // doc — so the engine ships here in the addon, not in core.iife.js.
    (window as unknown as { __cairnPlotGpuComparePane?: typeof GpuComparePane }).__cairnPlotGpuComparePane =
      GpuComparePane;
    // Default ON once the engine is confirmed available (Task 8). The
    // opt-out was already checked (and returned early on) above; TS narrows
    // the property to exclude `false` from that point on, so re-checking it
    // here is both redundant and a type error — the opt-out is not a
    // supported timing to flip asynchronously mid-init anyway.
    window.__cairnPlotUseGpuImage = true;
    window.__cairnPlotGpuImageLoaded = true;
    // Wake up any already-mounted ImageStandalone/ImageHdrStandalone/
    // CompositeMediaPane instances that rendered on the legacy pane before
    // this async capability check settled.
    window.dispatchEvent(new Event(GPU_IMAGE_READY_EVENT));
  } catch (err) {
    // WebGPU not available (or failed to initialize) — the legacy CPU panes
    // stay in place. This is an expected, non-fatal path.
    console.warn("cairn-plot gpu-image addon: engine init failed, staying on legacy panes", err);
  }
}

void tryRegister();
