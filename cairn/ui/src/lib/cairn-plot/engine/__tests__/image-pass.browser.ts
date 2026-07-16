/**
 * IMAGE render-pass readback-vs-CPU-reference harness (Task 5 of the WebGPU
 * engine, Sub-project 1) — `engine/image-engine.ts`'s `renderImage()`.
 *
 * jsdom has no WebGL2/WebGPU, so — like every other `*.browser.ts` harness
 * in this directory — this is NOT a unit test, it's a browser page driven
 * via claude-in-chrome.
 *
 * PARITY-CRITICAL: every case's expected value is computed by IMPORTING the
 * real `applyExposure`/`TONEMAP_OPERATORS`/`outputEncode` from
 * `image/tonemap.ts` (the CPU source of truth) rather than reimplementing
 * that math in the test — the assertion is "GPU output === what the actual
 * CPU renderer's functions compute", not "GPU output matches my mental
 * model of tonemap.ts". The one GPU-only addition (scalar image + colormap
 * LUT: `image.wgsl.ts`'s doc comment explains no existing CPU renderer
 * applies a colormap at this pipeline point) is mirrored by hand in
 * `computeExpectedRGB` below, matching `image.wgsl.ts`'s fragment shader
 * line for line.
 *
 * CASES (each rendered to an offscreen `rgba8unorm` texture unless noted):
 *   1-4. Each operator (linear/srgb/reinhard/aces) at EV=0, on a 4-pixel
 *        scene-linear gradient that includes a value > 1.0 (HDR range).
 *   5. Nonzero EV (+1.5) on the same gradient, operator "srgb".
 *   6. Scalar image + a 256x4 colormap LUT (viridis stops, converted to
 *      normalized RGBA float) — `isScalar: true`, operator "linear" (a
 *      clamp no-op, so the LUT's own [0,1] values pass through unchanged
 *      before output-encode).
 *   7. LUT-index rounding parity: scalar values whose `*255` lands EXACTLY
 *      on a `k+0.5` boundary (0.5/1.5/127.5/254.5), against an alternating
 *      black/white LUT (`BOUNDARY_LUT`) so a wrong adjacent index is
 *      unmistakable. Catches the shader-native `round()` (WGSL:
 *      round-half-to-EVEN, GLSL: implementation-defined) disagreeing with
 *      the CPU reference's `Math.round` (round-half-up) — and disagreeing
 *      with EACH OTHER — exactly at these boundaries; a smooth LUT (like
 *      case 6's viridis) can't catch this because neighboring stops are too
 *      close in color to distinguish an off-by-one index within 1/255.
 *   8. Gamma override (2.2) instead of the default sRGB OETF.
 *   9. `uv` viewport window (zoom/pan): samples only a sub-rect of a wider
 *      source texture, proving the windowing math (not just full-frame
 *      sampling) is wired correctly.
 *   10. `hdrOut: true` to an `rgba32float` target — output-encode is
 *      SKIPPED; compared as floats (looser epsilon; no 8-bit quantization
 *      to absorb GPU-vs-CPU float32/float64 precision differences).
 *
 * Beyond each backend independently matching the CPU reference, `main()`
 * ALSO cross-compares WebGL2's raw readback bytes against WebGPU's
 * (`runCrossBackendParity`, mirroring `backend-readback.browser.ts`'s
 * `compareBackends`) for the byte-target cases, on the default (non-forced)
 * page load when `navigator.gpu` is available.
 *
 * RUNNING:
 *   1. Bundle this file to plain JS:
 *        cd cairn/ui && npx esbuild \
 *          src/lib/cairn-plot/engine/__tests__/image-pass.browser.ts \
 *          --bundle --format=esm \
 *          --outfile=src/lib/cairn-plot/engine/__tests__/image-pass.browser.bundle.js
 *   2. Serve over http (file:// is blocked for module scripts):
 *        cd cairn/ui/src/lib/cairn-plot/engine/__tests__ && python3 -m http.server 8936
 *   3. Open BOTH of these in Chrome (claude-in-chrome) and read the
 *      PASS/FAIL lines from the DOM/console on each:
 *        http://localhost:8936/image-pass.browser.html
 *        http://localhost:8936/image-pass.browser.html?forceWebGL2
 *
 * The generated `.bundle.js` is NOT committed (gitignored) — regenerate with
 * the command above whenever this harness or its imports change.
 */
