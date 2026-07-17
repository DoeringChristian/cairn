/// <reference types="@webgpu/types" />
/**
 * WebGPU backend of the RHI (`engine/types.ts`) — the engine's ONLY backend
 * (HDR, compute, float16 all `true`). A reduced/SDR WebGL2 backend used to
 * exist as a fallback for when `navigator.gpu` is unavailable; it was
 * removed in favor of a clean WebGPU-or-legacy-CPU-pane boundary — see
 * `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`. When WebGPU is
 * unavailable, `engine/device.ts`'s `getSharedDevice()` rejects and callers
 * fall back to the legacy CPU/2D-canvas pane, not another GPU backend.
 *
 * ## Bind-group convention: native WebGPU bind groups
 * WebGPU has native bind groups/layouts, so this backend uses REAL
 * `GPUBindGroup`s — a logical binding N (`BindGroupEntry.binding`) needs a
 * deterministic mapping onto a native `@group(0) @binding(M)` slot. WebGPU
 * requires every resource KIND (texture / sampler / uniform buffer) to
 * occupy its OWN
 * binding slot even when a `Texture` and a `Sampler` entry share the same
 * *logical* binding (e.g. `scalebias.wgsl.ts`'s `{binding:0, resource:
 * sampler}` + `{binding:0, resource: texture}, so this backend spreads each
 * logical binding N across THREE native slots, one per kind:
 *
 *   nativeBinding(N, kind) = N*3 + kindOffset
 *     kindOffset: texture=0, sampler=1, uniform=2
 *
 * A WGSL shader authored for this backend (see `engine/shaders/*.wgsl.ts`)
 * declares `@group(0) @binding(nativeBinding(N,kind))` for whatever logical
 * bindings/kinds it actually reads — e.g. logical binding 1's uniform ->
 * `@group(0) @binding(5) var<uniform> u_bind1: vec4<f32>;` (1*3+2=5).
 *
 * `createRenderPipeline` parses the shader source (regex over
 * `@binding(M) var<uniform>? name: type`) to learn which NATIVE bindings the
 * pipeline's auto-derived `GPUBindGroupLayout` actually contains, and caches
 * that as `{nativeBinding -> {kind, sizeBytes?}}` on the pipeline wrapper.
 * `createBindGroup` then:
 *   1. Seeds EVERY declared binding with a default resource (a shared
 *      NEAREST/clamp `GPUSampler` for `sampler` bindings; a fresh
 *      zero-filled `GPUBuffer` for `uniform` bindings — WebGPU buffers are
 *      zero-initialized on creation, so this reproduces the WebGL2
 *      backend's "never-`gl.uniform*`-assigned uniform defaults to zero"
 *      behavior, which WebGPU has no native equivalent for: EVERY declared
 *      binding needs a bound resource or bind-group creation fails
 *      validation).
 *   2. For each caller-supplied `BindGroupEntry`, computes its native
 *      binding and OVERWRITES the default IF the pipeline's shader actually
 *      declares that native binding — entries the shader doesn't read are
 *      silently dropped (mirrors the WebGL2 backend's "uniform location
 *      doesn't exist in the compiled program -> skip", i.e. a bind group
 *      may be a superset of what a given pipeline reads).
 * Every `GPUBuffer` allocated in steps 1/2 is owned by the returned
 * `WGPUBindGroup` (see that class's doc comment) and freed by its
 * `destroy()` — a per-frame render loop MUST call `bindGroup.destroy?.()`
 * once done with a bind group, or one `GPUBuffer` per uniform binding leaks
 * per `createBindGroup()` call.
 *
 * ## SDR surface readback channel order (`bgra8unorm` vs `rgba8unorm`)
 * `configureSDRSurface` (`./surface.ts`) configures the canvas with
 * `navigator.gpu.getPreferredCanvasFormat()`, which is commonly
 * `bgra8unorm` (e.g. Chrome/macOS), NOT `rgba8unorm`. `WGPUSurface.format`
 * records whatever `SurfaceConfigResult.format` the last `configure()` call
 * actually got. `readback()` always returns bytes in RGBA order regardless
 * of the backend's native format — for a `bgra8unorm` surface it swaps the
 * B/R bytes of the raw `copyTextureToBuffer` result back into place before
 * returning. Offscreen `Texture`s never hit this path (`gpuFormatFor`
 * always creates the exact requested `TextureFormat`); an HDR surface is
 * always `rgba16float` (correct order already).
 *
 * ## Texel fetch (`textureLoad`), not filtered `textureSample`
 * See `engine/shaders/passthrough.wgsl.ts`'s module doc comment: our two
 * hand-authored shaders read texels with `textureLoad` (no sampler
 * involved) rather than `textureSample`, to avoid the `unfilterable-float`
 * sample-type restriction WebGPU imposes on `rgba32float`/`r32float`
 * textures. `createSampler`/the `Sampler` resource type are still fully
 * implemented and exercised by the readback harness's bind groups even
 * though these particular shaders don't sample through them.
 *
 * ## The WebGPU-vs-WebGL2 Y-flip
 * `passthrough.wgsl.ts`'s doc comment covers this in detail: WebGL2's
 * `readPixels` row 0 = bottom scanline (GL NDC y=-1), WebGPU's
 * `copyTextureToBuffer` row 0 = top scanline (WebGPU NDC y=+1) — the
 * OPPOSITE relationship. Our two WGSL shaders flip `uv.y` (not `position`)
 * in the vertex stage to cancel this out, so `readback()` returns
 * row-identical results across both backends for the same input texture —
 * exactly the invariant the readback harness checks pixel-for-pixel.
 *
 * ## Adapter/device lifecycle
 * `createWebGPUDevice()` is async (`requestAdapter`/`requestDevice`) — a new
 * adapter+device are requested on every call; Task 6's shared-device pool
 * memoizes this into a page-wide singleton. `destroy()` releases the
 * `GPUDevice` (`device.destroy()`); a destroyed device cannot be reused —
 * callers must not call any other method on this `Device` afterward.
 */
