import { getRenderMode } from "@cairn-plot/lib/cairn-plot";

// ---------------------------------------------------------------------------
// GPU-image addon loader (app side).
//
// cairn-plot ships its WebGPU engine — the `GpuImagePane` (image backend) and
// `GpuComparePane` (split/blend/diff + the FULL diff-kernel menu: the six
// pointwise diffs plus FLIP / HDR-FLIP / SSIM, HDR float ingestion, and the
// tonemap toolbar) — as a self-registering "gpu-image" ADDON
// (`vendor/cairn-plot/ui/src/plot-gpu-image-addon.tsx`). Importing that module
// runs its capability check (`getSharedDevice()`), and on success publishes the
// window seams the CORE renderers pick up at runtime:
//   - `__cairnPlotGpuImagePane`     → `plot-renderers`/`resolveImageRenderer`
//   - `__cairnPlotGpuComparePane`   → `media-compare/compositor`'s `resolveGpuComparePane`
//   - `__cairnPlotUseGpuImage=true` → flips the "auto" default onto the engine
//   - `__cairnPlotDiffMenuModes`    → the registry-derived kernel menu list
// then dispatches `cairn-plot:gpu-image-ready` so already-mounted panes upgrade.
//
// The STANDALONE plot bundle loads this addon on every image/compare page (via
// `elements.py`'s `_gpu_image_addon_html()`); the viewer app had no equivalent,
// so `__cairnPlotGpuComparePane` was never set and the compositor's
// `resolveGpuComparePane()` always returned null — GPU/Auto render modes
// silently fell back to the legacy CPU panes. That single missing wire is why
// the app's image compares showed no engine diff kernels, no true-HDR float
// compare, and no GPU zoom auto-nearest, EVEN on a WebGPU browser with render
// mode "Auto". This restores parity: the app now loads the same addon.
//
// Dynamically `import()`ed so the WebGPU engine lands in its own lazy chunk
// (off the app's main bundle), matching the addon's design intent. Skipped when
// the user has explicitly forced the CPU backend (no reason to spin up a WebGPU
// device that `resolveGpuComparePane`/`resolveImageRenderer` will ignore).
// ---------------------------------------------------------------------------
export function loadGpuImageAddon(): void {
  if (typeof window === "undefined") return;
  if (getRenderMode() === "cpu") return;
  void import("@cairn-plot/plot-gpu-image-addon");
}