import { getSharedDevice } from "../device";
import { createWebGL2Device } from "../webgl2/device";
import { createWebGPUDevice } from "../webgpu/device";
import { renderImage, type ImageParams, type ImageOperator } from "../image-engine";
import { applyExposure, TONEMAP_OPERATORS, outputEncode, type RgbTriple } from "../../image/tonemap";
import { buildLUT, COLORMAP_STOPS } from "../../colormaps/lut";
import type { Device, Texture } from "../types";

function report(pass: boolean, message: string): void {
  const line = `${pass ? "PASS" : "FAIL"}: ${message}`;
  // eslint-disable-next-line no-console
  console[pass ? "log" : "error"](line);
  const el = document.getElementById("result");
  if (el) {
    const p = document.createElement("div");
    p.textContent = line;
    p.style.color = pass ? "green" : "red";
    el.appendChild(p);
  }
}

function setOverallStatus(pass: boolean): void {
  const el = document.getElementById("status");
  if (el) {
    el.textContent = pass ? "PASS" : "FAIL";
    el.style.color = pass ? "green" : "red";
  }
  (window as unknown as { __imagePassTestResult?: "pass" | "fail" }).__imagePassTestResult = pass ? "pass" : "fail";
  document.title = pass ? "IMAGE PASS PASS" : "IMAGE PASS FAIL";
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const byteOf = (x: number): number => Math.round(clamp01(x) * 255);

/** 256x4 (RGBA, [0,1]) viridis LUT — reuses the real colormap stops from colormaps/lut.ts. */
function buildFloatColormap(): Float32Array {
  const bytes = buildLUT(COLORMAP_STOPS.viridis); // Uint8Array(256*3), 0..255
  const out = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4 + 0] = bytes[i * 3 + 0]! / 255;
    out[i * 4 + 1] = bytes[i * 3 + 1]! / 255;
    out[i * 4 + 2] = bytes[i * 3 + 2]! / 255;
    out[i * 4 + 3] = 1;
  }
  return out;
}
const VIRIDIS_FLOAT_LUT = buildFloatColormap();

/**
 * Alternating black/white 256x4 LUT — every ADJACENT index pair differs
 * maximally (0 vs 1 per channel), so a LUT index that rounds to the WRONG
 * neighbor is unmistakable in the readback (diff ~255, not ~1), unlike a
 * smooth LUT (e.g. viridis) where neighboring stops are too close in color
 * to distinguish an off-by-one index within the 1/255 comparison epsilon.
 */
function buildBoundaryColormap(): Float32Array {
  const out = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i % 2 === 0 ? 0 : 1;
    out[i * 4 + 0] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 1;
  }
  return out;
}
const BOUNDARY_LUT = buildBoundaryColormap();

/**
 * JS mirror of `image.wgsl.ts`'s fragment shader, computed with the REAL
 * `applyExposure`/`TONEMAP_OPERATORS`/`outputEncode` from `image/tonemap.ts`
 * for the parity-critical stages. Returns display-linear-or-encoded RGB in
 * [0,1] (encoded unless `params.hdrOut`). `colormap` must be supplied when
 * `params.isScalar`.
 */
function computeExpectedRGB(px: number[], params: ImageParams, colormap?: Float32Array): RgbTriple {
  const exposed: RgbTriple = [
    applyExposure(px[0]!, params.exposureEV),
    applyExposure(px[1]!, params.exposureEV),
    applyExposure(px[2]!, params.exposureEV),
  ];

  let rgb = exposed;
  if (params.isScalar) {
    const lut = colormap!;
    const idx = Math.max(0, Math.min(255, Math.round(clamp01(exposed[0]) * 255)));
    rgb = [lut[idx * 4 + 0]!, lut[idx * 4 + 1]!, lut[idx * 4 + 2]!];
  }

  const opFn = TONEMAP_OPERATORS[params.operator] ?? TONEMAP_OPERATORS.srgb!;
  const toned = opFn(rgb);

  if (params.hdrOut) return toned;
  return [outputEncode(toned[0], params.gamma), outputEncode(toned[1], params.gamma), outputEncode(toned[2], params.gamma)];
}