import type {
  Device,
  Texture,
  Sampler,
  RenderPipeline,
  ComputePipeline,
  BindGroupEntry,
  BindGroup,
  Surface,
  TextureFormat,
  Capabilities,
} from "../types";
import { configureHDRSurface, configureSDRSurface, type SurfaceConfigResult } from "./surface";
import { reduceWGSL } from "../shaders/reduce.wgsl";

function gpuFormatFor(format: TextureFormat): GPUTextureFormat {
  switch (format) {
    case "rgba8unorm":
      return "rgba8unorm";
    case "rgba16float":
      return "rgba16float";
    case "rgba32float":
      return "rgba32float";
    case "r32float":
      return "r32float";
    default: {
      const exhaustive: never = format;
      throw new Error(`webgpu device: unknown TextureFormat ${String(exhaustive)}`);
    }
  }
}

function bytesPerPixelFor(format: TextureFormat): number {
  switch (format) {
    case "rgba8unorm":
      return 4;
    case "rgba16float":
      return 8;
    case "rgba32float":
      return 16;
    case "r32float":
      return 4;
    default: {
      const exhaustive: never = format;
      throw new Error(`webgpu device: unknown TextureFormat ${String(exhaustive)}`);
    }
  }
}

/** Half-precision (IEEE 754 binary16) bit pattern -> JS number. */
function halfToFloat(h: number): number {
  const sign = (h & 0x8000) >> 15;
  const exponent = (h & 0x7c00) >> 10;
  const fraction = h & 0x03ff;
  let value: number;
  if (exponent === 0) {
    value = (fraction / 1024) * Math.pow(2, -14);
  } else if (exponent === 0x1f) {
    value = fraction ? NaN : Infinity;
  } else {
    value = (1 + fraction / 1024) * Math.pow(2, exponent - 15);
  }
  return sign ? -value : value;
}

/** Native-binding "kind" — see module doc comment's `nativeBinding` scheme. */
type BindingKind = "texture" | "sampler" | "uniform";

const KIND_OFFSET: Record<BindingKind, number> = { texture: 0, sampler: 1, uniform: 2 };

function nativeBinding(logicalBinding: number, kind: BindingKind): number {
  return logicalBinding * 3 + KIND_OFFSET[kind];
}

interface UniformBindingInfo {
  kind: "uniform";
  sizeBytes: number;
}
interface ResourceBindingInfo {
  kind: "texture" | "sampler";
}
type BindingInfo = UniformBindingInfo | ResourceBindingInfo;

