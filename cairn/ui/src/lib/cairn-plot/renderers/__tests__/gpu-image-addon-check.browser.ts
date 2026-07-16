/**
 * `plot-gpu-image-addon.tsx`'s capability-gated registration — Case 6 of the
 * `GpuImagePane` harness (Task 6 of the WebGPU engine, Sub-project 1), split
 * into its OWN bundle/`<script type="module">` (see
 * `gpu-image-pane.browser.ts`'s doc comment for why: the addon's top-level
 * `void tryRegister()` side effect must observe a test-installed
 * `window.__cairnPlotRegisterRenderer` stub that exists BEFORE the addon
 * module first evaluates — only a genuinely separate `<script>` tag,
 * following a plain (non-module) inline stub-setup `<script>`, guarantees
 * that ordering; a dynamic `import()` inside the SAME single-file esbuild
 * bundle as the rest of the harness does not.
 *
 * `gpu-image-pane.browser.html` loads, in document order:
 *   1. an inline, non-module `<script>` that installs the
 *      `window.__cairnPlotRegisterRenderer` stub (regular scripts run
 *      synchronously during HTML parsing, before any deferred module script);
 *   2. `gpu-image-pane.browser.bundle.js` (cases 1-5, `type="module"`,
 *      deferred);
 *   3. THIS file's bundle (`type="module"`, deferred, runs after (2) starts
 *      — see below for how it still waits for (2) to actually FINISH before
 *      writing the page's final #status).
 *
 * Asserts the addon (a) registers `"image"`/`"imagehdr"` and (b) sets
 * `window.__cairnPlotGpuImageLoaded = true`, once `getSharedDevice()`
 * resolves — i.e. the "capability flag" gate the Task 6 brief asks for.
 */
import "../../../../plot-gpu-image-addon";

declare global {
  interface Window {
    // NOTE: `__cairnPlotRegisterRenderer` / `__cairnPlotGpuImageLoaded` are
    // already globally declared by `plot-bootstrap.tsx` / the addon module
    // (transitively imported above) — do NOT re-declare them here or the
    // types conflict (TS2717). Only the harness-local globals below.
    __gpuAddonRegistered?: string[];
    __gpuImagePaneTestResult?: "pass" | "fail";
    __gpuImagePaneMainDone?: boolean;
  }
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

    const registered = window.__gpuAddonRegistered ?? [];
    const gotImage = registered.includes("image");
    const gotHdr = registered.includes("imagehdr");
    report(gotImage, `gpu-image addon registers "image" (saw: ${JSON.stringify(registered)})`);
    report(gotHdr, `gpu-image addon registers "imagehdr" (saw: ${JSON.stringify(registered)})`);

    const addonOk = gotFlag && gotImage && gotHdr;

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
