/**
 * WebGL2 + WebGPU RHI readback harness (Tasks 2 and 3 of the WebGPU engine,
 * Sub-project 1).
 *
 * jsdom has no WebGL2/WebGPU, so this is NOT a unit test — it's a browser
 * page, driven via claude-in-chrome, that exercises `createWebGL2Device()`
 * (Task 2) AND `createWebGPUDevice()` (Task 3) end to end, each with the
 * SAME two cases:
 *
 *   1. Texture-only: upload a known 2x2 `rgba32float` texture, run the
 *      passthrough pipeline (a single `Texture` bind-group entry at binding
 *      0, samples `t_bind0`, writes it out unmodified) to an offscreen
 *      `rgba8unorm` target via `renderFullscreen`, `readback()`, and assert
 *      every output pixel matches the input within 1/255.
 *   2. Uniform + Sampler: upload a known 2x2 `rgba32float` texture (half the
 *      case-1 values), run the scale-bias pipeline
 *      (`shaders/scalebias.glsl.ts` / `shaders/scalebias.wgsl.ts`) with a
 *      bind group containing a `Sampler` entry (binding 0, nearest — paired
 *      with the Texture entry at the same binding) AND a
 *      `{ uniform: Float32Array([2,2,2,1]) }` entry (binding 1). Asserts
 *      each output channel equals `clamp(halvedInput[c] * scale[c])` within
 *      1/255 (scale's alpha component is 1, not 2, so the alpha channel is
 *      intentionally NOT the same expected byte as case 1 — proves the vec4
 *      was uploaded per-component, not broadcast).
 *   3. SDR Surface channel order (WebGPU-only, `runSurfaceChannelOrderTest`):
 *      regression test for a fixed bug — `configureSDRSurface` configures the
 *      canvas with `navigator.gpu.getPreferredCanvasFormat()`, which is
 *      commonly `bgra8unorm`, not `rgba8unorm`. Renders a distinctive
 *      R!=G!=B color to a real `Surface` (not an offscreen `Texture`, unlike
 *      cases 1/2) and asserts `readback()` returns it in RGBA order — this
 *      is the one path a swapped R/B would be visible on.
 *   4. Bind-group lifecycle (`runBindGroupLifecycleTest`, both backends):
 *      regression test for a fixed bug — WebGPU's `createBindGroup` used to
 *      allocate fresh `GPUBuffer`s per call with no free path short of
 *      `device.destroy()`. Creates+`destroy?.()`s many bind groups (double-
 *      destroy included) and asserts it never throws.
 *
 * Beyond each backend individually matching the JS-computed expected
 * values, `main()` ALSO cross-compares WebGL2's raw readback bytes against
 * WebGPU's for both cases, byte-for-byte within 1/255 — this is what proves
 * "both backends produce identical results" (Task 3's stated goal), not
 * just "both independently match the reference".
 *
 * If `navigator.gpu` is absent (an automation browser without WebGPU), the
 * WebGPU half SKIPS gracefully (reported, not a failure) and the overall
 * status is driven by WebGL2 alone.
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
import { createWebGPUDevice } from "../webgpu/device";
import { passthroughGLSL } from "../shaders/passthrough.glsl";
import { scaleBiasGLSL } from "../shaders/scalebias.glsl";
import { passthroughWGSL } from "../shaders/passthrough.wgsl";
import { scaleBiasWGSL } from "../shaders/scalebias.wgsl";
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

interface TestResult {
  ok: boolean;
  out: Uint8Array | null;
}

async function runReadbackTest(device: Device, label: string): Promise<TestResult> {
  let allOk = true;

  report(true, `[${label}] device.backend = ${device.backend}`);
  report(
    true,
    `[${label}] device.capabilities = ${JSON.stringify(device.capabilities)}`,
  );

  const srcTexture = device.createTexture(WIDTH, HEIGHT, "rgba32float");
  srcTexture.write(buildInputFloatData());

  const targetTexture = device.createTexture(WIDTH, HEIGHT, "rgba8unorm");

  const pipeline = device.createRenderPipeline({
    shaderWGSL: passthroughWGSL,
    shaderGLSL: passthroughGLSL,
    targetFormat: "rgba8unorm",
  });

  const bindGroup = device.createBindGroup(pipeline, [{ binding: 0, resource: srcTexture }]);

  device.renderFullscreen(targetTexture, pipeline, bindGroup);

  const out = await device.readback(targetTexture);
  if (!(out instanceof Uint8Array)) {
    report(false, `[${label}] readback() of an rgba8unorm texture should return Uint8Array, got ${out.constructor.name}`);
    return { ok: false, out: null };
  }
  report(true, `[${label}] readback() returned Uint8Array(${out.length})`);

  if (out.length !== WIDTH * HEIGHT * 4) {
    report(false, `[${label}] readback length ${out.length} !== ${WIDTH * HEIGHT * 4}`);
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
        `[${label}] pixel[${i}].channel[${c}] expected=${expected} actual=${actual} (diff=${diff})`,
      );
    }
  }

  srcTexture.destroy();
  targetTexture.destroy();

  return { ok: allOk, out };
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
async function runUniformSamplerTest(device: Device, label: string): Promise<TestResult> {
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
    shaderWGSL: scaleBiasWGSL,
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
    report(false, `[${label}][uniform+sampler] readback() of an rgba8unorm texture should return Uint8Array, got ${out.constructor.name}`);
    return { ok: false, out: null };
  }
  report(true, `[${label}][uniform+sampler] readback() returned Uint8Array(${out.length})`);

  if (out.length !== WIDTH * HEIGHT * 4) {
    report(false, `[${label}][uniform+sampler] readback length ${out.length} !== ${WIDTH * HEIGHT * 4}`);
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
        `[${label}][uniform+sampler] pixel[${i}].channel[${c}] expected=${expected} actual=${actual} (diff=${diff})`,
      );
    }
  }

  srcTexture.destroy();
  targetTexture.destroy();

  return { ok: allOk, out };
}

/**
 * Regression test for the fixed "SDR surface readback swaps R/B" bug
 * (`engine/webgpu/device.ts`'s `readback()`). WebGPU-only — WebGL2's SDR
 * surface always readbacks via `gl.readPixels(..., gl.RGBA, ...)`, which
 * has no channel-order ambiguity. Renders a distinctive `R != G != B` color
 * to a REAL `Surface` (not an offscreen `Texture`, unlike every other case
 * in this file — a surface is the only target whose native GPU format can
 * legitimately differ from the `TextureFormat` requested) and asserts
 * `readback()` returns RGBA order. Before the fix, a `bgra8unorm`-preferred
 * canvas (the common case on Chrome/macOS) would return this color with R
 * and B swapped.
 */
