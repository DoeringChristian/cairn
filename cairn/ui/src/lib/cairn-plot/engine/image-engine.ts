/**
 * IMAGE render pass (Task 5 of the WebGPU engine, Sub-project 1) — the first
 * real renderer built on top of the RHI (`engine/types.ts`) + backends
 * (Tasks 1-4). `renderImage(device, target, src, params)` runs a fullscreen
 * fragment pipeline that turns a float/8-bit image texture into displayed
 * pixels via `exposure -> [colormap] -> tone-map operator -> output-encode`,
 * PARITY-CRITICAL with the CPU pipeline in `image/tonemap.ts` (see
 * `engine/shaders/image.wgsl.ts`'s module doc comment for the shader-level
 * porting notes and the exact uniform layout).
 *
 * ## Pipeline (matches image/tonemap.ts's HDR-A pipeline, module doc comment)
 *   1. sample `src` at the `params.uv` window (zoom/pan rect, [0,1] source-space)
 *   2. exposure:  rgb *= 2^exposureEV                     (applyExposure)
 *   3. [scalar]:  rgb = colormapLUT(rgb.r)                 (GPU-only stage;
 *      no existing CPU renderer applies a colormap at this pipeline point —
 *      see image.wgsl.ts's doc comment)
 *   4. operator:  rgb = TONEMAP_OPERATORS[operator](rgb)   (HDR [0,∞) -> [0,1]
 *      for every operator EXCEPT `"extended"`, which is a pure identity —
 *      see `image/tonemap.ts`'s doc comment on that entry — so values above
 *      1.0 survive this stage on purpose when paired with `hdrOut:true` and
 *      a real HDR (`rgba16float`/`toneMapping:'extended'`) target.)
 *   5. encode:    out = hdrOut ? rgb : outputEncode(rgb, gamma)
 *
 * ## Not wired into any renderer/bundle entry point yet
 * Per the Task 5 brief: this module (and its shaders) may be imported by a
 * future "image-engine" consumer, but must NOT be reachable from `core`
 * (any always-loaded module, in particular `index.ts`'s barrel) until a
 * later task finalizes bundling (Task 6's `GpuImagePane`, Task 8). Nothing
 * in `cairn-plot` currently imports this file.
 */
import type { BindGroup, Device, RenderPipeline, Surface, Texture, TextureFormat } from "./types";
import { imageWGSL } from "./shaders/image.wgsl";
import { compareWGSL } from "./shaders/compare.wgsl";

export type ImageOperator = "linear" | "srgb" | "reinhard" | "aces" | "extended";

export interface ImageParams {
  /** Exposure in EV stops, applied in scene-linear space: v * 2**ev. */
  exposureEV: number;
  /** Tone-map operator name — matches `TONEMAP_OPERATORS` in image/tonemap.ts. */
  operator: ImageOperator;
  /** Output-encode gamma override. Unset/<=0 = sRGB OETF (matches outputEncode's `undefined` case). */
  gamma?: number;
  /** 256x4 (RGBA-float, [0,1]) colormap LUT, flattened row-major. Required iff `isScalar`. */
  colormap?: Float32Array;
  /** When true, `rgb.r` (post-exposure) indexes `colormap` instead of being tone-mapped directly. */
  isScalar: boolean;
  /** When true, skip the output-encode stage and write display-linear float straight to `target`. */
  hdrOut: boolean;
  /** Source-space [0,1] viewport window (zoom/pan): sampled UV = uv.xy + rawUV * uv.wh. */
  uv: { x: number; y: number; w: number; h: number };
  /**
   * Source-texture filter mode (Q20). `"linear"` (the default when unset) is
   * a manual bilinear blend of the 4 neighboring texels — see
   * `image.wgsl.ts`'s "Source filtering" doc note for why this is hand-rolled
   * in-shader rather than a real `Device.createSampler` + `textureSample`
   * (the HDR `rgba32float` path would need the optional `float32-filterable`
   * WebGPU feature for that, which isn't guaranteed available).
   * `"nearest"` is a single exact texel fetch (crisp/blocky) — callers
   * (`GpuImagePane`) switch to this once a source pixel is large enough
   * on-screen for `PixelValueOverlay`'s per-pixel numbers to appear, so the
   * two visual cues change in lockstep. Defaulting to `"linear"` does not
   * change any EXISTING byte-exact parity-test case: at exact texel-aligned
   * sampling (every case in `image-pass.browser.ts`/`compare-pass.browser.ts`)
   * the bilinear weight is exactly 0, degenerating to the same value nearest
   * would produce.
   */
  filter?: "nearest" | "linear";
}

