/**
 * COMPARE render-pass + metrics readback-vs-JS-reference harness (Task 7 of
 * the WebGPU engine, Sub-project 1) — `engine/image-engine.ts`'s
 * `renderCompare()` / `computeMetrics()`.
 *
 * jsdom has no WebGPU, so — like every other `*.browser.ts` harness in this
 * directory — this is NOT a unit test, it's a browser page driven via
 * claude-in-chrome.
 *
 * ## Reference derivation — LEGACY semantics, NOT the shader
 * A prior version of this harness built its JS reference by literally
 * mirroring the compare shader's own branch structure (`cA`/`cB` combined the
 * same way `compare.wgsl.ts` combines `colorA`/`colorB`). That made the test
 * self-referential: it could only ever prove "the GPU executes this shader
 * faithfully," never "this shader's A/B roles mean what the app requires."
 * A review (Task 7 fix pass) caught a real bug hiding behind exactly that gap
 * — `media-compare/GpuComparePane.tsx` bound `texA = foreground`,
 * `texB = reference` (backwards), and this harness's shader-mirrored
 * reference happily "confirmed" the backwards output because it used the same
 * (backwards) A/B convention.
 *
 * This version derives `expectedPixel` from the INDEPENDENT legacy sources of
 * truth instead: `media-compare/compositor.tsx` (split divider clips the
 * REFERENCE pane on the left / FOREGROUND shows through on the right; blend
 * opacity: foreground=`alpha`, reference=`1-alpha`, so `alpha=0` -> reference,
 * `alpha=1` -> foreground) and `renderers/ImagePane.tsx` +
 * `image/webgl-diff.ts` (`webglRenderDiffToCanvas(baseData, otherData, ...)`
 * where `baseData` = `loadImageData(baselineUrl)` feeds `computeDiffChannel`'s
 * `a` operand, `otherData` = `loadImageData(imageUrl)` feeds `b`). Sources are
 * named `PIXELS_REF`/`PIXELS_FG` (not `PIXELS_A`/`PIXELS_B`) to keep the
 * reference/foreground *role* — the thing that must be bound correctly — in
 * the variable names, independent of whichever engine bind slot ends up
 * carrying it. `runCase` builds `texRef`/`texFg` and calls
 * `renderCompare(device, target, texRef, texFg, params)` in that order —
 * the SAME order the (fixed) `GpuComparePane.tsx` now uses
 * (`texA = uploadTex(reference)`, `texB = uploadTex(foreground)`) — so this
 * harness's calling convention is a faithful proxy for the pane's binding.
 * `runSwapGuardCase` then renders the SAME sources with the two arguments
 * SWAPPED (`texFg` first, `texRef` second — i.e. reproducing the exact bug)
 * and asserts the result *disagrees* with the legacy reference for every
 * asymmetric submode (`signed`/`relative_*`, split, blend) — the class of
 * case where `absolute`/`squared` (swap-invariant) would have stayed silent.
 * That regression case is what makes this file catch the C1 bug: reverting
 * `GpuComparePane.tsx`'s `texA`/`texB` swap is, bind-for-bind, the same
 * change as swapping `runCase`'s two texture arguments, and this file now
 * has an assertion that fails under exactly that swap.
 *
 * The `computeMetrics` reference is a plain CPU MSE/PSNR/MAE loop over the
 * same source pixels (symmetric — order-invariant, so no swap-guard needed).
 *
 * CASES (each rendered to an offscreen `rgba8unorm` texture, sources are
 * `rgba32float` so the per-side pipeline is exercised on real float input):
 *   split @ {0.0, 0.25, 0.5, 0.75, 1.0} — reference on the left of the
 *       divider, foreground/comparison on the right (divider is DEST-space
 *       uv.x), matching `compositor.tsx`.
 *   blend @ {0.0, 0.25, 0.5, 1.0}       — mix(reference, foreground, alpha).
 *   diff  × all 6 submodes (no colormap) — raw per-channel diff, `a`=reference.
 *   diff  + viridis colormap (absolute submode, "positive" cmap mode).
 *   computeMetrics — {mse,psnr,mae} vs a CPU reference, within tolerance.
 *   SWAP GUARD: split@0.25, blend@0.25, diff/{signed,relative_signed,
 *       relative_absolute,relative_squared} re-rendered with texRef/texFg
 *       swapped — asserts the output DIFFERS from the legacy reference
 *       (proves this harness is sensitive to the exact C1 binding bug).
 *
 * RUNNING:
 *   1. Bundle to plain JS:
 *        cd cairn/ui && npx esbuild \
 *          src/lib/cairn-plot/engine/__tests__/compare-pass.browser.ts \
 *          --bundle --format=esm \
 *          --outfile=src/lib/cairn-plot/engine/__tests__/compare-pass.browser.bundle.js
 *   2. Serve over http (file:// blocks module scripts):
 *        cd cairn/ui/src/lib/cairn-plot/engine/__tests__ && python3 -m http.server 8938
 *   3. Open in Chrome and read the PASS/FAIL status:
 *        http://localhost:8938/compare-pass.browser.html
 *
 * The generated `.bundle.js` is NOT committed (gitignored).
 */
