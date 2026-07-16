/// <reference types="@webgpu/types" />
/**
 * WebGPU backend of the RHI (`engine/types.ts`) — the PRIMARY, full-featured
 * backend (HDR, compute, float16 all `true`; see `engine/webgl2/device.ts`
 * for the reduced/SDR fallback used when `navigator.gpu` is unavailable).
 *
 * ## Bind-group convention: native WebGPU bind groups, keyed like WebGL2
 * WebGL2 has no native bind groups, so `engine/webgl2/device.ts` maps a
 * `BindGroupEntry.binding = N` ("logical binding N") onto GLSL uniforms BY
 * NAME (`t_bindN` / `u_bindN`). WebGPU DOES have native bind groups/layouts,
 * so this backend uses REAL `GPUBindGroup`s — but to let the exact same
 * `BindGroupEntry[]` drive both backends (the whole point of the harness
 * that proves this), a logical binding N needs a deterministic mapping onto
 * a native `@group(0) @binding(M)` slot. WebGPU (unlike GLSL) requires every
 * resource KIND (texture / sampler / uniform buffer) to occupy its OWN
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
import { configureHDRSurface, configureSDRSurface } from "./surface";

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

class WGPURenderPipeline implements RenderPipeline {
  readonly _p: unknown;
  readonly gpuPipeline: GPURenderPipeline;
  readonly bindings: Map<number, BindingInfo>;
  constructor(gpuPipeline: GPURenderPipeline, bindings: Map<number, BindingInfo>) {
    this.gpuPipeline = gpuPipeline;
    this.bindings = bindings;
    this._p = gpuPipeline;
  }
}

class WGPUComputePipeline implements ComputePipeline {
  readonly _c: unknown;
  readonly gpuPipeline: GPUComputePipeline;
  constructor(gpuPipeline: GPUComputePipeline) {
    this.gpuPipeline = gpuPipeline;
    this._c = gpuPipeline;
  }
}

class WGPUBindGroup implements BindGroup {
  readonly _b: unknown;
  readonly gpuBindGroup: GPUBindGroup;
  constructor(gpuBindGroup: GPUBindGroup) {
    this.gpuBindGroup = gpuBindGroup;
    this._b = gpuBindGroup;
  }
}

class WGPUSurface implements Surface {
  readonly canvas: HTMLCanvasElement;
  readonly hdr: boolean;
  private readonly context: GPUCanvasContext;
  private readonly reconfigure: () => { hdr: boolean };

  constructor(canvas: HTMLCanvasElement, context: GPUCanvasContext, hdr: boolean, reconfigure: () => { hdr: boolean }) {
    this.canvas = canvas;
    this.context = context;
    this.hdr = hdr;
    this.reconfigure = reconfigure;
  }

  configure(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.reconfigure();
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
      const gpuPipeline = gpuDevice.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: "vs_main" },
        fragment: {
          module,
          entryPoint: "fs_main",
          targets: [{ format: gpuFormatFor(spec.targetFormat) }],
        },
        primitive: { topology: "triangle-list" },
      });
      return new WGPURenderPipeline(gpuPipeline, bindings);
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

      // 1. Seed every binding the shader actually declares with a default
      //    resource (zero-filled uniform buffer / shared nearest sampler —
      //    see module doc comment for why this is required on WebGPU).
      for (const [native, info] of p.bindings) {
        if (info.kind === "uniform") {
          const buffer = gpuDevice.createBuffer({
            size: info.sizeBytes,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
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
            resolved.set(native, { binding: native, resource: { buffer } });
          }
        }
      }

      const gpuBindGroup = gpuDevice.createBindGroup({
        layout: p.gpuPipeline.getBindGroupLayout(0),
        entries: Array.from(resolved.values()),
      });
      return new WGPUBindGroup(gpuBindGroup);
    },

    createSurface(canvas, opts) {
      const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (!context) throw new Error("webgpu device: canvas.getContext('webgpu') returned null");
      const wantsHDR = opts.hdr && capabilities.hdr;
      const reconfigure = () =>
        wantsHDR ? configureHDRSurface(context, gpuDevice) : configureSDRSurface(context, gpuDevice);
      const result = reconfigure();
      return new WGPUSurface(canvas, context, result.hdr, reconfigure);
    },

    renderFullscreen(target, pipeline, bindGroup) {
      const p = pipeline as WGPURenderPipeline;
      const bg = bindGroup as WGPUBindGroup;
      const view = targetView(target);
      const { width, height } = targetSize(target);
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
      pass.setPipeline(p.gpuPipeline);
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

    destroy() {
      if (destroyed) return;
      gpuDevice.destroy();
      destroyed = true;
    },
  };

  return device;
}