/** Matches TONEMAP_OPERATORS' key order in image/tonemap.ts — see image.wgsl.ts's doc comment. */
const OPERATOR_ID: Record<ImageOperator, number> = { linear: 0, srgb: 1, reinhard: 2, aces: 3, extended: 4 };

/** One compiled pipeline per (Device, target TextureFormat) — pipelines are format-specific (targetFormat is baked into createRenderPipeline). */
const pipelineCache = new WeakMap<Device, Map<TextureFormat, RenderPipeline>>();

function getImagePipeline(device: Device, targetFormat: TextureFormat): RenderPipeline {
  let byFormat = pipelineCache.get(device);
  if (!byFormat) {
    byFormat = new Map();
    pipelineCache.set(device, byFormat);
  }
  let pipeline = byFormat.get(targetFormat);
  if (!pipeline) {
    pipeline = device.createRenderPipeline({ shaderWGSL: imageWGSL, targetFormat });
    byFormat.set(targetFormat, pipeline);
  }
  return pipeline;
}

function targetFormatOf(target: Surface | Texture): TextureFormat {
  if ("canvas" in target) {
    return (target as Surface).hdr ? "rgba16float" : "rgba8unorm";
  }
  return (target as Texture).format;
}

/**
 * Builds the `t_bind1` colormap-LUT texture for this call. When
 * `params.colormap` is absent (non-scalar path), a 1x1 placeholder is still
 * created — WebGPU's `GPUBindGroupLayout` requires EVERY declared texture
 * binding to have a bound resource (see `webgpu/device.ts`'s
 * `createBindGroup` doc note), and the shader never reads it unless
 * `isScalar` is set, so its contents are irrelevant in that case.
 *
 * When a `colormap` IS provided it must be EXACTLY `256*4` floats (a 256x4
 * RGBA-float LUT, per `ImageParams.colormap`'s doc comment) — the shader's
 * LUT index is clamped to `[0, 255]` (see `image.wgsl.ts`/`image.glsl.ts`),
 * so a shorter/longer/mis-shaped array would either silently truncate (data
 * loss, no error) or leave the tail out of range; both are caller bugs
 * that are cheap to catch here instead of surfacing as a subtly-wrong
 * render.
 */
function buildColormapTexture(device: Device, colormap: Float32Array | undefined): Texture {
  if (colormap) {
    if (colormap.length !== 256 * 4) {
      throw new Error(
        `renderImage: params.colormap must have exactly 256*4=1024 floats (256x4 RGBA LUT), got ${colormap.length}`,
      );
    }
    const tex = device.createTexture(256, 1, "rgba32float");
    tex.write(colormap);
    return tex;
  }
  const tex = device.createTexture(1, 1, "rgba32float");
  tex.write(new Float32Array([0, 0, 0, 1]));
  return tex;
}

/**
 * Runs the IMAGE render pass: samples `src` through the exposure/colormap/
 * tone-map/output-encode pipeline (see module doc comment) and writes the
 * result to `target`. Allocates (and frees) a per-call colormap texture and
 * bind group — Task 6+ may cache these for a real per-frame render loop;
 * Task 5's scope is correctness/parity, not a hot-path allocation budget.
 */