async function runSurfaceChannelOrderTest(device: Device, label: string): Promise<boolean> {
  if (device.backend !== "webgpu") {
    report(true, `[${label}][surface-channel-order] SKIPPED — only WebGPU's SDR surface format can differ from rgba8unorm`);
    return true;
  }

  // R, G, B, A all distinct so an R/B swap is unambiguously detectable
  // (distinguishable from e.g. a G/B swap too, though that's not the bug
  // being guarded against here).
  const COLOR = [0.8, 0.4, 0.2, 1.0];
  const data = new Float32Array(WIDTH * HEIGHT * 4);
  for (let i = 0; i < WIDTH * HEIGHT; i++) data.set(COLOR, i * 4);

  const canvas = document.createElement("canvas");
  const surface = device.createSurface(canvas, { hdr: false });
  surface.configure(WIDTH, HEIGHT);

  const srcTexture = device.createTexture(WIDTH, HEIGHT, "rgba32float");
  srcTexture.write(data);

  const pipeline = device.createRenderPipeline({
    shaderWGSL: passthroughWGSL,
    shaderGLSL: passthroughGLSL,
    targetFormat: "rgba8unorm",
  });
  const bindGroup = device.createBindGroup(pipeline, [{ binding: 0, resource: srcTexture }]);

  device.renderFullscreen(surface, pipeline, bindGroup);

  const out = await device.readback(surface);
  let allOk = true;
  if (!(out instanceof Uint8Array)) {
    report(false, `[${label}][surface-channel-order] readback() of an SDR surface should return Uint8Array, got ${out.constructor.name}`);
    allOk = false;
  } else {
    for (let c = 0; c < 4; c++) {
      const expected = expectedByteFor(COLOR[c]!);
      const actual = out[c]!;
      const diff = Math.abs(actual - expected);
      const ok = diff <= 1; // within 1/255
      if (!ok) allOk = false;
      report(
        ok,
        `[${label}][surface-channel-order] pixel[0].channel[${c}] expected=${expected} actual=${actual} (diff=${diff})`,
      );
    }
  }

  bindGroup.destroy?.();
  srcTexture.destroy();

  return allOk;
}

/**
 * Regression test for the fixed "unbounded per-`createBindGroup()` GPU
 * buffer allocation" bug (`engine/webgpu/device.ts`'s `WGPUBindGroup`).
 * Creates many bind groups against the same pipeline (mimicking a per-frame
 * render loop rebuilding its bind group every frame) and `destroy?.()`s
 * each one — including a deliberate DOUBLE `destroy?.()` per bind group, to
 * confirm idempotency. Runs on both backends: WebGPU's `destroy()` frees
 * owned `GPUBuffer`s; WebGL2's is a documented no-op (`GLBindGroup` owns no
 * GPU resources) — the assertion is simply "never throws", proving the
 * optional `BindGroup.destroy?()` RHI contract is honored uniformly.
 */