function buildSrcTexture(device: Device, pixels: number[][]): Texture {
  const width = pixels.length;
  const tex = device.createTexture(width, 1, "rgba32float");
  const data = new Float32Array(width * 4);
  for (let i = 0; i < pixels.length; i++) data.set(pixels[i]!, i * 4);
  tex.write(data);
  return tex;
}

interface CaseResult {
  label: string;
  ok: boolean;
  out: Uint8Array | Float32Array | null;
}

/** Byte-target case (rgba8unorm): renders, reads back, compares each channel to computeExpectedRGB within 1/255. */
async function runByteCaseAsync(
  device: Device,
  label: string,
  pixels: number[][],
  params: ImageParams,
  colormap: Float32Array | undefined,
): Promise<CaseResult> {
  const src = buildSrcTexture(device, pixels);
  const target = device.createTexture(pixels.length, 1, "rgba8unorm");
  renderImage(device, target, src, params);
  const out = await device.readback(target);
  src.destroy();
  target.destroy();

  if (!(out instanceof Uint8Array)) {
    report(false, `[${label}] readback() should return Uint8Array for rgba8unorm, got ${out.constructor.name}`);
    return { label, ok: false, out: null };
  }

  let allOk = true;
  for (let i = 0; i < pixels.length; i++) {
    const expected = computeExpectedRGB(pixels[i]!, params, colormap);
    for (let c = 0; c < 3; c++) {
      const expectedByte = byteOf(expected[c]!);
      const actualByte = out[i * 4 + c]!;
      const diff = Math.abs(actualByte - expectedByte);
      const ok = diff <= 1;
      if (!ok) allOk = false;
      report(ok, `[${label}] pixel[${i}].ch[${c}] expected=${expectedByte} actual=${actualByte} (diff=${diff})`);
    }
  }
  report(allOk, `[${label}] all pixels within 1/255 of tonemap.ts reference`);
  return { label, ok: allOk, out };
}

/** hdrOut case (rgba32float target): compared as floats with a looser epsilon (no 8-bit quantization). */
async function runHdrOutCase(device: Device, label: string, pixels: number[][], params: ImageParams): Promise<CaseResult> {
  const src = buildSrcTexture(device, pixels);
  const target = device.createTexture(pixels.length, 1, "rgba32float");
  renderImage(device, target, src, params);
  const out = await device.readback(target);
  src.destroy();
  target.destroy();

  if (!(out instanceof Float32Array)) {
    report(false, `[${label}] readback() should return Float32Array for rgba32float, got ${out.constructor.name}`);
    return { label, ok: false, out: null };
  }

  const EPS = 0.01;
  let allOk = true;
  for (let i = 0; i < pixels.length; i++) {
    const expected = computeExpectedRGB(pixels[i]!, params);
    for (let c = 0; c < 3; c++) {
      const expectedVal = expected[c]!;
      const actualVal = out[i * 4 + c]!;
      const diff = Math.abs(actualVal - expectedVal);
      const ok = diff <= EPS;
      if (!ok) allOk = false;
      report(ok, `[${label}] pixel[${i}].ch[${c}] expected=${expectedVal.toFixed(4)} actual=${actualVal.toFixed(4)} (diff=${diff.toFixed(4)})`);
    }
  }
  report(allOk, `[${label}] all pixels within ${EPS} of tonemap.ts reference (float target)`);
  return { label, ok: allOk, out };
}

// Scene-linear gradient including an HDR value (>1.0) — used for the
// per-operator / nonzero-EV / gamma-override cases. r=g=b=v, a=1.
const GRADIENT_PIXELS: number[][] = [
  [0.0, 0.0, 0.0, 1.0],
  [0.25, 0.25, 0.25, 1.0],
  [1.0, 1.0, 1.0, 1.0],
  [3.0, 3.0, 3.0, 1.0],
];

// Scalar "value" channel (r only matters); includes a value >1.0 to exercise
// the pre-LUT-index clamp.
const SCALAR_PIXELS: number[][] = [
  [0.0, 0, 0, 1.0],
  [0.33, 0, 0, 1.0],
  [0.66, 0, 0, 1.0],
  [1.2, 0, 0, 1.0],
];