export function renderImage(device: Device, target: Surface | Texture, src: Texture, params: ImageParams): void {
  const targetFormat = targetFormatOf(target);
  const pipeline = getImagePipeline(device, targetFormat);
  const lut = buildColormapTexture(device, params.isScalar ? params.colormap : undefined);

  const gamma = typeof params.gamma === "number" && params.gamma > 0 ? params.gamma : 0;
  const operatorId = OPERATOR_ID[params.operator] ?? OPERATOR_ID.srgb;

  // Field order MUST match image.wgsl.ts / image.glsl.ts's u_bind2/u_bind3/u_bind4 doc comments.
  const paramsVec = new Float32Array([params.exposureEV, operatorId, gamma, params.isScalar ? 1 : 0]);
  const uvRect = new Float32Array([params.uv.x, params.uv.y, params.uv.w, params.uv.h]);
  const hdrFlag = new Float32Array([params.hdrOut ? 1 : 0]);
  // Field order MUST match image.wgsl.ts / image.glsl.ts's u_bind5 doc
  // comment. Default "linear" when unset — see ImageParams.filter's doc.
  const filterFlag = new Float32Array([params.filter === "nearest" ? 0 : 1]);

  let bindGroup: BindGroup | undefined;
  try {
    bindGroup = device.createBindGroup(pipeline, [
      { binding: 0, resource: src },
      { binding: 1, resource: lut },
      { binding: 2, resource: { uniform: paramsVec } },
      { binding: 3, resource: { uniform: uvRect } },
      { binding: 4, resource: { uniform: hdrFlag } },
      { binding: 5, resource: { uniform: filterFlag } },
    ]);
    device.renderFullscreen(target, pipeline, bindGroup);
  } finally {
    bindGroup?.destroy?.();
    lut.destroy();
  }
}

// ===========================================================================
// COMPARE render pass (Task 7) — split / blend / diff over TWO textures.
// See `engine/shaders/compare.wgsl.ts`'s module doc comment for the shader
// design; this section mirrors `renderImage` above but drives the compare
// pipeline (texA + texB + the 7-binding uniform layout).
// ===========================================================================

/** Diff submodes (`image/diff.ts`'s `DiffMode`) — kept as a local id map so
 *  the engine has no import onto the app's `types.ts`. MUST match
 *  `image/webgl-diff.ts`'s `DIFF_MODE_MAP` order (the shader ports its
 *  `computeDiffChannel` verbatim). */
export type CompareDiffSubmode =
  | "signed"
  | "absolute"
  | "squared"
  | "relative_signed"
  | "relative_absolute"
  | "relative_squared";

const DIFF_SUBMODE_ID: Record<CompareDiffSubmode, number> = {
  signed: 0,
  absolute: 1,
  squared: 2,
  relative_signed: 3,
  relative_absolute: 4,
  relative_squared: 5,
};

/** Diff-colormap index mapping (matches `image/webgl-diff.ts`'s `CMAP_MODE_MAP`
 *  and `colormaps/apply.ts`'s `mode`). */
export type CompareDiffCmapMode = "linear" | "signed" | "positive";
const DIFF_CMAP_MODE_ID: Record<CompareDiffCmapMode, number> = { linear: 0, signed: 1, positive: 2 };

export type CompareMode = "split" | "blend" | "diff";
const COMPARE_MODE_ID: Record<CompareMode, number> = { split: 0, blend: 1, diff: 2 };

export interface CompareParams extends ImageParams {
  /** Composite mode: `split` (draggable divider), `blend` (mix), `diff` (colormapped per-channel diff). */
  mode: CompareMode;
  /** Split-divider screen-space fraction `[0,1]` — reference (texA) shown where `uv.x < split`. */
  split: number;
  /** Blend factor `[0,1]` for `mode:"blend"` — `mix(texA, texB, alpha)`. */
  alpha: number;
  /** Diff submode (`mode:"diff"`). */
  diffSubmode: CompareDiffSubmode;
  /** Diff-colormap index mode (`mode:"diff"` + a `colormap` LUT). Default `"linear"`. */
  diffCmapMode?: CompareDiffCmapMode;
  /** When set (`mode:"diff"`), the average diff indexes this 256x4 RGBA-float LUT
   *  (same convention as `ImageParams.colormap`); when absent the raw per-channel
   *  diff is shown directly. */
  diffColormap?: Float32Array;
}

