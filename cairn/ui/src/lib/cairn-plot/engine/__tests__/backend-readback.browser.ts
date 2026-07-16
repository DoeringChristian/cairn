/**
 * WebGL2 RHI readback harness (Task 2 of the WebGPU engine, Sub-project 1).
 *
 * jsdom has no WebGL2, so this is NOT a unit test — it's a browser page,
 * driven via claude-in-chrome, that exercises `createWebGL2Device()` (Task 2)
 * end to end with TWO cases:
 *
 *   1. Texture-only: upload a known 2x2 `rgba32float` texture, run the
 *      passthrough pipeline (a single `Texture` bind-group entry at binding
 *      0, samples `t_bind0`, writes it out unmodified) to an offscreen
 *      `rgba8unorm` target via `renderFullscreen`, `readback()`, and assert
 *      every output pixel matches the input within 1/255.
 *   2. Uniform + Sampler: upload a known 2x2 `rgba32float` texture (half the
 *      case-1 values), run the scale-bias pipeline
 *      (`shaders/scalebias.glsl.ts`) with a bind group containing a
 *      `Sampler` entry (binding 0, nearest — paired with the Texture entry
 *      at the same binding) AND a `{ uniform: Float32Array([2,2,2,1]) }`
 *      entry (binding 1), which exercises `applyUniformEntry`'s `u_bindN`
 *      float-vec4 path and `gl.bindSampler`. Asserts each output channel
 *      equals `clamp(halvedInput[c] * scale[c])` within 1/255 (scale's alpha
 *      component is 1, not 2, so the alpha channel is intentionally NOT the
 *      same expected byte as case 1 — proves the vec4 was uploaded
 *      per-component, not broadcast).
 *
 * RUNNING:
 *   1. Bundle this file to plain JS (browsers can't execute raw TS):
 *        cd cairn/ui && npx esbuild \
 *          src/lib/cairn-plot/engine/__tests__/backend-readback.browser.ts \
 *          --bundle --format=esm \
 *          --outfile=src/lib/cairn-plot/engine/__tests__/backend-readback.browser.bundle.js
 *   2. Serve over http (file:// is blocked for module scripts):
 *        cd cairn/ui/src/lib/cairn-plot/engine/__tests__ && python3 -m http.server 8934
 *   3. Open http://localhost:8934/backend-readback.browser.html in Chrome
 *      (claude-in-chrome) and read the PASS/FAIL line from the DOM/console.
 *
 * The generated `.bundle.js` is NOT committed (gitignored) — regenerate with
 * the command above whenever this harness or its imports change.
 */
import { createWebGL2Device } from "../webgl2/device";
import { passthroughGLSL } from "../shaders/passthrough.glsl";
import { scaleBiasGLSL } from "../shaders/scalebias.glsl";
import type { Device } from "../types";

const WIDTH = 2;
const HEIGHT = 2;

// Row-major 2x2 RGBA float pixels, all channel values in [0,1] so an
// rgba8unorm readback can represent them within 1/255.
// prettier-ignore
const INPUT_PIXELS: number[][] = [
  [0.10, 0.20, 0.30, 1.00], // row0, col0
  [0.40, 0.50, 0.60, 1.00], // row0, col1
  [0.70, 0.80, 0.90, 1.00], // row1, col0
  [1.00, 0.00, 0.55, 0.25], // row1, col1
];

function buildInputFloatData(): Float32Array {
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < INPUT_PIXELS.length; i++) {
    const px = INPUT_PIXELS[i]!;
    data.set(px, i * 4);
  }
  return data;
}

function expectedByteFor(channelValue: number): number {
  return Math.round(Math.max(0, Math.min(1, channelValue)) * 255);
}

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
  // A single well-known global + a document.title flag, for a script-based
  // (non-visual) check to poll if needed.
  (window as unknown as { __readbackTestResult?: "pass" | "fail" }).__readbackTestResult = pass ? "pass" : "fail";
  document.title = pass ? "READBACK PASS" : "READBACK FAIL";
}

