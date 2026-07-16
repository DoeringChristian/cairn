/**
 * WebGL2 RHI readback harness (Task 2 of the WebGPU engine, Sub-project 1).
 *
 * jsdom has no WebGL2, so this is NOT a unit test — it's a browser page,
 * driven via claude-in-chrome, that exercises `createWebGL2Device()` (Task 2)
 * end to end: upload a known 2x2 `rgba32float` texture, run the passthrough
 * pipeline (samples `t_bind0`, writes it out) to an offscreen `rgba8unorm`
 * target via `renderFullscreen`, `readback()`, and assert every output pixel
 * matches the input within 1/255.
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

async function main(): Promise<void> {
  try {
    const device = createWebGL2Device();
    const ok = await runReadbackTest(device);
    device.destroy();
    setOverallStatus(ok);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