// Scalar values whose exposure-applied `*255` lands EXACTLY on a `k+0.5`
// index boundary (0.5, 1.5, 127.5, 254.5) — see `BOUNDARY_LUT`'s doc comment
// and CASES item 7 above. `k/255` reproduces `k+...` exactly through the
// float32 texture round-trip (verified: `Math.fround(Math.fround(k/255) *
// 255) === k+0.5` for all four values), so any mismatch is the shader's
// rounding choice, not incidental float32/float64 precision noise.
const BOUNDARY_SCALAR_PIXELS: number[][] = [
  [0.5 / 255, 0, 0, 1.0],
  [1.5 / 255, 0, 0, 1.0],
  [127.5 / 255, 0, 0, 1.0],
  [254.5 / 255, 0, 0, 1.0],
];

const uvFull = { x: 0, y: 0, w: 1, h: 1 };

async function runAllCases(device: Device, label: string): Promise<Map<string, CaseResult>> {
  const results = new Map<string, CaseResult>();

  report(true, `[${label}] device.backend = ${device.backend}`);

  const operators: ImageOperator[] = ["linear", "srgb", "reinhard", "aces"];
  for (const op of operators) {
    const caseLabel = `${label}/operator=${op}`;
    const params: ImageParams = { exposureEV: 0, operator: op, isScalar: false, hdrOut: false, uv: uvFull };
    results.set(caseLabel, await runByteCaseAsync(device, caseLabel, GRADIENT_PIXELS, params, undefined));
  }

  {
    const caseLabel = `${label}/nonzero-EV`;
    const params: ImageParams = { exposureEV: 1.5, operator: "srgb", isScalar: false, hdrOut: false, uv: uvFull };
    results.set(caseLabel, await runByteCaseAsync(device, caseLabel, GRADIENT_PIXELS, params, undefined));
  }

  {
    const caseLabel = `${label}/scalar+colormap`;
    const params: ImageParams = {
      exposureEV: 0,
      operator: "linear",
      isScalar: true,
      hdrOut: false,
      uv: uvFull,
      colormap: VIRIDIS_FLOAT_LUT,
    };
    results.set(caseLabel, await runByteCaseAsync(device, caseLabel, SCALAR_PIXELS, params, VIRIDIS_FLOAT_LUT));
  }

  {
    // LUT-index rounding parity boundary case — see CASES item 7 above and
    // BOUNDARY_LUT/BOUNDARY_SCALAR_PIXELS's doc comments.
    const caseLabel = `${label}/lut-rounding-boundary`;
    const params: ImageParams = {
      exposureEV: 0,
      operator: "linear",
      isScalar: true,
      hdrOut: false,
      uv: uvFull,
      colormap: BOUNDARY_LUT,
    };
    results.set(caseLabel, await runByteCaseAsync(device, caseLabel, BOUNDARY_SCALAR_PIXELS, params, BOUNDARY_LUT));
  }

  {
    const caseLabel = `${label}/gamma-override`;
    const params: ImageParams = { exposureEV: 0, operator: "aces", gamma: 2.2, isScalar: false, hdrOut: false, uv: uvFull };
    results.set(caseLabel, await runByteCaseAsync(device, caseLabel, GRADIENT_PIXELS, params, undefined));
  }

  {
    // uv viewport window: an 4-pixel source, sample only the sub-rect that
    // covers source column index 2 ([0.5, 0.75) of the [0,1] width), into a
    // 1x1 target — the whole target must read back as pixel[2]'s value.
    const caseLabel = `${label}/uv-window`;
    const params: ImageParams = {
      exposureEV: 0,
      operator: "linear",
      isScalar: false,
      hdrOut: false,
      uv: { x: 0.5, y: 0, w: 0.25, h: 1 },
    };
    const src = buildSrcTexture(device, GRADIENT_PIXELS);
    const target = device.createTexture(1, 1, "rgba8unorm");
    renderImage(device, target, src, params);
    const out = await device.readback(target);
    src.destroy();
    target.destroy();
    let ok = out instanceof Uint8Array;
    if (out instanceof Uint8Array) {
      const expected = computeExpectedRGB(GRADIENT_PIXELS[2]!, params);
      for (let c = 0; c < 3; c++) {
        const expectedByte = byteOf(expected[c]!);
        const actualByte = out[c]!;
        const diff = Math.abs(actualByte - expectedByte);
        const chOk = diff <= 1;
        if (!chOk) ok = false;
        report(chOk, `[${caseLabel}] ch[${c}] expected=${expectedByte} actual=${actualByte} (diff=${diff})`);
      }
    } else {
      report(false, `[${caseLabel}] readback() should return Uint8Array, got ${(out as { constructor: { name: string } }).constructor.name}`);
    }
    report(ok, `[${caseLabel}] uv window sampled source column 2 correctly`);
    results.set(caseLabel, { label: caseLabel, ok, out: out instanceof Uint8Array ? out : null });
  }

  {
    const caseLabel = `${label}/hdrOut`;
    const params: ImageParams = { exposureEV: 0.5, operator: "aces", isScalar: false, hdrOut: true, uv: uvFull };
    const r = await runHdrOutCase(device, caseLabel, GRADIENT_PIXELS, params);
    results.set(caseLabel, r);
  }

  return results;
}