import { getSharedDevice } from "../device";
import {
  renderCompare,
  computeMetrics,
  type CompareParams,
  type CompareDiffSubmode,
} from "../image-engine";
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
  (window as unknown as { __comparePassTestResult?: "pass" | "fail" }).__comparePassTestResult = pass ? "pass" : "fail";
  document.title = pass ? "COMPARE PASS PASS" : "COMPARE PASS FAIL";
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const byteOf = (x: number): number => Math.round(clamp01(x) * 255);

function buildFloatColormap(): Float32Array {
  const bytes = buildLUT(COLORMAP_STOPS.viridis);
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

/** Per-side pipeline mirror (exposure -> operator -> encode; no scalar path in
 *  these cases), using the REAL tonemap.ts functions. Returns encoded [0,1] RGB. */
function processSide(px: number[], params: CompareParams): RgbTriple {
  const exposed: RgbTriple = [
    applyExposure(px[0]!, params.exposureEV),
    applyExposure(px[1]!, params.exposureEV),
    applyExposure(px[2]!, params.exposureEV),
  ];
  const opFn = TONEMAP_OPERATORS[params.operator] ?? TONEMAP_OPERATORS.srgb!;
  const toned = opFn(exposed);
  return [
    outputEncode(toned[0], params.gamma),
    outputEncode(toned[1], params.gamma),
    outputEncode(toned[2], params.gamma),
  ];
}

/** `image/webgl-diff.ts`'s `computeDiffChannel(base, other, mode)` verbatim —
 *  `a` = `base` = reference/baseline, `b` = `other` = foreground/comparison
 *  (see `renderers/ImagePane.tsx`'s `webglRenderDiffToCanvas(baseData,
 *  otherData, ...)` call, `baseData = loadImageData(baselineUrl)`). This is
 *  the LEGACY source of truth this harness's diff reference is derived from
 *  — `compare.wgsl.ts`'s `diffChannel` happens to be a verbatim port of it,
 *  but that's a property we're checking, not assuming. */
function diffChannel(a: number, b: number, mode: CompareDiffSubmode): number {
  const diff = a - b;
  const absDiff = Math.abs(diff);
  const denom = Math.max(a, 1 / 255);
  switch (mode) {
    case "signed":
      return (diff + 1) / 2;
    case "absolute":
      return absDiff;
    case "squared":
      return diff * diff;
    case "relative_signed":
      return (diff / denom + 1) / 2;
    case "relative_absolute":
      return absDiff / denom;
    case "relative_squared":
      return (diff * diff) / (denom * denom);
  }
}

/** Full JS reference for one output pixel at destination `uvX` (screen-space
 *  [0,1)), derived from LEGACY semantics: `pxRef` = reference/baseline (the
 *  `compositor.tsx` left/split, `alpha=0` blend endpoint, diff `a` operand),
 *  `pxFg` = foreground/comparison (right/split, `alpha=1` endpoint, diff `b`
 *  operand). */
function expectedPixel(pxRef: number[], pxFg: number[], uvX: number, params: CompareParams): RgbTriple {
  const refColor = processSide(pxRef, params);
  const fgColor = processSide(pxFg, params);
  if (params.mode === "blend") {
    // compositor.tsx: foreground opacity=alpha, reference opacity=1-alpha,
    // foreground drawn OVER reference -> alpha=0 shows pure reference.
    return [
      refColor[0] + (fgColor[0] - refColor[0]) * params.alpha,
      refColor[1] + (fgColor[1] - refColor[1]) * params.alpha,
      refColor[2] + (fgColor[2] - refColor[2]) * params.alpha,
    ];
  }
  if (params.mode === "diff") {
    const d: RgbTriple = [
      clamp01(diffChannel(refColor[0], fgColor[0], params.diffSubmode)),
      clamp01(diffChannel(refColor[1], fgColor[1], params.diffSubmode)),
      clamp01(diffChannel(refColor[2], fgColor[2], params.diffSubmode)),
    ];
    if (params.diffColormap) {
      const avg = (d[0] + d[1] + d[2]) / 3;
      const cmapMode = params.diffCmapMode ?? "linear";
      const idxUnit = cmapMode === "positive" ? 0.5 + avg * 0.5 : avg;
      const idx = Math.max(0, Math.min(255, Math.round(clamp01(idxUnit) * 255)));
      const lut = params.diffColormap;
      return [lut[idx * 4]!, lut[idx * 4 + 1]!, lut[idx * 4 + 2]!];
    }
    return d;
  }
  // split: compositor.tsx clips the REFERENCE pane on the left
  // (`inset(0 ${(1-split)*100}% 0 0)`), revealing the FOREGROUND underneath
  // on the right.
  return uvX < params.split ? refColor : fgColor;
}

function buildRowTexture(device: Device, pixels: number[][]): Texture {
  const width = pixels.length;
  const tex = device.createTexture(width, 1, "rgba32float");
  const data = new Float32Array(width * 4);
  for (let i = 0; i < pixels.length; i++) data.set(pixels[i]!, i * 4);
  tex.write(data);
  return tex;
}

// Two distinct scene-linear rows: PIXELS_REF = reference/baseline,
// PIXELS_FG = foreground/comparison (see the module doc comment for why
// these are named by ROLE, not by engine bind slot). Width 4; the per-column
// DEST uv.x centers are (i+0.5)/4 = 0.125, 0.375, 0.625, 0.875.
const PIXELS_REF: number[][] = [
  [0.0, 0.1, 0.2, 1.0],
  [0.3, 0.4, 0.5, 1.0],
  [0.6, 0.7, 0.8, 1.0],
  [1.0, 1.2, 0.9, 1.0],
];
const PIXELS_FG: number[][] = [
  [0.2, 0.2, 0.2, 1.0],
  [0.1, 0.5, 0.3, 1.0],
  [0.9, 0.4, 0.7, 1.0],
  [0.5, 0.5, 0.5, 1.0],
];
const WIDTH = PIXELS_REF.length;
const uvXOfCol = (i: number): number => (i + 0.5) / WIDTH;
const uvFull = { x: 0, y: 0, w: 1, h: 1 };

const BASE: Omit<CompareParams, "mode" | "split" | "alpha" | "diffSubmode"> = {
  exposureEV: 0,
  operator: "srgb",
  isScalar: false,
  hdrOut: false,
  uv: uvFull,
};

/**
 * Renders `renderCompare(device, target, texRef, texFg, params)` — texRef
 * FIRST, texFg SECOND, the same order the (fixed) `GpuComparePane.tsx` uses
 * (`texA = uploadTex(reference)`, `texB = uploadTex(foreground)`) — and
 * checks the readback against the legacy-derived `expectedPixel`. When
 * `swapped` is true, the two texture arguments are passed in the OPPOSITE
 * order (reproducing the exact C1 binding bug); `allOk` then reports whether
 * the (still legacy-derived) expectation was met, which for asymmetric modes
 * it should NOT be — see `runSwapGuardCase`.
 */
async function runCase(
  device: Device,
  label: string,
  params: CompareParams,
  swapped = false,
): Promise<boolean> {
  const texRef = buildRowTexture(device, PIXELS_REF);
  const texFg = buildRowTexture(device, PIXELS_FG);
  const target = device.createTexture(WIDTH, 1, "rgba8unorm");
  if (swapped) {
    renderCompare(device, target, texFg, texRef, params); // reproduces the C1 bug
  } else {
    renderCompare(device, target, texRef, texFg, params); // matches the fixed pane
  }
  const out = await device.readback(target);
  texRef.destroy();
  texFg.destroy();
  target.destroy();

  if (!(out instanceof Uint8Array)) {
    report(false, `[${label}] readback should be Uint8Array, got ${out.constructor.name}`);
    return false;
  }
  let allOk = true;
  for (let i = 0; i < WIDTH; i++) {
    const expected = expectedPixel(PIXELS_REF[i]!, PIXELS_FG[i]!, uvXOfCol(i), params);
    for (let c = 0; c < 3; c++) {
      const eByte = byteOf(expected[c]!);
      const aByte = out[i * 4 + c]!;
      const diff = Math.abs(aByte - eByte);
      const ok = diff <= 1;
      if (!ok) {
        allOk = false;
        report(false, `[${label}] px[${i}].ch[${c}] expected=${eByte} actual=${aByte} (diff=${diff})`);
      }
    }
  }
  report(allOk, `[${label}] all pixels within 1/255 of legacy-derived JS reference`);
  return allOk;
}

/**
 * Regression guard for the C1 binding bug: runs the SAME case with texRef/
 * texFg SWAPPED and asserts the output now DISAGREES with the legacy
 * reference (i.e. `runCase(..., swapped: true)` must come back `false`). Only
 * meaningful for modes/submodes that are NOT symmetric in (a,b) — `absolute`
 * and `squared` diff are swap-invariant (`|a-b|`/`(a-b)^2`) and would stay
 * silent, matching the review's note that only `signed`/`relative_*` (plus
 * split/blend) exposed the bug visibly.
 */
async function runSwapGuardCase(device: Device, label: string, params: CompareParams): Promise<boolean> {
  const disagreed = !(await runCase(device, `${label} [SWAP GUARD]`, params, true));
  report(disagreed, `[${label}] swapped texRef/texFg DISAGREES with legacy reference (bug would be caught)`);
  return disagreed;
}

/** CPU MSE/PSNR/MAE reference over the raw source floats (RGB, peak 1.0). */
function cpuMetrics(a: number[][], b: number[][]): { mse: number; psnr: number; mae: number } {
  let sumSq = 0;
  let sumAbs = 0;
  const n = a.length * 3;
  for (let i = 0; i < a.length; i++) {
    for (let c = 0; c < 3; c++) {
      const d = a[i]![c]! - b[i]![c]!;
      sumSq += d * d;
      sumAbs += Math.abs(d);
    }
  }
  const mse = sumSq / n;
  const mae = sumAbs / n;
  const psnr = mse <= 0 ? Infinity : 10 * Math.log10(1 / mse);
  return { mse, psnr, mae };
}

async function runMetricsCase(device: Device, label: string): Promise<boolean> {
  const texRef = buildRowTexture(device, PIXELS_REF);
  const texFg = buildRowTexture(device, PIXELS_FG);
  const got = await computeMetrics(device, texRef, texFg);
  texRef.destroy();
  texFg.destroy();

  // MSE/MAE/PSNR are symmetric in (a,b), so argument order doesn't matter
  // here — no swap-guard case needed for metrics.
  const ref = cpuMetrics(PIXELS_REF, PIXELS_FG);
  const mseOk = Math.abs(got.mse - ref.mse) <= 1e-4;
  const maeOk = Math.abs(got.mae - ref.mae) <= 1e-4;
  const psnrOk = Math.abs(got.psnr - ref.psnr) <= 1e-2;
  report(mseOk, `[${label}] mse gpu=${got.mse.toFixed(6)} cpu=${ref.mse.toFixed(6)}`);
  report(maeOk, `[${label}] mae gpu=${got.mae.toFixed(6)} cpu=${ref.mae.toFixed(6)}`);
  report(psnrOk, `[${label}] psnr gpu=${got.psnr.toFixed(4)} cpu=${ref.psnr.toFixed(4)}`);
  return mseOk && maeOk && psnrOk;
}

/**
 * Q18: zoomed-out (uv window outside [0,1]) -> fully transparent, for the
 * COMPARE pass too (`compare.wgsl.ts` shares the same `rawSrcUV` OOB check
 * `image.wgsl.ts` uses — see `image-pass.browser.ts`'s
 * `oob-transparent` case for the identical single-shader version). Same
 * 2-texel source / 4-wide target / `uv:{x:-1,w:2}` window as that case;
 * texels 0-1 land outside [0,1] (transparent), texels 2-3 land inside.
 */
async function runOobTransparentCase(device: Device, label: string): Promise<boolean> {
  const texRef = buildRowTexture(device, [
    [1.0, 0.0, 0.0, 1.0],
    [0.0, 1.0, 0.0, 1.0],
  ]);
  const texFg = buildRowTexture(device, [
    [0.0, 0.0, 1.0, 1.0],
    [1.0, 1.0, 0.0, 1.0],
  ]);
  const target = device.createTexture(4, 1, "rgba8unorm");
  const params: CompareParams = {
    ...BASE,
    uv: { x: -1, y: 0, w: 2, h: 1 },
    mode: "split",
    split: 0.5,
    alpha: 0.5,
    diffSubmode: "absolute",
  };
  renderCompare(device, target, texRef, texFg, params);
  const out = await device.readback(target);
  texRef.destroy();
  texFg.destroy();
  target.destroy();

  if (!(out instanceof Uint8Array)) {
    report(false, `[${label}] readback should be Uint8Array, got ${out.constructor.name}`);
    return false;
  }
  // Same per-fragment srcUV math as image-pass.browser.ts's oob-transparent
  // case: i=0,1 -> OOB; i=2,3 -> in bounds.
  const expectOOB = [true, true, false, false];
  let ok = true;
  for (let i = 0; i < 4; i++) {
    const a = out[i * 4 + 3]!;
    const isTransparent = a === 0;
    const pass = isTransparent === expectOOB[i];
    if (!pass) ok = false;
    report(pass, `[${label}] texel[${i}] alpha=${a} expected ${expectOOB[i] ? "transparent (0)" : "opaque (255)"}`);
  }
  report(ok, `[${label}] zoomed-out OOB texels are fully transparent, in-bounds texels are not`);
  return ok;
}

async function runAll(device: Device, label: string): Promise<boolean> {
  report(true, `[${label}] device.backend = ${device.backend}`);
  let ok = true;

  for (const split of [0.0, 0.25, 0.5, 0.75, 1.0]) {
    const p: CompareParams = { ...BASE, mode: "split", split, alpha: 0.5, diffSubmode: "absolute" };
    ok = (await runCase(device, `${label}/split@${split}`, p)) && ok;
  }
  for (const alpha of [0.0, 0.25, 0.5, 1.0]) {
    const p: CompareParams = { ...BASE, mode: "blend", split: 0.5, alpha, diffSubmode: "absolute" };
    ok = (await runCase(device, `${label}/blend@${alpha}`, p)) && ok;
  }
  const submodes: CompareDiffSubmode[] = [
    "signed",
    "absolute",
    "squared",
    "relative_signed",
    "relative_absolute",
    "relative_squared",
  ];
  for (const sm of submodes) {
    const p: CompareParams = { ...BASE, mode: "diff", split: 0.5, alpha: 0.5, diffSubmode: sm };
    ok = (await runCase(device, `${label}/diff/${sm}`, p)) && ok;
  }
  {
    const p: CompareParams = {
      ...BASE,
      mode: "diff",
      split: 0.5,
      alpha: 0.5,
      diffSubmode: "absolute",
      diffColormap: VIRIDIS_FLOAT_LUT,
      diffCmapMode: "positive",
    };
    ok = (await runCase(device, `${label}/diff/absolute+viridis`, p)) && ok;
  }
  ok = (await runMetricsCase(device, `${label}/metrics`)) && ok;
  ok = (await runOobTransparentCase(device, `${label}/oob-transparent`)) && ok;

  // ---- SWAP GUARD (C1 regression): texRef/texFg swapped must DISAGREE with
  // the legacy reference for asymmetric modes — this is what makes the
  // harness sensitive to the exact GpuComparePane.tsx binding bug (see
  // module doc comment). `absolute`/`squared` are swap-invariant, so they're
  // skipped here (matches the review's finding).
  {
    const p: CompareParams = { ...BASE, mode: "split", split: 0.25, alpha: 0.5, diffSubmode: "absolute" };
    ok = (await runSwapGuardCase(device, `${label}/split@0.25`, p)) && ok;
  }
  {
    const p: CompareParams = { ...BASE, mode: "blend", split: 0.5, alpha: 0.25, diffSubmode: "absolute" };
    ok = (await runSwapGuardCase(device, `${label}/blend@0.25`, p)) && ok;
  }
  const asymmetricSubmodes: CompareDiffSubmode[] = [
    "signed",
    "relative_signed",
    "relative_absolute",
    "relative_squared",
  ];
  for (const sm of asymmetricSubmodes) {
    const p: CompareParams = { ...BASE, mode: "diff", split: 0.5, alpha: 0.5, diffSubmode: sm };
    ok = (await runSwapGuardCase(device, `${label}/diff/${sm}`, p)) && ok;
  }

  return ok;
}

async function main(): Promise<void> {
  try {
    const device = await getSharedDevice();
    const ok = await runAll(device, "shared");
    setOverallStatus(ok);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
