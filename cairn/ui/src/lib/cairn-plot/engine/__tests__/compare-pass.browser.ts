/**
 * COMPARE render-pass + metrics readback-vs-JS-reference harness (Task 7 of
 * the WebGPU engine, Sub-project 1) — `engine/image-engine.ts`'s
 * `renderCompare()` / `computeMetrics()`.
 *
 * jsdom has no WebGL2/WebGPU, so — like every other `*.browser.ts` harness in
 * this directory — this is NOT a unit test, it's a browser page driven via
 * claude-in-chrome.
 *
 * The reference for each case is computed IN THIS FILE by mirroring the
 * compare shader's math (which itself ports `image/tonemap.ts`'s per-side
 * pipeline + `image/webgl-diff.ts`'s `computeDiffChannel`), then compared to
 * the GPU readback within 1/255. The `computeMetrics` reference is a plain CPU
 * MSE/PSNR/MAE loop over the same source pixels.
 *
 * CASES (each rendered to an offscreen `rgba8unorm` texture, sources are
 * `rgba32float` so the per-side pipeline is exercised on real float input):
 *   split @ {0.0, 0.25, 0.5, 0.75, 1.0} — foreground on the left of the
 *       divider, reference on the right (divider is DEST-space uv.x).
 *   blend @ {0.0, 0.25, 0.5, 1.0}       — mix(A, B, alpha).
 *   diff  × all 6 submodes (no colormap) — raw per-channel diff.
 *   diff  + viridis colormap (absolute submode, "positive" cmap mode).
 *   computeMetrics — {mse,psnr,mae} vs a CPU reference, within tolerance.
 *
 * RUNNING:
 *   1. Bundle to plain JS:
 *        cd cairn/ui && npx esbuild \
 *          src/lib/cairn-plot/engine/__tests__/compare-pass.browser.ts \
 *          --bundle --format=esm \
 *          --outfile=src/lib/cairn-plot/engine/__tests__/compare-pass.browser.bundle.js
 *   2. Serve over http (file:// blocks module scripts):
 *        cd cairn/ui/src/lib/cairn-plot/engine/__tests__ && python3 -m http.server 8938
 *   3. Open BOTH in Chrome and read the PASS/FAIL status:
 *        http://localhost:8938/compare-pass.browser.html
 *        http://localhost:8938/compare-pass.browser.html?forceWebGL2
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

/** Mirror of compare.wgsl.ts's `diffChannel` (== image/webgl-diff.ts's computeDiffChannel). */
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

/** Full JS reference for one output pixel at destination `uvX` (screen-space [0,1)). */
function expectedPixel(pxA: number[], pxB: number[], uvX: number, params: CompareParams): RgbTriple {
  const cA = processSide(pxA, params);
  const cB = processSide(pxB, params);
  if (params.mode === "blend") {
    return [
      cA[0] + (cB[0] - cA[0]) * params.alpha,
      cA[1] + (cB[1] - cA[1]) * params.alpha,
      cA[2] + (cB[2] - cA[2]) * params.alpha,
    ];
  }
  if (params.mode === "diff") {
    const d: RgbTriple = [
      clamp01(diffChannel(cA[0], cB[0], params.diffSubmode)),
      clamp01(diffChannel(cA[1], cB[1], params.diffSubmode)),
      clamp01(diffChannel(cA[2], cB[2], params.diffSubmode)),
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
  // split
  return uvX < params.split ? cA : cB;
}

function buildRowTexture(device: Device, pixels: number[][]): Texture {
  const width = pixels.length;
  const tex = device.createTexture(width, 1, "rgba32float");
  const data = new Float32Array(width * 4);
  for (let i = 0; i < pixels.length; i++) data.set(pixels[i]!, i * 4);
  tex.write(data);
  return tex;
}

// Two distinct scene-linear rows (foreground vs reference). Width 4; the
// per-column DEST uv.x centers are (i+0.5)/4 = 0.125, 0.375, 0.625, 0.875.
const PIXELS_A: number[][] = [
  [0.0, 0.1, 0.2, 1.0],
  [0.3, 0.4, 0.5, 1.0],
  [0.6, 0.7, 0.8, 1.0],
  [1.0, 1.2, 0.9, 1.0],
];
const PIXELS_B: number[][] = [
  [0.2, 0.2, 0.2, 1.0],
  [0.1, 0.5, 0.3, 1.0],
  [0.9, 0.4, 0.7, 1.0],
  [0.5, 0.5, 0.5, 1.0],
];
const WIDTH = PIXELS_A.length;
const uvXOfCol = (i: number): number => (i + 0.5) / WIDTH;
const uvFull = { x: 0, y: 0, w: 1, h: 1 };

const BASE: Omit<CompareParams, "mode" | "split" | "alpha" | "diffSubmode"> = {
  exposureEV: 0,
  operator: "srgb",
  isScalar: false,
  hdrOut: false,
  uv: uvFull,
};

async function runCase(device: Device, label: string, params: CompareParams): Promise<boolean> {
  const texA = buildRowTexture(device, PIXELS_A);
  const texB = buildRowTexture(device, PIXELS_B);
  const target = device.createTexture(WIDTH, 1, "rgba8unorm");
  renderCompare(device, target, texA, texB, params);
  const out = await device.readback(target);
  texA.destroy();
  texB.destroy();
  target.destroy();

  if (!(out instanceof Uint8Array)) {
    report(false, `[${label}] readback should be Uint8Array, got ${out.constructor.name}`);
    return false;
  }
  let allOk = true;
  for (let i = 0; i < WIDTH; i++) {
    const expected = expectedPixel(PIXELS_A[i]!, PIXELS_B[i]!, uvXOfCol(i), params);
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
  report(allOk, `[${label}] all pixels within 1/255 of JS reference`);
  return allOk;
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
  const texA = buildRowTexture(device, PIXELS_A);
  const texB = buildRowTexture(device, PIXELS_B);
  const got = await computeMetrics(device, texA, texB);
  texA.destroy();
  texB.destroy();

  const ref = cpuMetrics(PIXELS_A, PIXELS_B);
  const mseOk = Math.abs(got.mse - ref.mse) <= 1e-4;
  const maeOk = Math.abs(got.mae - ref.mae) <= 1e-4;
  const psnrOk = Math.abs(got.psnr - ref.psnr) <= 1e-2;
  report(mseOk, `[${label}] mse gpu=${got.mse.toFixed(6)} cpu=${ref.mse.toFixed(6)}`);
  report(maeOk, `[${label}] mae gpu=${got.mae.toFixed(6)} cpu=${ref.mae.toFixed(6)}`);
  report(psnrOk, `[${label}] psnr gpu=${got.psnr.toFixed(4)} cpu=${ref.psnr.toFixed(4)}`);
  return mseOk && maeOk && psnrOk;
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
  return ok;
}

async function main(): Promise<void> {
  try {
    const forceWebGL2 = new URLSearchParams(location.search).has("forceWebGL2");
    report(true, `location.search = "${location.search}" -> forceWebGL2: ${forceWebGL2}`);
    const device = await getSharedDevice();
    const ok = await runAll(device, "shared");
    setOverallStatus(ok);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
