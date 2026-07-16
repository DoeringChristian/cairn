/**
 * WebGL2 backend of the RHI (`engine/types.ts`) — the reduced/SDR fallback
 * used when `navigator.gpu` (WebGPU) is unavailable. `capabilities.hdr` and
 * `.compute` are always `false`; `createComputePipeline` is intentionally
 * left `undefined` (compute is WebGPU-only — see `types.ts`).
 *
 * ## Bind-group convention (WebGL2 has no native bind groups / descriptor sets)
 * `BindGroupEntry.binding = N` is mapped onto GLSL uniforms BY NAME, not by a
 * native binding slot. Shaders in `engine/shaders/*.glsl.ts` MUST name their
 * uniforms to match whatever binding index a caller's bind group uses:
 *
 *   - A `Texture` entry      -> `uniform sampler2D t_bindN;`, bound to texture
 *     unit N (`gl.activeTexture(gl.TEXTURE0 + N)`, sampler uniform set to N).
 *   - A `Sampler` entry      -> `gl.bindSampler(N, samplerObject)` on the SAME
 *     texture unit N (pairs with a `Texture` entry at the same binding to
 *     override its default filter/wrap without touching the texture object).
 *   - A `{ uniform: ArrayBufferView }` entry -> `uniform ... u_bindN;`. The
 *     GLSL type is inferred from the view's element count (this is a plain
 *     per-uniform mapping, not a std140 uniform BLOCK, despite the "uniform
 *     block" wording in the task brief — simplest thing that lets one
 *     `BindGroupEntry` drive one GLSL uniform):
 *       Float32Array, length 1  -> float           (gl.uniform1fv)
 *       Float32Array, length 2  -> vec2             (gl.uniform2fv)
 *       Float32Array, length 3  -> vec3             (gl.uniform3fv)
 *       Float32Array, length 4  -> vec4             (gl.uniform4fv)
 *       Float32Array, length 16 -> mat4             (gl.uniformMatrix4fv)
 *       Float32Array, other N   -> float[N]         (gl.uniform1fv, array)
 *       Int32Array   -> the matching integer variant (int/ivec2/ivec3/ivec4/
 *                        int[N]; a 16-length Int32Array is NOT special-cased
 *                        as a matrix — GLSL has no imat4).
 *
 * A uniform location that doesn't exist in the compiled program (e.g. the
 * pipeline's shader doesn't sample that binding) is silently skipped — a
 * bind group may be a superset of what a given pipeline actually reads.
 *
 * ## GLSL source convention
 * `shaderGLSL` (the WebGL2 backend NEVER reads `shaderWGSL`) is one string
 * containing both stages split on `#pragma vertex` / `#pragma fragment`
 * markers — see `engine/shaders/passthrough.glsl.ts` for the exact format
 * and the canonical fullscreen-triangle vertex stage every GLSL shader here
 * should reuse.
 *
 * ## WebGL2 context lifecycle (documented limitation)
 * A WebGL2 context is exclusive to the one canvas it was created from — it
 * cannot be shared/re-homed across canvases the way a `GPUDevice` can back
 * many `GPUCanvasContext`s. This device lazily adopts ITS ONE context from
 * whichever comes first:
 *   - a headless resource call (`createTexture`/`createRenderPipeline`/...)
 *     with no prior `createSurface` -> creates an internal 1x1 canvas + a
 *     context solely for offscreen (FBO/texture-backed) rendering. This is
 *     the path the Task 2 readback test exercises (it never calls
 *     `createSurface`).
 *   - `createSurface(canvas, opts)` -> adopts `canvas` itself as the
 *     context-owning canvas (matches the real "acquire a pane" flow where a
 *     surface is created before any textures).
 * Calling `createSurface` a second time with a DIFFERENT canvas once a
 * context is already bound throws — one `Device` instance backs one canvas
 * for its lifetime; `engine/pool.ts` (Task 6) owns creating one
 * `createWebGL2Device()` per on-screen pane/canvas.
 */