const comparePipelineCache = new WeakMap<Device, Map<TextureFormat, RenderPipeline>>();

function getComparePipeline(device: Device, targetFormat: TextureFormat): RenderPipeline {
  let byFormat = comparePipelineCache.get(device);
  if (!byFormat) {
    byFormat = new Map();
    comparePipelineCache.set(device, byFormat);
  }
  let pipeline = byFormat.get(targetFormat);
  if (!pipeline) {
    pipeline = device.createRenderPipeline({ shaderWGSL: compareWGSL, targetFormat });
    byFormat.set(targetFormat, pipeline);
  }
  return pipeline;
}

/**
 * Runs the COMPARE render pass: samples `texA` (reference/baseline, the "A"
 * role: left side / alpha=0 endpoint / diff `a` operand — see
 * `media-compare/GpuComparePane.tsx`'s doc comment) and `texB`
 * (foreground/comparison) through the shared exposure/scalar-LUT/tonemap/
 * encode pipeline, then composites them per `params.mode` (split/blend/diff)
 * and writes the result to `target`. Allocates (and frees) a per-call LUT
 * texture + bind group, like `renderImage`.
 *
 * The LUT texture serves BOTH the scalar-image path (when `params.isScalar`
 * -> `params.colormap`) and the diff-colormap path (when `mode:"diff"` +
 * `params.diffColormap`); at most one is used per call, so a single binding
 * is enough. When neither is present a 1x1 placeholder is bound (WebGPU
 * requires every declared texture binding to have a resource — see
 * `renderImage`'s `buildColormapTexture`).
 */
export function renderCompare(
  device: Device,
  target: Surface | Texture,
  texA: Texture,
  texB: Texture,
  params: CompareParams,
): void {
  const targetFormat = targetFormatOf(target);
  const pipeline = getComparePipeline(device, targetFormat);

  const useDiffColormap = params.mode === "diff" && !!params.diffColormap;
  const lutData = params.isScalar ? params.colormap : useDiffColormap ? params.diffColormap : undefined;
  const lut = buildColormapTexture(device, lutData);

  const gamma = typeof params.gamma === "number" && params.gamma > 0 ? params.gamma : 0;
  const operatorId = OPERATOR_ID[params.operator] ?? OPERATOR_ID.srgb;

  // u_bind3: exposureEV, operatorId, gamma, isScalar (IDENTICAL to image.wgsl's u_bind2).
  const paramsVec = new Float32Array([params.exposureEV, operatorId, gamma, params.isScalar ? 1 : 0]);
  // u_bind4: uvRect.xy, uvRect.wh (IDENTICAL to image.wgsl's u_bind3).
  const uvRect = new Float32Array([params.uv.x, params.uv.y, params.uv.w, params.uv.h]);
  // u_bind5: modeId, split, alpha, diffSubmodeId.
  const modeVec = new Float32Array([
    COMPARE_MODE_ID[params.mode],
    params.split,
    params.alpha,
    DIFF_SUBMODE_ID[params.diffSubmode] ?? 0,
  ]);
  // u_bind6: diffCmapModeId, hdrOut, useColormap, unused.
  const cmapVec = new Float32Array([
    DIFF_CMAP_MODE_ID[params.diffCmapMode ?? "linear"] ?? 0,
    params.hdrOut ? 1 : 0,
    useDiffColormap ? 1 : 0,
    0,
  ]);
  // u_bind7: filterMode (0=nearest, 1=linear) — IDENTICAL convention to
  // renderImage's filterFlag / image.wgsl.ts's u_bind5. Default "linear"
  // when unset — see ImageParams.filter's doc.
  const filterFlag = new Float32Array([params.filter === "nearest" ? 0 : 1]);

  let bindGroup: BindGroup | undefined;
  try {
    bindGroup = device.createBindGroup(pipeline, [
      { binding: 0, resource: texA },
      { binding: 1, resource: texB },
      { binding: 2, resource: lut },
      { binding: 3, resource: { uniform: paramsVec } },
      { binding: 4, resource: { uniform: uvRect } },
      { binding: 5, resource: { uniform: modeVec } },
      { binding: 6, resource: { uniform: cmapVec } },
      { binding: 7, resource: { uniform: filterFlag } },
    ]);
    device.renderFullscreen(target, pipeline, bindGroup);
  } finally {
    bindGroup?.destroy?.();
    lut.destroy();
  }
}