/**
 * `vec4<f32>`/`vec4f` is the only uniform type our Sub-project-1 shaders
 * use (see `engine/shaders/scalebias.wgsl.ts`) — this table is intentionally
 * minimal, not a general WGSL type-size evaluator.
 */
const WGSL_UNIFORM_TYPE_SIZE: Record<string, number> = {
  "f32": 4,
  "i32": 4,
  "u32": 4,
  "vec2<f32>": 8,
  "vec2f": 8,
  "vec3<f32>": 12,
  "vec3f": 12,
  "vec4<f32>": 16,
  "vec4f": 16,
  "mat4x4<f32>": 64,
  "mat4x4f": 64,
};

/**
 * Parse `@group(0) @binding(M) var[<uniform>] name: type;` declarations out
 * of a WGSL module string, returning `{nativeBinding -> BindingInfo}`. Only
 * handles `@group(0)` (this RHI never uses a second bind group) and the
 * plain resource-var forms our hand-written shaders use (texture_2d,
 * sampler, `var<uniform>`).
 */
function parseWGSLBindings(source: string): Map<number, BindingInfo> {
  const result = new Map<number, BindingInfo>();
  const re = /@group\(0\)\s*@binding\((\d+)\)\s*var(<uniform>)?\s+\w+\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const binding = Number(m[1]);
    const isUniform = m[2] !== undefined;
    const typeText = m[3]!.trim();
    if (isUniform) {
      const sizeBytes = WGSL_UNIFORM_TYPE_SIZE[typeText];
      if (sizeBytes === undefined) {
        throw new Error(
          `webgpu device: parseWGSLBindings doesn't know the size of uniform type "${typeText}" (binding ${binding}). ` +
            `Add it to WGSL_UNIFORM_TYPE_SIZE.`,
        );
      }
      result.set(binding, { kind: "uniform", sizeBytes });
    } else if (typeText === "sampler" || typeText === "sampler_comparison") {
      result.set(binding, { kind: "sampler" });
    } else {
      // texture_2d<f32>, texture_2d<u32>, etc.
      result.set(binding, { kind: "texture" });
    }
  }
  return result;
}

class WGPUTexture implements Texture {
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  readonly gpuTexture: GPUTexture;
  private readonly device: GPUDevice;
  private destroyed = false;

