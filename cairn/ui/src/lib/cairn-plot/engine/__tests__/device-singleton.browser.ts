/**
 * Shared-device singleton harness (Task 4 of the WebGPU engine,
 * Sub-project 1) — `engine/device.ts`'s `getSharedDevice()`/
 * `resetSharedDevice()`.
 *
 * jsdom has no WebGPU, so — like `backend-readback.browser.ts` — this is NOT
 * a unit test, it's a browser page driven via claude-in-chrome.
 *
 * The engine is WebGPU-ONLY (the WebGL2 backend was removed — see
 * `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`); there is no
 * `?forceWebGL2` mode to exercise anymore. Assertions run on a plain page
 * load:
 *   1. `getSharedDevice()` called twice (back to back, before either
 *      resolves) returns the SAME `Device` instance (`===`).
 *   2. On a WebGPU-capable browser (`navigator.gpu` present), the resolved
 *      device's `.backend === "webgpu"`.
 *   3. `resetSharedDevice()` then `getSharedDevice()` again yields a FRESH
 *      instance (`!==` the first one).
 *   4. On a browser WITHOUT `navigator.gpu`, `getSharedDevice()` REJECTS
 *      (no in-engine fallback — see `engine/device.ts`'s module doc; the
 *      caller is responsible for falling back to the legacy CPU pane).
 *
 * RUNNING:
 *   1. Bundle this file to plain JS:
 *        cd cairn/ui && npx esbuild \
 *          src/lib/cairn-plot/engine/__tests__/device-singleton.browser.ts \
 *          --bundle --format=esm \
 *          --outfile=src/lib/cairn-plot/engine/__tests__/device-singleton.browser.bundle.js
 *   2. Serve over http (file:// is blocked for module scripts):
 *        cd cairn/ui/src/lib/cairn-plot/engine/__tests__ && python3 -m http.server 8935
 *   3. Open in Chrome (claude-in-chrome) and read the PASS/FAIL lines from
 *      the DOM/console:
 *        http://localhost:8935/device-singleton.browser.html
 *
 * The generated `.bundle.js` is NOT committed (gitignored) — regenerate with
 * the command above whenever this harness or its imports change.
 */
import { getSharedDevice, resetSharedDevice } from "../device";

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
  (window as unknown as { __deviceSingletonTestResult?: "pass" | "fail" }).__deviceSingletonTestResult = pass
    ? "pass"
    : "fail";
  document.title = pass ? "DEVICE SINGLETON PASS" : "DEVICE SINGLETON FAIL";
}

async function runNoWebGPUCheck(): Promise<boolean> {
  resetSharedDevice();
  try {
    const device = await getSharedDevice();
    report(false, `navigator.gpu is NOT available, but getSharedDevice() resolved anyway (backend=${device.backend}) — expected a rejection (no in-engine fallback)`);
    return false;
  } catch (err) {
    report(true, `navigator.gpu is NOT available -> getSharedDevice() REJECTED as expected (${err instanceof Error ? err.message : String(err)})`);
    return true;
  }
}

async function runDefaultModeChecks(): Promise<boolean> {
  let allOk = true;

  // 1. Two concurrent calls (before either resolves) return the same instance.
  const p1 = getSharedDevice();
  const p2 = getSharedDevice();
  const [d1, d2] = await Promise.all([p1, p2]);
  const sameInstance = d1 === d2;
  allOk = allOk && sameInstance;
  report(sameInstance, `getSharedDevice() called twice concurrently returns the SAME instance (backend=${d1.backend})`);

  // A third, later call (after the first has resolved) must also return the
  // same memoized instance.
  const d3 = await getSharedDevice();
  const stillSame = d3 === d1;
  allOk = allOk && stillSame;
  report(stillSame, `getSharedDevice() called again after resolution still returns the SAME instance`);

  // 2. The shared device is always WebGPU (the engine's only backend).
  const isWebGPU = d1.backend === "webgpu";
  allOk = allOk && isWebGPU;
  report(isWebGPU, `shared device backend === "webgpu" (actual: ${d1.backend})`);

  // 3. resetSharedDevice() + a fresh getSharedDevice() call yields a new instance.
  resetSharedDevice();
  const d4 = await getSharedDevice();
  const isFresh = d4 !== d1;
  allOk = allOk && isFresh;
  report(isFresh, `resetSharedDevice() then getSharedDevice() yields a FRESH instance (backend=${d4.backend})`);

  return allOk;
}

async function main(): Promise<void> {
  try {
    const hasWebGPU = "gpu" in navigator && !!navigator.gpu;
    report(true, `navigator.gpu present: ${hasWebGPU}`);
    const ok = hasWebGPU ? await runDefaultModeChecks() : await runNoWebGPUCheck();
    setOverallStatus(ok);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