// ===========================================================================
// Diff metrics (Task 7): MSE / PSNR / MAE over the raw (un-tonemapped) source
// pixels of texA vs texB — computed via a GPU reduction pass.
// ===========================================================================

export interface DiffMetrics {
  /** Mean squared error, averaged over all RGB channels of the comparison region. */
  mse: number;
  /** Peak signal-to-noise ratio in dB (peak = 1.0); `Infinity` when `mse === 0`. */
  psnr: number;
  /** Mean absolute error, averaged over all RGB channels. */
  mae: number;
}

/** Turns per-channel `sumSq`/`sumAbs` (over `channelCount` RGB samples) into
 *  `{mse, psnr, mae}` — the ONE formula both backends funnel through, so a
 *  GPU-reduced and a CPU-reduced result are identical up to float rounding. */
function metricsFromSums(sumSq: number, sumAbs: number, channelCount: number): DiffMetrics {
  if (channelCount <= 0) return { mse: 0, psnr: Infinity, mae: 0 };
  const mse = sumSq / channelCount;
  const mae = sumAbs / channelCount;
  const psnr = mse <= 0 ? Infinity : 10 * Math.log10(1 / mse);
  return { mse, psnr, mae };
}

/**
 * Computes `{mse, psnr, mae}` between `texA` and `texB` over their overlapping
 * `min(width) x min(height)` region (RGB channels; peak = 1.0). The O(N)
 * per-pixel diffing runs on the GPU (`Device.reduceDiffSumSquaredAbs` ->
 * `engine/shaders/reduce.wgsl.ts`); a `readback()` + CPU-loop path below is
 * kept as a defensive fallback for a device that doesn't implement the GPU
 * reduction (the engine's one backend, WebGPU, always does) — same
 * `metricsFromSums` formula either way, so the two paths agree.
 *
 * Both textures must be readable float/byte textures the active backend's
 * `readback()` supports (the CPU fallback path) — for the metrics use case
 * they are the exact source textures a pane already uploaded.
 */
export async function computeMetrics(device: Device, texA: Texture, texB: Texture): Promise<DiffMetrics> {
  const width = Math.min(texA.width, texB.width);
  const height = Math.min(texA.height, texB.height);
  const channelCount = width * height * 3;
  if (channelCount <= 0) return { mse: 0, psnr: Infinity, mae: 0 };

  if (device.reduceDiffSumSquaredAbs) {
    const { sumSq, sumAbs } = await device.reduceDiffSumSquaredAbs(texA, texB, width, height);
    return metricsFromSums(sumSq, sumAbs, channelCount);
  }

  // Defensive fallback (no known live caller — the engine's one backend,
  // WebGPU, always implements reduceDiffSumSquaredAbs): readback both
  // textures, reduce on the CPU.
  const a = await device.readback(texA);
  const b = await device.readback(texB);
  const normA = a instanceof Uint8Array;
  const normB = b instanceof Uint8Array;
  let sumSq = 0;
  let sumAbs = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ia = (y * texA.width + x) * 4;
      const ib = (y * texB.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const va = (a[ia + c] ?? 0) / (normA ? 255 : 1);
        const vb = (b[ib + c] ?? 0) / (normB ? 255 : 1);
        const d = va - vb;
        sumSq += d * d;
        sumAbs += Math.abs(d);
      }
    }
  }
  return metricsFromSums(sumSq, sumAbs, channelCount);
}
