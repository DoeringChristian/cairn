/**
 * WebGPU-accelerated image diff and colormap computation.
 *
 * Falls back to CPU (image-diff.ts) when WebGPU is unavailable.
 * The GPU path runs diff + colormap in a single compute shader dispatch.
 */

import type { DiffMode } from "./image-diff";

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

let gpuDevice: GPUDevice | null = null;
let gpuInitPromise: Promise<GPUDevice | null> | null = null;

async function initGPU(): Promise<GPUDevice | null> {
  if (!navigator.gpu) {
    const isSecure = window.isSecureContext;
    console.warn(
      `[cairn] WebGPU not available: navigator.gpu is undefined.` +
      (isSecure ? "" : ` This page is NOT a secure context (${window.location.protocol}//${window.location.host}). WebGPU requires HTTPS or localhost. Try accessing via http://localhost:${window.location.port}`)
    );
    return null;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn("[cairn] WebGPU: requestAdapter returned null");
      return null;
    }
    const device = await adapter.requestDevice();
    console.info("[cairn] WebGPU device initialized:", adapter.info);
    return device;
  } catch (err) {
    console.warn("[cairn] WebGPU init failed:", err);
    return null;
  }
}

export async function getGPUDevice(): Promise<GPUDevice | null> {
  if (gpuDevice) return gpuDevice;
  if (!gpuInitPromise) gpuInitPromise = initGPU();
  gpuDevice = await gpuInitPromise;
  return gpuDevice;
}

export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

// ---------------------------------------------------------------------------
// Diff mode encoding for the shader
// ---------------------------------------------------------------------------

const DIFF_MODE_MAP: Record<DiffMode, number> = {
  signed: 0,
  absolute: 1,
  squared: 2,
  relative_signed: 3,
  relative_absolute: 4,
  relative_squared: 5,
};

// Colormap mode encoding
const CMAP_MODE_MAP: Record<string, number> = {
  linear: 0,
  signed: 1,
  positive: 2,
};

// ---------------------------------------------------------------------------
// WGSL Compute Shader
// ---------------------------------------------------------------------------

const SHADER_CODE = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  diff_mode: u32,    // 0=signed, 1=absolute, 2=squared, 3=rel_signed, 4=rel_absolute, 5=rel_squared
  cmap_mode: u32,    // 0=linear, 1=signed, 2=positive
  use_colormap: u32, // 0=no, 1=yes
  _pad: u32,
}

@group(0) @binding(0) var<storage, read> baseline: array<u32>;
@group(0) @binding(1) var<storage, read> other: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read> lut: array<u32>; // 256 * 3 RGB values packed

fn unpack_rgba(packed: u32) -> vec4<f32> {
  return vec4<f32>(
    f32(packed & 0xFFu),
    f32((packed >> 8u) & 0xFFu),
    f32((packed >> 16u) & 0xFFu),
    f32((packed >> 24u) & 0xFFu),
  );
}

fn pack_rgba(r: f32, g: f32, b: f32, a: f32) -> u32 {
  return u32(clamp(r, 0.0, 255.0))
       | (u32(clamp(g, 0.0, 255.0)) << 8u)
       | (u32(clamp(b, 0.0, 255.0)) << 16u)
       | (u32(clamp(a, 0.0, 255.0)) << 24u);
}

fn compute_diff_channel(a: f32, b: f32, mode: u32) -> f32 {
  let diff = a - b;
  let abs_diff = abs(diff);
  let denom = max(a, 1.0);

  switch mode {
    case 0u: { return (diff + 255.0) / 2.0; }                          // signed
    case 1u: { return abs_diff; }                                        // absolute
    case 2u: { return (diff * diff) / 255.0; }                          // squared
    case 3u: { return ((diff / denom) + 1.0) * 127.5; }                 // relative_signed
    case 4u: { return (abs_diff / denom) * 255.0; }                     // relative_absolute
    case 5u: { return ((diff * diff) / (denom * denom)) * 255.0; }      // relative_squared
    default: { return abs_diff; }
  }
}