  constructor(device: GPUDevice, width: number, height: number, format: TextureFormat) {
    this.device = device;
    this.width = width;
    this.height = height;
    this.format = format;
    this.gpuTexture = device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: gpuFormatFor(format),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  write(data: ArrayBufferView): void {
    if (this.destroyed) throw new Error("webgpu device: write() on a destroyed texture");
    const bytesPerRow = this.width * bytesPerPixelFor(this.format);
    this.device.queue.writeTexture(
      { texture: this.gpuTexture },
      data as BufferSource,
      { bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height, depthOrArrayLayers: 1 },
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.gpuTexture.destroy();
    this.destroyed = true;
  }
}

class WGPUSampler implements Sampler {
  readonly _s: unknown;
  readonly gpuSampler: GPUSampler;
  constructor(gpuSampler: GPUSampler) {
    this.gpuSampler = gpuSampler;
    this._s = gpuSampler;
  }
}

/**
 * `gpuPipeline`'s fragment target is baked to whatever `GPUTextureFormat`
 * `createRenderPipeline`'s `spec.targetFormat` mapped to (via `gpuFormatFor`)
 * — always one of the four `TextureFormat`s, NEVER `bgra8unorm`. But
 * `renderFullscreen` can be asked to draw onto a `Surface` whose ACTUAL
 * native format (`WGPUSurface.format`) is `bgra8unorm` (the common
 * `getPreferredCanvasFormat()` result — see `readback()`'s "SDR surface
 * readback channel order" doc note). A `GPURenderPipeline`'s fragment
 * target format must EXACTLY match its render pass's color attachment
 * format or WebGPU raises a validation error and the draw is silently
 * dropped (empirically confirmed while adding the surface-channel-order
 * regression test — this was a real, previously-unexercised gap: SDR-surface
 * rendering was silently broken any time the preferred format wasn't
 * `rgba8unorm`, independent of the readback byte-order bug).
 *
 * `pipelineFor(format)` lazily compiles+caches a same-shader pipeline
 * VARIANT targeting a different format, all sharing ONE EXPLICIT
 * `bindGroupLayout` (built by `createRenderPipeline` from the parsed
 * `BindingInfo`, NOT `layout: 'auto'`) so a `BindGroup` created once against
 * that shared layout stays valid across every variant. An auto-derived
 * layout (`gpuPipeline.getBindGroupLayout(0)`) can NOT be reused this way —
 * empirically, Chrome's WebGPU implementation rejects
 * `createPipelineLayout({bindGroupLayouts:[autoLayout]})` with "it was
 * created as part of a pipeline's default layout", so every variant (the
 * primary pipeline included) is built with `layout: pipelineLayout`
 * (explicit), never `'auto'`.
 */
class WGPURenderPipeline implements RenderPipeline {
  readonly _p: unknown;
  readonly gpuPipeline: GPURenderPipeline;
  readonly bindings: Map<number, BindingInfo>;
  readonly bindGroupLayout: GPUBindGroupLayout;
  private readonly variants: Map<GPUTextureFormat, GPURenderPipeline>;
  private readonly buildVariant: (format: GPUTextureFormat) => GPURenderPipeline;

  constructor(
    gpuPipeline: GPURenderPipeline,
    bindings: Map<number, BindingInfo>,
    bindGroupLayout: GPUBindGroupLayout,
    primaryFormat: GPUTextureFormat,
    buildVariant: (format: GPUTextureFormat) => GPURenderPipeline,
  ) {
    this.gpuPipeline = gpuPipeline;
    this.bindings = bindings;
    this.bindGroupLayout = bindGroupLayout;
    this.buildVariant = buildVariant;
    this.variants = new Map([[primaryFormat, gpuPipeline]]);
    this._p = gpuPipeline;
  }

  pipelineFor(format: GPUTextureFormat): GPURenderPipeline {
    let variant = this.variants.get(format);
    if (!variant) {
      variant = this.buildVariant(format);
      this.variants.set(format, variant);
    }
    return variant;
  }
}

/**
 * Builds an EXPLICIT `GPUBindGroupLayout` from the `BindingInfo` map
 * `parseWGSLBindings` produces — see `WGPURenderPipeline`'s doc comment for
 * why this replaces `layout: 'auto'` for render pipelines (auto-derived
 * layouts can't be shared across the format-variant pipelines
 * `renderFullscreen` needs for `Surface` targets). `texture` bindings always
 * declare `sampleType: 'unfilterable-float'` — per `passthrough.wgsl.ts`'s
 * doc comment, every texture-kind binding is read via `textureLoad` (never
 * `textureSample`), and `'unfilterable-float'` is compatible with binding
 * ANY float-ish texture format (filterable or not), so this is never overly
 * restrictive for how these shaders actually sample. `sampler` bindings
 * (declared as `'filtering'`) are similarly unexercised by either
 * hand-authored shader today — see `WGSL_UNIFORM_TYPE_SIZE`'s doc comment
 * for the same "intentionally minimal" caveat.
 */
function buildExplicitBindGroupLayout(gpuDevice: GPUDevice, bindings: Map<number, BindingInfo>): GPUBindGroupLayout {
  const entries: GPUBindGroupLayoutEntry[] = [];
  for (const [native, info] of bindings) {
    if (info.kind === "uniform") {
      entries.push({ binding: native, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
    } else if (info.kind === "sampler") {
      entries.push({ binding: native, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } });
    } else {
      entries.push({ binding: native, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } });
    }
  }
  return gpuDevice.createBindGroupLayout({ entries });
}

class WGPUComputePipeline implements ComputePipeline {
  readonly _c: unknown;
  readonly gpuPipeline: GPUComputePipeline;
  constructor(gpuPipeline: GPUComputePipeline) {
    this.gpuPipeline = gpuPipeline;
    this._c = gpuPipeline;
  }
}

/**
 * Owns the `GPUBuffer`(s) `createBindGroup` allocates for `{uniform}`
 * bindings (both the default zero-fill buffers and the caller-supplied-value
 * buffers — see module doc comment's `createBindGroup` section). `destroy()`
 * releases them; callers that rebuild bind groups per frame (a real render
 * loop, Task 6+) MUST call this once a bind group is no longer needed, or
 * these buffers leak until `Device.destroy()`. Idempotent — a second
 * `destroy()` call is a no-op, matching `WGPUTexture`/`Device`'s convention.
 */
class WGPUBindGroup implements BindGroup {
  readonly _b: unknown;
  readonly gpuBindGroup: GPUBindGroup;
  private readonly ownedBuffers: GPUBuffer[];
  private destroyed = false;

  constructor(gpuBindGroup: GPUBindGroup, ownedBuffers: GPUBuffer[]) {
    this.gpuBindGroup = gpuBindGroup;
    this.ownedBuffers = ownedBuffers;
    this._b = gpuBindGroup;
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const buffer of this.ownedBuffers) buffer.destroy();
    this.destroyed = true;
  }
}

class WGPUSurface implements Surface {
  readonly canvas: HTMLCanvasElement;
  hdr: boolean;
  /**
   * The ACTUAL `GPUTextureFormat` this surface's canvas context is
   * configured with (from `SurfaceConfigResult.format`) — NOT necessarily
   * `"rgba8unorm"` for an SDR surface. `configureSDRSurface` uses
   * `navigator.gpu.getPreferredCanvasFormat()`, which is commonly
   * `"bgra8unorm"` on Chrome/macOS. `Device.readback` reads this to know
   * whether it must swap the B/R bytes of a raw `copyTextureToBuffer` result
   * back into the RHI's RGBA contract. Non-interface escape hatch, like
   * `getCurrentGPUTexture()` below.
   */
  format: GPUTextureFormat;
  private readonly context: GPUCanvasContext;
  private readonly reconfigure: () => SurfaceConfigResult;

