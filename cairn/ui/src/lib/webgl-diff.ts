/**
 * WebGL 2 image diff and colormap computation.
 *
 * Uses a fragment shader on a full-screen quad to compute diff + colormap
 * per pixel. Works in all modern browsers — no secure context or Vulkan required.
 *
 * The result is rendered to an offscreen canvas and read back via getImageData.
 */

import type { DiffMode } from "./image-diff";

const DIFF_MODE_MAP: Record<DiffMode, number> = {
  signed: 0,
  absolute: 1,
  squared: 2,
  relative_signed: 3,
  relative_absolute: 4,
  relative_squared: 5,
};

const CMAP_MODE_MAP: Record<string, number> = {
  linear: 0,
  signed: 1,
  positive: 2,
};

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_baseline;
uniform sampler2D u_other;
uniform sampler2D u_lut;       // 256x1 RGB lookup texture
uniform int u_diff_mode;
uniform int u_cmap_mode;
uniform bool u_use_colormap;

in vec2 v_uv;
out vec4 fragColor;

float computeDiffChannel(float a, float b, int mode) {
  float diff = a - b;
  float absDiff = abs(diff);
  float denom = max(a, 1.0 / 255.0);
  if (mode == 0) return (diff + 1.0) / 2.0;                        // signed
  if (mode == 1) return absDiff;                                     // absolute
  if (mode == 2) return diff * diff;                                 // squared
  if (mode == 3) return (diff / denom + 1.0) / 2.0;                 // relative_signed
  if (mode == 4) return absDiff / denom;                             // relative_absolute
  if (mode == 5) return (diff * diff) / (denom * denom);             // relative_squared
  return absDiff;
}

void main() {
  vec4 base = texture(u_baseline, v_uv);
  vec4 other = texture(u_other, v_uv);

  float dr = computeDiffChannel(base.r, other.r, u_diff_mode);
  float dg = computeDiffChannel(base.g, other.g, u_diff_mode);
  float db = computeDiffChannel(base.b, other.b, u_diff_mode);

  vec3 result = clamp(vec3(dr, dg, db), 0.0, 1.0);

  if (u_use_colormap) {
    float avg = (result.r + result.g + result.b) / 3.0;
    float idx;
    if (u_cmap_mode == 2) {
      // positive: map [0,1] -> [0.5, 1.0]
      idx = 0.5 + avg * 0.5;
    } else {
      idx = avg;
    }
    result = texture(u_lut, vec2(clamp(idx, 0.0, 1.0), 0.5)).rgb;
  }

  fragColor = vec4(result, 1.0);
}`;

// ---------------------------------------------------------------------------
// Cached GL state
// ---------------------------------------------------------------------------

let glCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | null = null;
let program: WebGLProgram | null = null;
let vao: WebGLVertexArrayObject | null = null;

function getGL(): WebGL2RenderingContext | null {
  if (gl) return gl;
  try {
    // Prefer OffscreenCanvas for no-DOM rendering
    if (typeof OffscreenCanvas !== "undefined") {
      glCanvas = new OffscreenCanvas(1, 1);
    } else {
      glCanvas = document.createElement("canvas");
    }
    gl = glCanvas.getContext("webgl2", { preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) {
      console.warn("[cairn] WebGL 2 not available");
      return null;
    }
    // Compile shaders + program
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERTEX_SRC);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error("[cairn] WebGL vertex shader:", gl.getShaderInfoLog(vs));
      return null;
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FRAGMENT_SRC);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error("[cairn] WebGL fragment shader:", gl.getShaderInfoLog(fs));
      return null;
    }
    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[cairn] WebGL program link:", gl.getProgramInfoLog(program));
      return null;
    }
    // Full-screen quad VAO
    vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    console.info("[cairn] WebGL 2 diff initialized");
    return gl;
  } catch (err) {
    console.warn("[cairn] WebGL 2 init failed:", err);
    return null;
  }
}

function uploadTexture(g: WebGL2RenderingContext, img: ImageData, unit: number): WebGLTexture {
  const tex = g.createTexture()!;
  g.activeTexture(g.TEXTURE0 + unit);
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, img.width, img.height, 0, g.RGBA, g.UNSIGNED_BYTE, img.data);
  return tex;
}

function uploadLUT(g: WebGL2RenderingContext, lut: Uint8Array, unit: number): WebGLTexture {
  // LUT is 256*3 bytes. Pack into a 256x1 RGBA texture.
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgba[i * 4] = lut[i * 3]!;
    rgba[i * 4 + 1] = lut[i * 3 + 1]!;
    rgba[i * 4 + 2] = lut[i * 3 + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  const tex = g.createTexture()!;
  g.activeTexture(g.TEXTURE0 + unit);
  g.bindTexture(g.TEXTURE_2D, tex);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
  g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, 256, 1, 0, g.RGBA, g.UNSIGNED_BYTE, rgba);
  return tex;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WebGLDiffOptions {
  diffMode: DiffMode;
  colormap: Uint8Array | null;
  cmapMode: "linear" | "signed" | "positive";
}

export function webglComputeDiff(
  baseline: ImageData,
  other: ImageData,
  opts: WebGLDiffOptions,
): ImageData | null {
  const g = getGL();
  if (!g || !program || !vao) return null;

  const w = Math.min(baseline.width, other.width);
  const h = Math.min(baseline.height, other.height);

  // Resize canvas
  if (glCanvas) {
    glCanvas.width = w;
    glCanvas.height = h;
  }
  g.viewport(0, 0, w, h);

  // Upload textures
  const baseTex = uploadTexture(g, baseline, 0);
  const otherTex = uploadTexture(g, other, 1);

  // LUT texture (or dummy)
  let lutTex: WebGLTexture | null = null;
  if (opts.colormap) {
    lutTex = uploadLUT(g, opts.colormap, 2);
  } else {
    // Dummy 1x1 texture
    lutTex = g.createTexture()!;
    g.activeTexture(g.TEXTURE2);
    g.bindTexture(g.TEXTURE_2D, lutTex);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  // Set uniforms
  g.useProgram(program);
  g.uniform1i(g.getUniformLocation(program, "u_baseline"), 0);
  g.uniform1i(g.getUniformLocation(program, "u_other"), 1);
  g.uniform1i(g.getUniformLocation(program, "u_lut"), 2);
  g.uniform1i(g.getUniformLocation(program, "u_diff_mode"), DIFF_MODE_MAP[opts.diffMode]);
  g.uniform1i(g.getUniformLocation(program, "u_cmap_mode"), CMAP_MODE_MAP[opts.cmapMode] ?? 0);
  g.uniform1i(g.getUniformLocation(program, "u_use_colormap"), opts.colormap ? 1 : 0);

  // Draw
  g.bindVertexArray(vao);
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  g.bindVertexArray(null);

  // Read back
  const pixels = new Uint8Array(w * h * 4);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, pixels);

  // WebGL renders bottom-up; flip vertically
  const result = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    const dstRow = y * w * 4;
    result.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
  }

  // Cleanup textures
  g.deleteTexture(baseTex);
  g.deleteTexture(otherTex);
  g.deleteTexture(lutTex);

  return result;
}

export function isWebGL2Available(): boolean {
  return getGL() !== null;
}
