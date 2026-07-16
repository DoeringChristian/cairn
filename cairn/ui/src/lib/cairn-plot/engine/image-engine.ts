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
 *   4. operator:  rgb = TONEMAP_OPERATORS[operator](rgb)   (HDR -> [0,1])
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
import { imageGLSL } from "./shaders/image.glsl";

export type ImageOperator = "linear" | "srgb" | "reinhard" | "aces";

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
}

/** Matches TONEMAP_OPERATORS' key order in image/tonemap.ts — see image.wgsl.ts's doc comment. */
const OPERATOR_ID: Record<ImageOperator, number> = { linear: 0, srgb: 1, reinhard: 2, aces: 3 };

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
    pipeline = device.createRenderPipeline({ shaderWGSL: imageWGSL, shaderGLSL: imageGLSL, targetFormat });
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

  let bindGroup: BindGroup | undefined;
  try {
    bindGroup = device.createBindGroup(pipeline, [
      { binding: 0, resource: src },
      { binding: 1, resource: lut },
      { binding: 2, resource: { uniform: paramsVec } },
      { binding: 3, resource: { uniform: uvRect } },
      { binding: 4, resource: { uniform: hdrFlag } },
    ]);
    device.renderFullscreen(target, pipeline, bindGroup);
  } finally {
    bindGroup?.destroy?.();
    lut.destroy();
  }
}
