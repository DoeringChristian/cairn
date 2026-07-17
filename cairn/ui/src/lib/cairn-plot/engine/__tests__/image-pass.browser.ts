/**
 * IMAGE render-pass readback-vs-CPU-reference harness (Task 5 of the WebGPU
 * engine, Sub-project 1) — `engine/image-engine.ts`'s `renderImage()`.
 *
 * jsdom has no WebGPU, so — like every other `*.browser.ts` harness in this
 * directory — this is NOT a unit test, it's a browser page driven via
 * claude-in-chrome.
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
 * RUNNING:
 *   1. Bundle this file to plain JS:
 *        cd cairn/ui && npx esbuild \
 *          src/lib/cairn-plot/engine/__tests__/image-pass.browser.ts \
 *          --bundle --format=esm \
 *          --outfile=src/lib/cairn-plot/engine/__tests__/image-pass.browser.bundle.js
 *   2. Serve over http (file:// is blocked for module scripts):
 *        cd cairn/ui/src/lib/cairn-plot/engine/__tests__ && python3 -m http.server 8936
 *   3. Open http://localhost:8936/image-pass.browser.html in Chrome
 *      (claude-in-chrome) and read the PASS/FAIL lines from the DOM/console.
 *
 * The generated `.bundle.js` is NOT committed (gitignored) — regenerate with
 * the command above whenever this harness or its imports change.
 */