import type {
  Device,
  Texture,
  Sampler,
  RenderPipeline,
  BindGroupEntry,
  BindGroup,
  Surface,
  TextureFormat,
  Capabilities,
} from "../types";

interface GLFormatInfo {
  internalFormat: number;
  format: number;
  type: number;
}

function glFormatFor(gl: WebGL2RenderingContext, format: TextureFormat): GLFormatInfo {
  switch (format) {
    case "rgba8unorm":
      return { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
    case "rgba16float":
      return { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    case "rgba32float":
      return { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
    case "r32float":
      return { internalFormat: gl.R32F, format: gl.RED, type: gl.FLOAT };
    default: {
      const exhaustive: never = format;
      throw new Error(`webgl2 device: unknown TextureFormat ${String(exhaustive)}`);
    }
  }
}

function isFloatFormat(format: TextureFormat): boolean {
  return format === "rgba16float" || format === "rgba32float" || format === "r32float";
}

/**
 * Split one `shaderGLSL` string into its vertex/fragment stages on the
 * `#pragma vertex` / `#pragma fragment` marker convention (see module doc).
 */
function parseGLSLPair(source: string): { vertex: string; fragment: string } {
  const vertexMarker = "#pragma vertex";
  const fragmentMarker = "#pragma fragment";
  const vIdx = source.indexOf(vertexMarker);
  const fIdx = source.indexOf(fragmentMarker);
  if (vIdx === -1 || fIdx === -1 || fIdx < vIdx) {
    throw new Error(
      "webgl2 device: shaderGLSL must contain '#pragma vertex' followed by '#pragma fragment' (see engine/shaders/passthrough.glsl.ts)",
    );
  }
  const vertex = source.slice(vIdx + vertexMarker.length, fIdx).trim();
  const fragment = source.slice(fIdx + fragmentMarker.length).trim();
  return { vertex, fragment };
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("webgl2 device: gl.createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`webgl2 device: ${kind} shader compile failed: ${log}\n---source---\n${source}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertexSrc: string, fragmentSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("webgl2 device: gl.createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`webgl2 device: program link failed: ${log}`);
  }
  return program;
}

/** Probe capabilities using a throwaway context — does NOT become the device's context. */
function probeCapabilities(): Capabilities {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const gl = probe.getContext("webgl2") as WebGL2RenderingContext | null;
  if (!gl) {
    throw new Error("webgl2 device: WebGL2 is not supported in this browser");
  }
  const float16 = !!gl.getExtension("EXT_color_buffer_float");
  const loseCtx = gl.getExtension("WEBGL_lose_context");
  loseCtx?.loseContext();
  return { hdr: false, compute: false, float16 };
}

class GLTexture implements Texture {
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  readonly glTexture: WebGLTexture;
  private readonly gl: WebGL2RenderingContext;
  private readonly info: GLFormatInfo;
  private destroyed = false;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, format: TextureFormat) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.format = format;
    this.info = glFormatFor(gl, format);
    const tex = gl.createTexture();
    if (!tex) throw new Error("webgl2 device: gl.createTexture failed");
    this.glTexture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, this.info.internalFormat, width, height, 0, this.info.format, this.info.type, null);
    // Exact-passthrough-friendly defaults: NEAREST + CLAMP_TO_EDGE. A bind
    // group's Sampler entry (if any) overrides these per-draw via
    // gl.bindSampler on the same texture unit.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  write(data: ArrayBufferView): void {
    if (this.destroyed) throw new Error("webgl2 device: write() on a destroyed texture");
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, this.info.format, this.info.type, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.gl.deleteTexture(this.glTexture);
    this.destroyed = true;
  }
}

class GLSampler implements Sampler {
  readonly _s: unknown;
  readonly glSampler: WebGLSampler;