  constructor(
    canvas: HTMLCanvasElement,
    context: GPUCanvasContext,
    initial: SurfaceConfigResult,
    reconfigure: () => SurfaceConfigResult,
  ) {
    this.canvas = canvas;
    this.context = context;
    this.hdr = initial.hdr;
    this.format = initial.format;
    this.reconfigure = reconfigure;
  }

  configure(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    const result = this.reconfigure();
    this.hdr = result.hdr;
    this.format = result.format;
  }

  getCurrentTextureView(): unknown {
    return this.context.getCurrentTexture().createView();
  }

  /** Non-interface escape hatch used only by `Device.readback` (below). */
  getCurrentGPUTexture(): GPUTexture {
    return this.context.getCurrentTexture();
  }
}

function isSurface(target: Surface | Texture): target is Surface {
  return "canvas" in target;
}

export async function createWebGPUDevice(): Promise<Device> {
  if (!("gpu" in navigator) || !navigator.gpu) {
    throw new Error("webgpu device: navigator.gpu is not available in this browser");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("webgpu device: requestAdapter() returned null");
  const gpuDevice = await adapter.requestDevice();

  // WebGPU is the PRIMARY/full-featured backend — all three capabilities
  // are true unconditionally (unlike WebGL2's probed float16/hdr=false).
  const capabilities: Capabilities = { hdr: true, compute: true, float16: true };

  let defaultSampler: GPUSampler | null = null;
  function getDefaultSampler(): GPUSampler {
    if (!defaultSampler) {
      defaultSampler = gpuDevice.createSampler({
        magFilter: "nearest",
        minFilter: "nearest",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
    }
    return defaultSampler;
  }

  function targetView(target: Surface | Texture): GPUTextureView {
    if (isSurface(target)) {
      return (target as WGPUSurface).getCurrentTextureView() as GPUTextureView;
    }
    return (target as WGPUTexture).gpuTexture.createView();
  }

  function targetSize(target: Surface | Texture): { width: number; height: number } {
    if (isSurface(target)) {
      return { width: target.canvas.width, height: target.canvas.height };
    }
    const tex = target as WGPUTexture;
    return { width: tex.width, height: tex.height };
  }

  let destroyed = false;

  // Lazily-built, memoized (one per GPUDevice, not per call) compute pipeline
  // for `reduceDiffSumSquaredAbs` — see `engine/shaders/reduce.wgsl.ts`'s
  // module doc comment for the reduction design.
  const REDUCE_WORKGROUP_SIZE = 256;
  let reducePipeline: GPUComputePipeline | null = null;
  let reduceBindGroupLayout: GPUBindGroupLayout | null = null;
  function getReducePipeline(): { pipeline: GPUComputePipeline; layout: GPUBindGroupLayout } {
    if (!reducePipeline || !reduceBindGroupLayout) {
      const module = gpuDevice.createShaderModule({ code: reduceWGSL });
      reduceBindGroupLayout = gpuDevice.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        ],
      });
      const layout = gpuDevice.createPipelineLayout({ bindGroupLayouts: [reduceBindGroupLayout] });
      reducePipeline = gpuDevice.createComputePipeline({
        layout,
        compute: { module, entryPoint: "cs_main" },
      });
    }
    return { pipeline: reducePipeline, layout: reduceBindGroupLayout };
  }

  const device: Device = {
    backend: "webgpu",
    capabilities,

    createTexture(width, height, format) {
      return new WGPUTexture(gpuDevice, width, height, format);
    },

    createSampler(opts) {
      const filter = opts?.filter === "linear" ? "linear" : "nearest";
      const gpuSampler = gpuDevice.createSampler({
        magFilter: filter,
        minFilter: filter,
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
      return new WGPUSampler(gpuSampler);
    },

    createRenderPipeline(spec) {
      const module = gpuDevice.createShaderModule({ code: spec.shaderWGSL });
      const bindings = parseWGSLBindings(spec.shaderWGSL);
      const primaryFormat = gpuFormatFor(spec.targetFormat);
      // Explicit (never 'auto') bind group layout, shared by the primary
      // pipeline and every lazily-built format variant — see
      // `WGPURenderPipeline`'s doc comment for why 'auto' can't be reused
      // across pipelines here.
      const bindGroupLayout = buildExplicitBindGroupLayout(gpuDevice, bindings);
      const pipelineLayout = gpuDevice.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const buildVariant = (format: GPUTextureFormat): GPURenderPipeline =>
        gpuDevice.createRenderPipeline({
          layout: pipelineLayout,
          vertex: { module, entryPoint: "vs_main" },
          fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
        });
      const gpuPipeline = buildVariant(primaryFormat);
      return new WGPURenderPipeline(gpuPipeline, bindings, bindGroupLayout, primaryFormat, buildVariant);
    },

    createComputePipeline(spec) {
      // Minimal implementation — compute is not exercised by the Task 2/3
      // readback harness; full use (image/metrics reduction passes) lands
      // in later tasks (§5, §7 of the sub-project plan).
      const module = gpuDevice.createShaderModule({ code: spec.shaderWGSL });
      const gpuPipeline = gpuDevice.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "cs_main" },
      });
      return new WGPUComputePipeline(gpuPipeline);
    },

    createBindGroup(pipeline, entries) {
      const p = pipeline as WGPURenderPipeline;
      const resolved = new Map<number, GPUBindGroupEntry>();
      // Every `GPUBuffer` allocated below (defaults AND caller-value
      // buffers) is owned by the returned `WGPUBindGroup` and freed by its
      // `destroy()` — see that class's doc comment. `createBindGroup` itself
      // never reuses a buffer across calls (each call gets its own set), so
      // callers driving a per-frame render loop must destroy the bind group
      // once done with it to avoid leaking one `GPUBuffer` per uniform
      // binding per frame.
      const ownedBuffers: GPUBuffer[] = [];

      // 1. Seed every binding the shader actually declares with a default
      //    resource (zero-filled uniform buffer / shared nearest sampler —
      //    see module doc comment for why this is required on WebGPU).
      for (const [native, info] of p.bindings) {
        if (info.kind === "uniform") {
          const buffer = gpuDevice.createBuffer({
            size: info.sizeBytes,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
          ownedBuffers.push(buffer);
          resolved.set(native, { binding: native, resource: { buffer } });
        } else if (info.kind === "sampler") {
          resolved.set(native, { binding: native, resource: getDefaultSampler() });
        }
        // "texture" bindings have no sensible default; must come from `entries`.
      }

      // 2. Overwrite defaults with the caller's explicit entries, for
      //    whichever ones the shader actually declares (superset bind
      //    groups are allowed — unused entries are silently dropped, same
      //    as the WebGL2 backend).
      for (const entry of entries as BindGroupEntry[]) {
        const resource = entry.resource;
        if (resource instanceof WGPUTexture) {
          const native = nativeBinding(entry.binding, "texture");
          if (p.bindings.has(native)) {
            resolved.set(native, { binding: native, resource: resource.gpuTexture.createView() });
          }
        } else if (resource instanceof WGPUSampler) {
          const native = nativeBinding(entry.binding, "sampler");
          if (p.bindings.has(native)) {
            resolved.set(native, { binding: native, resource: resource.gpuSampler });
          }
        } else {
          const native = nativeBinding(entry.binding, "uniform");
          const info = p.bindings.get(native);
          if (info && info.kind === "uniform") {
            const view = (resource as { uniform: ArrayBufferView }).uniform;
            const buffer = gpuDevice.createBuffer({
              size: Math.max(info.sizeBytes, view.byteLength),
              usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            gpuDevice.queue.writeBuffer(buffer, 0, view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
            // The default buffer allocated for this native binding in step 1
            // is now unreferenced by `resolved` (about to be overwritten
            // below) but was already pushed to `ownedBuffers` — it still
            // gets destroyed alongside the replacement, just one call early.
            ownedBuffers.push(buffer);
            resolved.set(native, { binding: native, resource: { buffer } });
          }
        }
      }

      const gpuBindGroup = gpuDevice.createBindGroup({
        layout: p.bindGroupLayout,
        entries: Array.from(resolved.values()),
      });
      return new WGPUBindGroup(gpuBindGroup, ownedBuffers);
    },

    createSurface(canvas, opts) {
      const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!context) throw new Error("webgpu device: canvas.getContext('webgpu') returned null");
      const wantsHDR = opts.hdr && capabilities.hdr;
      const reconfigure = () =>
        wantsHDR ? configureHDRSurface(context, gpuDevice) : configureSDRSurface(context, gpuDevice);
      const result = reconfigure();
      return new WGPUSurface(canvas, context, result, reconfigure);
    },

    renderFullscreen(target, pipeline, bindGroup) {
      const p = pipeline as WGPURenderPipeline;
      const bg = bindGroup as WGPUBindGroup;
      const view = targetView(target);
      const { width, height } = targetSize(target);
      // The pipeline's fragment target format must EXACTLY match the actual
      // attachment format or WebGPU raises a validation error and silently
      // drops the draw — see `WGPURenderPipeline`'s doc comment. A `Surface`
      // can be `bgra8unorm`-native even though `p.gpuPipeline`'s default
      // format is always one of the four `TextureFormat`s (never
      // `bgra8unorm`), so resolve the correct pipeline VARIANT for
      // whatever `target` actually is.
      const nativeFormat: GPUTextureFormat = isSurface(target)
        ? (target as WGPUSurface).format
        : gpuFormatFor((target as WGPUTexture).format);
      const gpuPipeline = p.pipelineFor(nativeFormat);
      const encoder = gpuDevice.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(gpuPipeline);
      pass.setBindGroup(0, bg.gpuBindGroup);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.draw(3);
      pass.end();
      gpuDevice.queue.submit([encoder.finish()]);
    },

    async readback(source) {
      const surfaceMode = isSurface(source);
      const { width, height } = targetSize(source);
      const format: TextureFormat = surfaceMode ? ((source as WGPUSurface).hdr ? "rgba16float" : "rgba8unorm") : (source as WGPUTexture).format;
      // The RHI's `readback()` contract is always RGBA byte order, but an
      // SDR `Surface`'s ACTUAL native format (`WGPUSurface.format`, set from
      // `configureSDRSurface`'s `navigator.gpu.getPreferredCanvasFormat()`)
      // is commonly `bgra8unorm`, not `rgba8unorm` — see module doc's "SDR
      // surface readback channel order" note. `copyTextureToBuffer` below
      // copies raw texel bytes with no reordering, so a `bgra8unorm` source
      // needs its B/R bytes swapped back into RGBA order after the copy.
      // Offscreen `Texture`s are never `bgra8unorm` (`gpuFormatFor` only
      // ever produces the exact `TextureFormat` requested), and an HDR
      // surface is always `rgba16float` (already correct byte order) — so
      // only this one case needs the swap.
      const needsBGRASwap = surfaceMode && (source as WGPUSurface).format === "bgra8unorm";
      const sourceTexture: GPUTexture = surfaceMode
        ? (source as WGPUSurface).getCurrentGPUTexture()
        : (source as WGPUTexture).gpuTexture;

      const bpp = bytesPerPixelFor(format);
      const unpaddedBytesPerRow = width * bpp;
      const align = 256;
      const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / align) * align;
      const bufferSize = paddedBytesPerRow * height;

      const readBuffer = gpuDevice.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = gpuDevice.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: sourceTexture },
        { buffer: readBuffer, bytesPerRow: paddedBytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      );
      gpuDevice.queue.submit([encoder.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint8Array(readBuffer.getMappedRange());
      const tight = new Uint8Array(unpaddedBytesPerRow * height);
      for (let row = 0; row < height; row++) {
        const src = row * paddedBytesPerRow;
        const dst = row * unpaddedBytesPerRow;
        tight.set(mapped.subarray(src, src + unpaddedBytesPerRow), dst);
      }
      readBuffer.unmap();
      readBuffer.destroy();

      if (format === "rgba8unorm") {
        if (needsBGRASwap) {
          for (let i = 0; i < tight.length; i += 4) {
            const b = tight[i]!;
            const r = tight[i + 2]!;
            tight[i] = r;
            tight[i + 2] = b;
          }
        }
        return tight;
      }
      if (format === "rgba16float") {
        const half = new Uint16Array(tight.buffer, tight.byteOffset, tight.byteLength / 2);
        const out = new Float32Array(half.length);
        for (let i = 0; i < half.length; i++) out[i] = halfToFloat(half[i]!);
        return out;
      }
      // rgba32float / r32float: raw bytes are already IEEE754 float32.
      return new Float32Array(tight.buffer, tight.byteOffset, tight.byteLength / 4);
    },

    async reduceDiffSumSquaredAbs(texA, texB, width, height) {
      const a = texA as WGPUTexture;
      const b = texB as WGPUTexture;
      const count = Math.max(0, width * height);
      const numWorkgroups = Math.max(1, Math.ceil(count / REDUCE_WORKGROUP_SIZE));
      const { pipeline, layout } = getReducePipeline();

      const partialSize = numWorkgroups * 2 * 4; // 2 f32 (sumSq, sumAbs) per workgroup
      const partialBuffer = gpuDevice.createBuffer({
        size: partialSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const dimsBuffer = gpuDevice.createBuffer({
        size: 16, // Dims struct: 4x u32, std140/std430-aligned
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      gpuDevice.queue.writeBuffer(dimsBuffer, 0, new Uint32Array([Math.max(1, width), Math.max(1, height), count, 0]));

      const bindGroup = gpuDevice.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: a.gpuTexture.createView() },
          { binding: 1, resource: b.gpuTexture.createView() },
          { binding: 2, resource: { buffer: partialBuffer } },
          { binding: 3, resource: { buffer: dimsBuffer } },
        ],
      });

      const readBuffer = gpuDevice.createBuffer({
        size: partialSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const encoder = gpuDevice.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(numWorkgroups);
      pass.end();
      encoder.copyBufferToBuffer(partialBuffer, 0, readBuffer, 0, partialSize);
      gpuDevice.queue.submit([encoder.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Float32Array(readBuffer.getMappedRange());
      const partial = mapped.slice(); // copy out before unmap invalidates `mapped`
      readBuffer.unmap();
      readBuffer.destroy();
      partialBuffer.destroy();
      dimsBuffer.destroy();

      let sumSq = 0;
      let sumAbs = 0;
      for (let i = 0; i < numWorkgroups; i++) {
        sumSq += partial[i * 2]!;
        sumAbs += partial[i * 2 + 1]!;
      }
      return { sumSq, sumAbs };
    },

    destroy() {
      if (destroyed) return;
      gpuDevice.destroy();
      destroyed = true;
    },

    // WebGPU's `createSurface` is always a safe, idempotent re-configure
    // (see this module's doc comment) — there is no WebGL2-style "canvas
    // already has a lost context bound to it" state to recover from, so
    // this is always `false`. See `types.ts`'s `Device.isContextLost` doc.
    isContextLost() {
      return false;
    },
  };

  return device;
}