import { getSharedDevice } from "../device";
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

  // ---------------------------------------------------------------------
  // Q18: out-of-bounds (zoomed OUT past the image) -> fully transparent,
  // NOT the old clamped-edge smear. A zoomed-out `uv` window (`w`/`h` > 1,
  // `x`/`y` < 0) samples a 2-pixel source into a 4-pixel target: pixel 0
  // (fully outside [0,1] on the left) must read back alpha=0 AND rgb=0 (the
  // shader's `vec4(0.0)` early-return, not clamp-to-edge repeating pixel 0's
  // color); pixels 1-2 land inside [0,1] and must be non-transparent.
  // ---------------------------------------------------------------------
  {
    const caseLabel = `${label}/oob-transparent`;
    const pixels = [
      [1.0, 0.0, 0.0, 1.0], // red
      [0.0, 1.0, 0.0, 1.0], // green
    ];
    const src = buildSrcTexture(device, pixels);
    const target = device.createTexture(4, 1, "rgba8unorm");
    // uv window: x=-1, w=2 -> covers source-space [-1,1] across a 4-wide
    // target (each target texel = 0.5 source-space wide). Target texel 0
    // covers source-space [-1,-0.5] (fully OOB); texel 3 covers [0.5,1]
    // (fully OOB on the right, since [0,1) is the in-bounds half-open range
    // and srcUV==1.0 is out); texels 1-2 cover [-0.5,0.5) -> in-bounds
    // (texel 1 samples the negative half but its OWN fragment uv lands at
    // 0.25/0.75 of the window which maps inside [0,1) — see per-fragment
    // math below).
    const params: ImageParams = { exposureEV: 0, operator: "linear", isScalar: false, hdrOut: false, uv: { x: -1, y: 0, w: 2, h: 1 } };
    renderImage(device, target, src, params);
    const out = await device.readback(target);
    src.destroy();
    target.destroy();
    let ok = out instanceof Uint8Array;
    if (out instanceof Uint8Array) {
      // Fragment i's uv.x = (i+0.5)/4; srcUV.x = -1 + uv.x*2.
      //   i=0: uv.x=0.125 -> srcUV.x=-0.75 (OOB, < 0)
      //   i=1: uv.x=0.375 -> srcUV.x=-0.25 (OOB, < 0)
      //   i=2: uv.x=0.625 -> srcUV.x= 0.25 (in bounds)
      //   i=3: uv.x=0.875 -> srcUV.x= 0.75 (in bounds)
      const expectOOB = [true, true, false, false];
      for (let i = 0; i < 4; i++) {
        const a = out[i * 4 + 3]!;
        const isTransparent = a === 0;
        const chOk = isTransparent === expectOOB[i];
        if (!chOk) ok = false;
        report(
          chOk,
          `[${caseLabel}] texel[${i}] alpha=${a} expected ${expectOOB[i] ? "transparent (0)" : "opaque (255)"}`,
        );
        if (!expectOOB[i]) {
          // In-bounds texels must also carry non-zero RGB (not the OOB
          // vec4(0.0) early-return's zeroed color channels either).
          const rgbSum = out[i * 4]! + out[i * 4 + 1]! + out[i * 4 + 2]!;
          const rgbOk = rgbSum > 0;
          if (!rgbOk) ok = false;
          report(rgbOk, `[${caseLabel}] texel[${i}] in-bounds rgb sum=${rgbSum} expected >0`);
        }
      }
    } else {
      report(false, `[${caseLabel}] readback() should return Uint8Array, got ${(out as { constructor: { name: string } }).constructor.name}`);
    }
    report(ok, `[${caseLabel}] zoomed-out OOB texels are fully transparent, in-bounds texels are not`);
    results.set(caseLabel, { label: caseLabel, ok, out: out instanceof Uint8Array ? out : null });
  }

  // ---------------------------------------------------------------------
  // Q20: filter:"nearest" vs filter:"linear" produce DIFFERENT results at a
  // non-texel-aligned sample point over a sharp black/white step, and
  // "linear" produces a blended midtone while "nearest" produces a pure
  // black-or-white value (no interpolation) — proving the shader actually
  // switched sampling modes, not just accepted-and-ignored the uniform.
  // ---------------------------------------------------------------------
  {
    const caseLabel = `${label}/filter-nearest-vs-linear`;
    const stepPixels = [
      [0.0, 0.0, 0.0, 1.0], // texel 0: black
      [1.0, 1.0, 1.0, 1.0], // texel 1: white
    ];
    const src = buildSrcTexture(device, stepPixels);
    // 1x1 target, uv window covering the WHOLE source (x=0,w=1): the single
    // fragment's uv.x=0.5 -> srcUV.x=0.5 -> texel-space coordinate
    // 0.5*2-0.5=0.5 -> exactly halfway between texel 0 and texel 1 (frac=0.5)
    // for bilinear, vs. floor(0.5*2)=1 (texel 1, white) for nearest.
    const uv = { x: 0, y: 0, w: 1, h: 1 };
    for (const filter of ["nearest", "linear"] as const) {
      const target = device.createTexture(1, 1, "rgba8unorm");
      // gamma:1 makes output-encode an identity (pow(x,1)=x) instead of the
      // sRGB OETF, so the bilinear-blended 0.5 raw sample survives to the
      // readback as ~127/255 unchanged — isolating the SAMPLING behavior
      // this case tests from the (unrelated, already-covered-elsewhere)
      // output-encode curve.
      const params: ImageParams = { exposureEV: 0, operator: "linear", gamma: 1, isScalar: false, hdrOut: false, uv, filter };
      renderImage(device, target, src, params);
      const out = await device.readback(target);
      target.destroy();
      if (!(out instanceof Uint8Array)) {
        report(false, `[${caseLabel}/${filter}] readback() should return Uint8Array`);
        results.set(`${caseLabel}/${filter}`, { label: caseLabel, ok: false, out: null });
        continue;
      }
      const v = out[0]!;
      const ok =
        filter === "nearest"
          ? v <= 5 || v >= 250 // pure black or white, no blend
          : Math.abs(v - 127) <= 10; // ~50% blend of black+white
      report(ok, `[${caseLabel}/${filter}] value=${v} expected ${filter === "nearest" ? "pure black/white (no blend)" : "~127 (50% blend)"}`);
      results.set(`${caseLabel}/${filter}`, { label: caseLabel, ok, out });
    }
    src.destroy();
  }

  return results;
}

function allResultsOk(results: Map<string, CaseResult>): boolean {
  for (const r of results.values()) if (!r.ok) return false;
  return true;
}

async function main(): Promise<void> {
  try {
    const device = await getSharedDevice();
    const results = await runAllCases(device, "shared");
    const sharedOk = allResultsOk(results);

    setOverallStatus(sharedOk);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