  constructor(gl: WebGL2RenderingContext, opts?: { filter?: "nearest" | "linear" }) {
    const sampler = gl.createSampler();
    if (!sampler) throw new Error("webgl2 device: gl.createSampler failed");
    this.glSampler = sampler;
    const filter = opts?.filter === "nearest" ? gl.NEAREST : gl.LINEAR;
    gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, filter);
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, filter);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._s = sampler;
  }
}

class GLRenderPipeline implements RenderPipeline {
  readonly _p: unknown;
  readonly program: WebGLProgram;
  readonly targetFormat: TextureFormat;

  constructor(program: WebGLProgram, targetFormat: TextureFormat) {
    this.program = program;
    this.targetFormat = targetFormat;
    this._p = program;
  }
}

class GLBindGroup implements BindGroup {
  readonly _b: unknown;
  readonly entries: BindGroupEntry[];

  constructor(entries: BindGroupEntry[]) {
    this.entries = entries;
    this._b = entries;
  }
}

class GLSurface implements Surface {
  readonly canvas: HTMLCanvasElement;
  readonly hdr: boolean = false; // WebGL2 backend is always SDR.

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  configure(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  getCurrentTextureView(): unknown {
    // No native "texture view" concept on WebGL2 — the default framebuffer
    // IS the render target. Returned only for interface compliance; callers
    // should route through Device.renderFullscreen/readback(surface) instead
    // of trying to interpret this value.
    return null;
  }
}

function applyUniformEntry(gl: WebGL2RenderingContext, program: WebGLProgram, binding: number, view: ArrayBufferView): void {
  const loc = gl.getUniformLocation(program, `u_bind${binding}`);
  if (!loc) return; // superset bind group; pipeline doesn't sample this binding.

  if (view instanceof Int32Array) {
    switch (view.length) {
      case 1:
        gl.uniform1iv(loc, view);
        return;
      case 2:
        gl.uniform2iv(loc, view);
        return;
      case 3:
        gl.uniform3iv(loc, view);
        return;
      case 4:
        gl.uniform4iv(loc, view);
        return;
      default:
        gl.uniform1iv(loc, view);
        return;
    }
  }

  // Default: treat as float data (Float32Array, or any other ArrayBufferView
  // reinterpreted as float32 — Float32Array is the documented/expected case).
  const floats = view instanceof Float32Array ? view : new Float32Array(view.buffer, view.byteOffset, view.byteLength / 4);
  switch (floats.length) {
    case 1:
      gl.uniform1fv(loc, floats);
      return;
    case 2:
      gl.uniform2fv(loc, floats);
      return;
    case 3:
      gl.uniform3fv(loc, floats);
      return;
    case 4:
      gl.uniform4fv(loc, floats);
      return;
    case 16:
      gl.uniformMatrix4fv(loc, false, floats);
      return;
    default:
      gl.uniform1fv(loc, floats);
      return;
  }
}

export function createWebGL2Device(): Device {
  let gl: WebGL2RenderingContext | null = null;
  let ownCanvas: HTMLCanvasElement | null = null;
  let fbo: WebGLFramebuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  const capabilities = probeCapabilities();

  function bindContext(ctx: WebGL2RenderingContext, canvas: HTMLCanvasElement): void {
    gl = ctx;
    ownCanvas = canvas;
    fbo = ctx.createFramebuffer();
    vao = ctx.createVertexArray();
    // Opportunistic — improves float texture sampling quality when available;
    // absence never blocks anything (NEAREST filtering always works).
    ctx.getExtension("OES_texture_float_linear");
    ctx.getExtension("EXT_color_buffer_float");
  }

  function ensureGL(): WebGL2RenderingContext {
    if (gl) return gl;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    }) as WebGL2RenderingContext | null;
    if (!ctx) throw new Error("webgl2 device: WebGL2 is not supported in this browser");
    bindContext(ctx, canvas);
    return ctx;
  }

  function bindTargetFBO(gl: WebGL2RenderingContext, target: Surface | Texture): { width: number; height: number; isFloat: boolean } {
    if ("canvas" in target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { width: target.canvas.width, height: target.canvas.height, isFloat: false };
    }
    const tex = target as GLTexture;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.glTexture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `webgl2 device: framebuffer incomplete for target texture (format=${tex.format}, status=0x${status.toString(16)}). ` +
          `Float formats need EXT_color_buffer_float as a render target (capabilities.float16=${capabilities.float16}).`,
      );
    }
    return { width: tex.width, height: tex.height, isFloat: isFloatFormat(tex.format) };
  }

  const device: Device = {
    backend: "webgl2",
    capabilities,

    createTexture(width, height, format) {
      const gl = ensureGL();
      return new GLTexture(gl, width, height, format);
    },

    createSampler(opts) {
      const gl = ensureGL();
      return new GLSampler(gl, opts);
    },

    createRenderPipeline(spec) {
      const gl = ensureGL();
      const { vertex, fragment } = parseGLSLPair(spec.shaderGLSL);
      const program = linkProgram(gl, vertex, fragment);
      return new GLRenderPipeline(program, spec.targetFormat);
    },

    // Compute is WebGPU-only — left undefined per the RHI contract.
    createComputePipeline: undefined,

    createBindGroup(_pipeline, entries) {
      return new GLBindGroup(entries);
    },

    createSurface(canvas, _opts) {
      if (gl && ownCanvas && ownCanvas !== canvas) {
        throw new Error(
          "webgl2 device: this device already owns a WebGL2 context bound to a different canvas. " +
            "WebGL2 has no cross-canvas resource sharing — create one createWebGL2Device() per on-screen " +
            "canvas (see engine/pool.ts).",
        );
      }
      if (!gl) {
        const ctx = canvas.getContext("webgl2", {
          alpha: true,
          antialias: false,
          preserveDrawingBuffer: true,
          premultipliedAlpha: false,
        }) as WebGL2RenderingContext | null;
        if (!ctx) throw new Error("webgl2 device: WebGL2 is not supported on the given canvas");
        bindContext(ctx, canvas);
      }
      // SDR only; best-effort wide-gamut color space when the browser supports it.
      if ("drawingBufferColorSpace" in gl!) {
        try {
          (gl as unknown as { drawingBufferColorSpace: string }).drawingBufferColorSpace = "display-p3";
        } catch {
          // Some browsers/contexts don't allow setting this — SDR rendering still works.
        }
      }
      return new GLSurface(canvas);
    },

    renderFullscreen(target, pipeline, bindGroup) {
      const gl = ensureGL();
      const p = pipeline as GLRenderPipeline;
      const bg = bindGroup as GLBindGroup;
      const { width, height } = bindTargetFBO(gl, target);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(p.program);
      gl.bindVertexArray(vao);

      for (const entry of bg.entries) {
        const resource = entry.resource;
        if (resource instanceof GLTexture) {
          gl.activeTexture(gl.TEXTURE0 + entry.binding);
          gl.bindTexture(gl.TEXTURE_2D, resource.glTexture);
          const loc = gl.getUniformLocation(p.program, `t_bind${entry.binding}`);
          if (loc) gl.uniform1i(loc, entry.binding);
        } else if (resource instanceof GLSampler) {
          gl.bindSampler(entry.binding, resource.glSampler);
        } else {
          applyUniformEntry(gl, p.program, entry.binding, (resource as { uniform: ArrayBufferView }).uniform);
        }
      }

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    async readback(source) {
      const gl = ensureGL();
      const { width, height, isFloat } = bindTargetFBO(gl, source);
      if (isFloat) {
        const out = new Float32Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, out);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return out;
      }
      const out = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    },

    destroy() {
      if (!gl) return;
      if (fbo) gl.deleteFramebuffer(fbo);
      if (vao) gl.deleteVertexArray(vao);
      const loseCtx = gl.getExtension("WEBGL_lose_context");
      loseCtx?.loseContext();
      gl = null;
      ownCanvas = null;
      fbo = null;
      vao = null;
    },
  };

  return device;
}
