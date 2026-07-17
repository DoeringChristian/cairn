/**
 * WebGPU canvas surface configuration — SDR and the VALIDATED HDR recipe
 * from the Task-0 spike (`docs/superpowers/specs/2026-07-16-webgpu-hdr-spike.md`).
 *
 * `configureHDRSurface`/`configureSDRSurface` are pure `context.configure(...)`
 * wrappers — they do NOT decide *whether* to request HDR (that's
 * `engine/webgpu/device.ts`'s `createSurface({hdr})`, driven by whatever a
 * caller — ultimately the renderer, a later task — asks for). Per the
 * Task 3 brief, neither function gates on
 * `matchMedia('(dynamic-range: high)')`: the spike's own recipe doc
 * mentions that gate as where the RENDERER should decide to request `hdr`
 * at all, not something this module re-derives.
 *
 * ## `alphaMode: 'premultiplied'` (Q18)
 * Both configs use `'premultiplied'`, not `'opaque'`: `image.wgsl.ts`/
 * `compare.wgsl.ts` output a fully-transparent `vec4(0.0)` fragment for any
 * pixel outside the sampled image's `[0,1]` bounds (zoomed-out borders) — an
 * `'opaque'`-configured surface would force every composited pixel's alpha
 * to 1, silently discarding that transparency and defeating the fix. Every
 * fragment this pipeline ever emits has alpha exactly 0 or 1 (never a
 * fractional in-between), so premultiplied-vs-straight alpha is a
 * distinction without a difference here (0*rgb=0 either way) — no shader
 * change was needed beyond the OOB check itself.
 */
/// <reference types="@webgpu/types" />

export interface SurfaceConfigResult {
  hdr: boolean;
  format: GPUTextureFormat;
  colorSpace?: PredefinedColorSpace;
  toneMappingMode?: GPUCanvasToneMappingMode;
}

/** Both HDR and SDR surfaces need to be sampled back by `Device.readback`. */
const SURFACE_USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;

/**
 * SDR canvas config: the browser's preferred (always 8-bit, e.g.
 * `bgra8unorm`) canvas format, no `colorSpace`/`toneMapping` override.
 */
export function configureSDRSurface(context: GPUCanvasContext, device: GPUDevice): SurfaceConfigResult {
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied", usage: SURFACE_USAGE });
  return { hdr: false, format };
}

/**
 * VALIDATED HDR recipe (Task 0 spike): `rgba16float` + `display-p3` +
 * `toneMapping:{mode:'extended'}` succeeded with no throw and no console
 * errors on the spike's Chrome (macOS, HDR-capable display) — see the
 * spike doc for the full empirical record. `context.configure(...)` throws
 * synchronously on an unsupported config, so the fallback chain below
 * (`mode:'extended'` -> `mode:'standard'` -> SDR) is a plain try/catch, in
 * the same order documented by the spike (the `'standard'`/no-tonemapping
 * steps were never reached in the spike since `'extended'` succeeded on the
 * first try, but they remain the documented fallback for an older
 * Chrome/ANGLE backend, a non-macOS platform, or a future spec change).
 */
export function configureHDRSurface(context: GPUCanvasContext, device: GPUDevice): SurfaceConfigResult {
  try {
    context.configure({
      device,
      format: "rgba16float",
      colorSpace: "display-p3",
      toneMapping: { mode: "extended" },
      alphaMode: "premultiplied",
      usage: SURFACE_USAGE,
    });
    return { hdr: true, format: "rgba16float", colorSpace: "display-p3", toneMappingMode: "extended" };
  } catch {
    try {
      context.configure({
        device,
        format: "rgba16float",
        colorSpace: "display-p3",
        toneMapping: { mode: "standard" },
        alphaMode: "premultiplied",
        usage: SURFACE_USAGE,
      });
      return { hdr: true, format: "rgba16float", colorSpace: "display-p3", toneMappingMode: "standard" };
    } catch {
      return configureSDRSurface(context, device);
    }
  }
}