function allResultsOk(results: Map<string, CaseResult>): boolean {
  for (const r of results.values()) if (!r.ok) return false;
  return true;
}

/**
 * Cross-backend parity: directly instantiates BOTH backends in this one
 * page load (bypassing the page-wide `getSharedDevice()` singleton, which
 * only ever picks one backend per page) and compares WebGL2's vs WebGPU's
 * raw readback bytes, byte-for-byte within 1/255, for every byte-target
 * case. Only meaningful when `navigator.gpu` is available.
 */
async function runCrossBackendParity(): Promise<boolean> {
  if (!("gpu" in navigator) || !navigator.gpu) {
    report(true, "[parity] SKIPPED — navigator.gpu is not available in this browser");
    return true;
  }
  const glDevice = createWebGL2Device();
  const gpuDevice = await createWebGPUDevice();

  const glResults = await runAllCases(glDevice, "parity-webgl2");
  const gpuResults = await runAllCases(gpuDevice, "parity-webgpu");

  glDevice.destroy();
  gpuDevice.destroy();

  let allOk = true;
  for (const [key, glResult] of glResults) {
    const gpuKey = key.replace("parity-webgl2", "parity-webgpu");
    const gpuResult = gpuResults.get(gpuKey);
    const a = glResult.out;
    const b = gpuResult?.out ?? null;
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) {
      // hdrOut case reads back Float32Array — compare with a float epsilon instead.
      if (a instanceof Float32Array && b instanceof Float32Array) {
        let ok = a.length === b.length;
        for (let i = 0; ok && i < a.length; i++) ok = Math.abs(a[i]! - b[i]!) <= 0.01;
        report(ok, `[parity][${key}] WebGL2 vs WebGPU float readback identical within 0.01`);
        if (!ok) allOk = false;
        continue;
      }
      report(false, `[parity][${key}] cannot compare — missing readback (webgl2=${!!a}, webgpu=${!!b})`);
      allOk = false;
      continue;
    }
    let ok = a.length === b.length;
    for (let i = 0; ok && i < a.length; i++) ok = Math.abs(a[i]! - b[i]!) <= 1;
    report(ok, `[parity][${key}] WebGL2 vs WebGPU readback identical within 1/255`);
    if (!ok) allOk = false;
  }
  return allOk;
}

async function main(): Promise<void> {
  try {
    const forceWebGL2 = new URLSearchParams(location.search).has("forceWebGL2");
    report(true, `location.search = "${location.search}" -> forceWebGL2 URL param present: ${forceWebGL2}`);

    const device = await getSharedDevice();
    const results = await runAllCases(device, "shared");
    const sharedOk = allResultsOk(results);

    let parityOk = true;
    if (!forceWebGL2) {
      parityOk = await runCrossBackendParity();
    } else {
      report(true, "[parity] SKIPPED on ?forceWebGL2 page load (runs only on the default page load)");
    }

    setOverallStatus(sharedOk && parityOk);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
