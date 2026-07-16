/**
 * `plot-gpu-image-addon.tsx`'s capability-gated activation — Case 6 of the
 * `GpuImagePane` harness (Task 6/8 of the WebGPU engine, Sub-project 1), split
 * into its OWN bundle/`<script type="module">` (see
 * `gpu-image-pane.browser.ts`'s doc comment for why: the addon's top-level
 * `void tryRegister()` side effect must observe the page's real, unpatched
 * globals — only a genuinely separate `<script>` tag, its own module graph,
 * guarantees that; a dynamic `import()` inside the SAME single-file esbuild
 * bundle as the rest of the harness does not).
 *
 * `gpu-image-pane.browser.html` loads, in document order:
 *   1. `gpu-image-pane.browser.bundle.js` (cases 1-5, `type="module"`,
 *      deferred);
 *   2. THIS file's bundle (`type="module"`, deferred, runs after (1) starts
 *      — see below for how it still waits for (1) to actually FINISH before
 *      writing the page's final #status).
 *
 * Task 8 changed the addon's activation contract from a registry overwrite
 * (`window.__cairnPlotRegisterRenderer("image", …)`) to a window SEAM
 * (`window.__cairnPlotGpuImagePane`) + a default-on capability flag
 * (`window.__cairnPlotUseGpuImage`) + a `GPU_IMAGE_READY_EVENT` wake-up — see
 * `plot-gpu-image-addon.tsx`'s module doc for why (a raw `GpuImagePane` has no
 * owned viewport state, and the old registry-overwrite raced the mount).
 * Asserts the addon, once `getSharedDevice()` resolves: (a) sets
 * `window.__cairnPlotGpuImagePane` to a function (the pane component), (b)
 * sets `window.__cairnPlotGpuComparePane` likewise, (c) defaults
 * `window.__cairnPlotUseGpuImage` to `true`, (d) sets
 * `window.__cairnPlotGpuImageLoaded = true`, and (e) dispatches the
 * ready event.
 */
import "../../../../plot-gpu-image-addon";

declare global {
  interface Window {
    // NOTE: `__cairnPlotGpuImageLoaded` / `__cairnPlotGpuImagePane` /
    // `__cairnPlotGpuComparePane` / `__cairnPlotUseGpuImage` are already
    // globally declared by the addon module (transitively imported above) —
    // do NOT re-declare them here or the types conflict (TS2717). Only the
    // harness-local globals below.
    __gpuImagePaneTestResult?: "pass" | "fail";
    __gpuImagePaneMainDone?: boolean;
    __gpuReadyEventSeen?: boolean;
  }
}

window.addEventListener("cairn-plot:gpu-image-ready", () => {
  window.__gpuReadyEventSeen = true;
});

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
  window.__gpuImagePaneTestResult = pass ? "pass" : "fail";
  document.title = pass ? "GPU IMAGE PANE PASS" : "GPU IMAGE PANE FAIL";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 8000, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

async function main(): Promise<void> {
  try {
    const gotFlag = await waitFor(() => window.__cairnPlotGpuImageLoaded === true);
    report(gotFlag, "gpu-image addon sets __cairnPlotGpuImageLoaded after getSharedDevice() resolves");

    const gotPane = typeof window.__cairnPlotGpuImagePane === "function";
    report(gotPane, "gpu-image addon sets window.__cairnPlotGpuImagePane to the pane component");

    const gotComparePane = typeof window.__cairnPlotGpuComparePane === "function";
    report(gotComparePane, "gpu-image addon sets window.__cairnPlotGpuComparePane to the compare pane component");

    const gotUseFlag = window.__cairnPlotUseGpuImage === true;
    report(gotUseFlag, "gpu-image addon defaults window.__cairnPlotUseGpuImage to true on success");

    const gotReadyEvent = await waitFor(() => window.__gpuReadyEventSeen === true);
    report(gotReadyEvent, "gpu-image addon dispatches the gpu-image-ready event on success");

    const addonOk = gotFlag && gotPane && gotComparePane && gotUseFlag && gotReadyEvent;

    // Wait for the sibling bundle (cases 1-5) to finish, then combine into
    // the page's FINAL authoritative status (this script runs last).
    const mainDone = await waitFor(() => window.__gpuImagePaneMainDone === true, 20000);
    report(mainDone, "sibling gpu-image-pane.browser.bundle.js (cases 1-5) completed");
    const mainOk = window.__gpuImagePaneTestResult === "pass";
    report(mainOk, "sibling gpu-image-pane.browser.bundle.js (cases 1-5) result was PASS");

    setOverallStatus(addonOk && mainDone && mainOk);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