async function runReadbackTest(device: Device): Promise<boolean> {
  let allOk = true;

  report(true, `device.backend = ${device.backend}`);
  report(
    true,
    `device.capabilities = ${JSON.stringify(device.capabilities)}`,
  );

  const srcTexture = device.createTexture(WIDTH, HEIGHT, "rgba32float");
  srcTexture.write(buildInputFloatData());

  const targetTexture = device.createTexture(WIDTH, HEIGHT, "rgba8unorm");

  const pipeline = device.createRenderPipeline({
    shaderWGSL: "/* placeholder: WebGPU backend is implemented in Task 3, not Task 2 */",
    shaderGLSL: passthroughGLSL,
    targetFormat: "rgba8unorm",
  });

  const bindGroup = device.createBindGroup(pipeline, [{ binding: 0, resource: srcTexture }]);

  device.renderFullscreen(targetTexture, pipeline, bindGroup);

  const out = await device.readback(targetTexture);
  if (!(out instanceof Uint8Array)) {
    report(false, `readback() of an rgba8unorm texture should return Uint8Array, got ${out.constructor.name}`);
    return false;
  }
  report(true, `readback() returned Uint8Array(${out.length})`);

  if (out.length !== WIDTH * HEIGHT * 4) {
    report(false, `readback length ${out.length} !== ${WIDTH * HEIGHT * 4}`);
    allOk = false;
  }

  for (let i = 0; i < INPUT_PIXELS.length; i++) {
    const px = INPUT_PIXELS[i]!;
    for (let c = 0; c < 4; c++) {
      const expected = expectedByteFor(px[c]!);
      const actual = out[i * 4 + c]!;
      const diff = Math.abs(actual - expected);
      const ok = diff <= 1; // within 1/255
      if (!ok) allOk = false;
      report(
        ok,
        `pixel[${i}].channel[${c}] expected=${expected} actual=${actual} (diff=${diff})`,
      );
    }
  }

  srcTexture.destroy();
  targetTexture.destroy();

  return allOk;
}

/**
 * Case 2: `Sampler` + `{uniform}` bind-group entry coverage. Uploads a 2x2
 * `rgba32float` texture whose values are HALF of `INPUT_PIXELS` (case 1),
 * runs `scaleBiasGLSL` (`sample * u_bind1 + u_bind2`) with a bind group of:
 *   - `{ binding: 0, resource: <Sampler nearest> }`  -> exercises
 *     `gl.bindSampler` in `renderFullscreen`.
 *   - `{ binding: 0, resource: <Texture> }`           -> t_bind0 (same unit).
 *   - `{ binding: 1, resource: { uniform: SCALE (Float32Array([2,2,2,1])) } }`
 *     -> exercises `applyUniformEntry`'s vec4-float path (u_bind1).
 * `u_bind2` (bias) is deliberately left out of the bind group (defaults to
 * `vec4(0)`). Expected output is `halvedInput[c] * SCALE[c]` per channel —
 * note SCALE's alpha component is 1 (not 2), so channel 3's expected byte is
 * HALF of `INPUT_PIXELS`'s (not equal to it) — this per-component asymmetry
 * is exactly what proves `u_bind1` was uploaded as a real 4-component vec4
 * rather than e.g. a broadcast scalar.
 */
async function runUniformSamplerTest(device: Device): Promise<boolean> {
  let allOk = true;

  const SCALE = [2, 2, 2, 1];

  const halvedInputData = new Float32Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < INPUT_PIXELS.length; i++) {
    const px = INPUT_PIXELS[i]!;
    halvedInputData.set(px.map((v) => v / 2), i * 4);
  }

  const srcTexture = device.createTexture(WIDTH, HEIGHT, "rgba32float");
  srcTexture.write(halvedInputData);

  const sampler = device.createSampler({ filter: "nearest" });

  const targetTexture = device.createTexture(WIDTH, HEIGHT, "rgba8unorm");

  const pipeline = device.createRenderPipeline({
    shaderWGSL: "/* placeholder: WebGPU backend is implemented in Task 3, not Task 2 */",
    shaderGLSL: scaleBiasGLSL,
    targetFormat: "rgba8unorm",
  });

  const bindGroup = device.createBindGroup(pipeline, [
    { binding: 0, resource: sampler },
    { binding: 0, resource: srcTexture },
    { binding: 1, resource: { uniform: new Float32Array(SCALE) } },
  ]);

  device.renderFullscreen(targetTexture, pipeline, bindGroup);

  const out = await device.readback(targetTexture);
  if (!(out instanceof Uint8Array)) {
    report(false, `[uniform+sampler] readback() of an rgba8unorm texture should return Uint8Array, got ${out.constructor.name}`);
    return false;
  }
  report(true, `[uniform+sampler] readback() returned Uint8Array(${out.length})`);

  if (out.length !== WIDTH * HEIGHT * 4) {
    report(false, `[uniform+sampler] readback length ${out.length} !== ${WIDTH * HEIGHT * 4}`);
    allOk = false;
  }

  for (let i = 0; i < INPUT_PIXELS.length; i++) {
    const px = INPUT_PIXELS[i]!;
    for (let c = 0; c < 4; c++) {
      const expected = expectedByteFor((px[c]! / 2) * SCALE[c]!);
      const actual = out[i * 4 + c]!;
      const diff = Math.abs(actual - expected);
      const ok = diff <= 1; // within 1/255
      if (!ok) allOk = false;
      report(
        ok,
        `[uniform+sampler] pixel[${i}].channel[${c}] expected=${expected} actual=${actual} (diff=${diff})`,
      );
    }
  }

  srcTexture.destroy();
  targetTexture.destroy();

  return allOk;
}

async function main(): Promise<void> {
  try {
    const device = createWebGL2Device();
    const okTexture = await runReadbackTest(device);
    const okUniformSampler = await runUniformSamplerTest(device);
    device.destroy();
    setOverallStatus(okTexture && okUniformSampler);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