fn apply_lut(avg: f32, cmap_mode: u32) -> vec3<f32> {
  var idx: f32;
  if (cmap_mode == 2u) {
    // positive: map [0,255] → [128,255]
    idx = 128.0 + (avg / 255.0) * 127.0;
  } else {
    idx = avg;
  }
  let i = u32(clamp(round(idx), 0.0, 255.0));
  let r = f32(lut[i * 3u]);
  let g = f32(lut[i * 3u + 1u]);
  let b = f32(lut[i * 3u + 2u]);
  return vec3<f32>(r, g, b);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pixel_idx = gid.x;
  let total = params.width * params.height;
  if (pixel_idx >= total) {
    return;
  }

  let base = unpack_rgba(baseline[pixel_idx]);
  let oth = unpack_rgba(other[pixel_idx]);

  // Compute diff per channel
  let dr = compute_diff_channel(base.x, oth.x, params.diff_mode);
  let dg = compute_diff_channel(base.y, oth.y, params.diff_mode);
  let db = compute_diff_channel(base.z, oth.z, params.diff_mode);

  var out_r = clamp(round(dr), 0.0, 255.0);
  var out_g = clamp(round(dg), 0.0, 255.0);
  var out_b = clamp(round(db), 0.0, 255.0);

  // Apply colormap if enabled
  if (params.use_colormap == 1u) {
    let avg = (out_r + out_g + out_b) / 3.0;
    let mapped = apply_lut(avg, params.cmap_mode);
    out_r = mapped.x;
    out_g = mapped.y;
    out_b = mapped.z;
  }

  output[pixel_idx] = pack_rgba(out_r, out_g, out_b, 255.0);
}
`;

// ---------------------------------------------------------------------------
// GPU Pipeline (cached)
// ---------------------------------------------------------------------------

let cachedPipeline: GPUComputePipeline | null = null;

async function getPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
  if (cachedPipeline) return cachedPipeline;
  const module = device.createShaderModule({ code: SHADER_CODE });
  cachedPipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module, entryPoint: "main" },
  });
  return cachedPipeline;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GPUDiffOptions {
  diffMode: DiffMode;
  colormap: Uint8Array | null; // 256*3 LUT, or null for no colormap
  cmapMode: "linear" | "signed" | "positive";
}

/**
 * Compute image diff + optional colormap on the GPU.
 * Returns an ImageData with the result, or null if GPU is unavailable.
 */
export async function gpuComputeDiff(
  baseline: ImageData,
  other: ImageData,
  opts: GPUDiffOptions,
): Promise<ImageData | null> {
  const device = await getGPUDevice();
  if (!device) return null;

  const w = Math.min(baseline.width, other.width);
  const h = Math.min(baseline.height, other.height);
  const pixelCount = w * h;

  // Pack RGBA pixels into Uint32Arrays (one u32 per pixel)
  const basePixels = new Uint32Array(pixelCount);
  const otherPixels = new Uint32Array(pixelCount);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * baseline.width + x) * 4;
      const di = y * w + x;
      basePixels[di] =
        baseline.data[si]! |
        (baseline.data[si + 1]! << 8) |
        (baseline.data[si + 2]! << 16) |
        (baseline.data[si + 3]! << 24);

      const oi = (y * other.width + x) * 4;
      otherPixels[di] =
        other.data[oi]! |
        (other.data[oi + 1]! << 8) |
        (other.data[oi + 2]! << 16) |
        (other.data[oi + 3]! << 24);
    }
  }

  // LUT buffer (256 * 3 u32 values, or zeros if no colormap)
  const lutData = new Uint32Array(256 * 3);
  if (opts.colormap) {
    for (let i = 0; i < 256 * 3; i++) {
      lutData[i] = opts.colormap[i]!;
    }
  }

  // Params
  const paramsData = new Uint32Array([
    w,
    h,
    DIFF_MODE_MAP[opts.diffMode],
    CMAP_MODE_MAP[opts.cmapMode] ?? 0,
    opts.colormap ? 1 : 0,
    0, // padding
  ]);

  const pipeline = await getPipeline(device);

  // Create buffers
  const pixelBytes = pixelCount * 4;
  const baseBuffer = device.createBuffer({ size: pixelBytes, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  new Uint32Array(baseBuffer.getMappedRange()).set(basePixels);
  baseBuffer.unmap();

  const otherBuffer = device.createBuffer({ size: pixelBytes, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  new Uint32Array(otherBuffer.getMappedRange()).set(otherPixels);
  otherBuffer.unmap();

  const outputBuffer = device.createBuffer({ size: pixelBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  const paramsBuffer = device.createBuffer({ size: paramsData.byteLength, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
  new Uint32Array(paramsBuffer.getMappedRange()).set(paramsData);
  paramsBuffer.unmap();

  const lutBuffer = device.createBuffer({ size: lutData.byteLength, usage: GPUBufferUsage.STORAGE, mappedAtCreation: true });
  new Uint32Array(lutBuffer.getMappedRange()).set(lutData);
  lutBuffer.unmap();

  const readbackBuffer = device.createBuffer({ size: pixelBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  // Bind group
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: baseBuffer } },
      { binding: 1, resource: { buffer: otherBuffer } },
      { binding: 2, resource: { buffer: outputBuffer } },
      { binding: 3, resource: { buffer: paramsBuffer } },
      { binding: 4, resource: { buffer: lutBuffer } },
    ],
  });

  // Dispatch
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(pixelCount / 256));
  pass.end();
  encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, pixelBytes);
  device.queue.submit([encoder.finish()]);

  // Read back
  await readbackBuffer.mapAsync(GPUMapMode.READ);
  const resultU32 = new Uint32Array(readbackBuffer.getMappedRange().slice(0));
  readbackBuffer.unmap();

  // Convert back to ImageData
  const result = new ImageData(w, h);
  for (let i = 0; i < pixelCount; i++) {
    const px = resultU32[i]!;
    const di = i * 4;
    result.data[di] = px & 0xFF;
    result.data[di + 1] = (px >> 8) & 0xFF;
    result.data[di + 2] = (px >> 16) & 0xFF;
    result.data[di + 3] = (px >> 24) & 0xFF;
  }

  // Cleanup
  baseBuffer.destroy();
  otherBuffer.destroy();
  outputBuffer.destroy();
  paramsBuffer.destroy();
  lutBuffer.destroy();
  readbackBuffer.destroy();

  return result;
}