async function runBindGroupLifecycleTest(device: Device, label: string): Promise<boolean> {
  const ITERATIONS = 50;
  try {
    const pipeline = device.createRenderPipeline({
      shaderWGSL: scaleBiasWGSL,
      shaderGLSL: scaleBiasGLSL,
      targetFormat: "rgba8unorm",
    });
    const texture = device.createTexture(1, 1, "rgba32float");
    texture.write(new Float32Array([0.5, 0.5, 0.5, 1]));
    const sampler = device.createSampler({ filter: "nearest" });

    for (let i = 0; i < ITERATIONS; i++) {
      const bindGroup = device.createBindGroup(pipeline, [
        { binding: 0, resource: sampler },
        { binding: 0, resource: texture },
        { binding: 1, resource: { uniform: new Float32Array([1, 1, 1, 1]) } },
      ]);
      bindGroup.destroy?.();
      bindGroup.destroy?.(); // idempotency: a second destroy must not throw.
    }

    texture.destroy();
    report(
      true,
      `[${label}][bindgroup-lifecycle] created+double-destroyed ${ITERATIONS} bind groups without throwing`,
    );
    return true;
  } catch (err) {
    report(
      false,
      `[${label}][bindgroup-lifecycle] threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    return false;
  }
}

/**
 * Cross-backend parity check: compares two `Uint8Array` readbacks
 * (typically one from WebGL2, one from WebGPU) byte-for-byte within 1/255.
 * This is the assertion that proves "both backends produce identical
 * results" — each backend already independently matches the JS-computed
 * reference values (via `runReadbackTest`/`runUniformSamplerTest`), but
 * that alone doesn't rule out both being wrong in the SAME way.
 */
function compareBackends(label: string, a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b) {
    report(false, `[parity][${label}] cannot compare — a missing readback (a=${!!a}, b=${!!b})`);
    return false;
  }
  if (a.length !== b.length) {
    report(false, `[parity][${label}] length mismatch: ${a.length} !== ${b.length}`);
    return false;
  }
  let allOk = true;
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i]! - b[i]!);
    const ok = diff <= 1; // within 1/255
    if (!ok) {
      allOk = false;
      report(ok, `[parity][${label}] byte[${i}] webgl2=${a[i]} webgpu=${b[i]} (diff=${diff})`);
    }
  }
  report(allOk, `[parity][${label}] WebGL2 vs WebGPU readback identical within 1/255 (${a.length} bytes)`);
  return allOk;
}

async function main(): Promise<void> {
  try {
    // --- WebGL2 (always available; the reduced/SDR fallback backend) ---
    const glDevice = createWebGL2Device();
    const glTexture = await runReadbackTest(glDevice, "webgl2");
    const glUniformSampler = await runUniformSamplerTest(glDevice, "webgl2");
    const glSurfaceChannelOrderOk = await runSurfaceChannelOrderTest(glDevice, "webgl2");
    const glBindGroupLifecycleOk = await runBindGroupLifecycleTest(glDevice, "webgl2");
    glDevice.destroy();
    const webgl2Ok = glTexture.ok && glUniformSampler.ok && glSurfaceChannelOrderOk && glBindGroupLifecycleOk;

    // --- WebGPU (the primary/full-featured backend) — SKIP gracefully if
    // navigator.gpu isn't available in this browser, per the Task 3 brief. ---
    let webgpuOk = true;
    let webgpuRan = false;
    let gpuTexture: TestResult = { ok: true, out: null };
    let gpuUniformSampler: TestResult = { ok: true, out: null };
    if ("gpu" in navigator && navigator.gpu) {
      webgpuRan = true;
      const gpuDevice = await createWebGPUDevice();
      gpuTexture = await runReadbackTest(gpuDevice, "webgpu");
      gpuUniformSampler = await runUniformSamplerTest(gpuDevice, "webgpu");
      const gpuSurfaceChannelOrderOk = await runSurfaceChannelOrderTest(gpuDevice, "webgpu");
      const gpuBindGroupLifecycleOk = await runBindGroupLifecycleTest(gpuDevice, "webgpu");
      gpuDevice.destroy();
      webgpuOk = gpuTexture.ok && gpuUniformSampler.ok && gpuSurfaceChannelOrderOk && gpuBindGroupLifecycleOk;
    } else {
      report(true, "[webgpu] SKIPPED — navigator.gpu is not available in this browser");
    }

    // --- Cross-backend parity: both backends must agree, not just both
    // independently match the JS reference. Only meaningful if WebGPU ran. ---
    let parityOk = true;
    if (webgpuRan) {
      parityOk =
        compareBackends("texture-path", glTexture.out, gpuTexture.out) &&
        compareBackends("uniform+sampler-path", glUniformSampler.out, gpuUniformSampler.out);
    }

    setOverallStatus(webgl2Ok && webgpuOk && parityOk);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
