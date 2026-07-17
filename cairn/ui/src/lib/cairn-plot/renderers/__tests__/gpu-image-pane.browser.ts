/**
 * `GpuImagePane` (Task 6 of the WebGPU engine, Sub-project 1) — the first
 * LIVE on-screen browser harness for a React component built on the RHI.
 *
 * jsdom has no WebGPU, so — like every other `*.browser.ts` harness in
 * `engine/__tests__/` — this is NOT a unit test, it's a browser page driven
 * via claude-in-chrome. Uses `React.createElement` (no JSX) so this stays a
 * plain `.ts` file per the existing harness convention.
 *
 * CASES:
 *   1. Mount an HDR-float `GpuImagePane`: assert a live `<canvas>` mounts
 *      (`[data-gpu-image-canvas]`) and the TEV overlay `<canvas>` is present.
 *   2. Readback (via `createImageBitmap` + an offscreen 2D canvas — NOT
 *      `canvas.getContext("2d")` on the pane's own canvas, which already owns
 *      a webgpu context) checked structurally (canvas non-blank); a
 *      pixel-exact comparison against `image/tonemap.ts` is NOT asserted here
 *      since canvas-compositing color management can introduce small
 *      non-deterministic differences (the byte-exact parity checks live in
 *      `engine/__tests__/image-pass.browser.ts`, which reads back an
 *      offscreen texture directly, bypassing canvas compositing).
 *   3. Alt+wheel changes the viewport (zoom != 1); a plain wheel (no Alt)
 *      leaves it unchanged (the `useModifierKey` Alt-gate — plain wheel must
 *      keep scrolling the PAGE, never hijacked).
 *   4. Double-click resets the viewport to `{zoom:1, pan:{x:0,y:0}}` (Q17).
 *   5. Mounting ~30 panes never leaves more than `MAX_LIVE_SWAPCHAINS` (12)
 *      panes with LIVE GPU resources at once (`engine/pool.ts`'s LRU cap).
 *   5b. Park-aware render: mount MORE visible (on-screen, never scrolled
 *      away) panes than `MAX_LIVE_SWAPCHAINS`, so the LRU cap PARKS some of
 *      them while they stay on-screen (`engine/pool.ts`'s `isCanvasLive`
 *      finds one). Triggering a re-render on that still-parked pane (an
 *      exposure change) must transparently RESTORE it first — checked
 *      structurally (non-blank content) for the same canvas-compositing
 *      reason as case 2. Proves a re-render on a cap-parked-but-visible pane
 *      never paints into a destroyed/parked GPU context.
 *   6. The gpu-image addon's CAPABILITY-GATED registration
 *      (`plot-gpu-image-addon.tsx`): stub `__cairnPlotRegisterRenderer`,
 *      import the addon module, and assert it registers `"image"`/
 *      `"imagehdr"` and sets `__cairnPlotGpuImageLoaded` once
 *      `getSharedDevice()` resolves.
 *
 * No console.error during the whole run is asserted throughout (a
 * `console.error` override records every call; the final status factors it
 * in).
 *
 * RUNNING:
 *   1. Bundle: cd cairn/ui && npx esbuild \
 *        src/lib/cairn-plot/renderers/__tests__/gpu-image-pane.browser.ts \
 *        --bundle --format=esm --jsx=automatic \
 *        --outfile=src/lib/cairn-plot/renderers/__tests__/gpu-image-pane.browser.bundle.js
 *      (`--jsx=automatic` is REQUIRED — same gotcha as
 *      `engine-fallback.browser.ts`'s RUNNING doc: the project's root
 *      `tsconfig.json` is a references-only stub esbuild's standalone CLI
 *      does not resolve through to `tsconfig.app.json`'s `"jsx": "react-jsx"`,
 *      so without this flag esbuild falls back to the classic
 *      `React.createElement` factory, which throws `ReferenceError: React is
 *      not defined` for `GpuImagePane` — Q25 root-caused this file's own
 *      long-standing FAIL tab to exactly this missing flag, not a product
 *      regression.)
 *   1b. Bundle Case 6's separate script the same way:
 *        npx esbuild \
 *        src/lib/cairn-plot/renderers/__tests__/gpu-image-addon-check.browser.ts \
 *        --bundle --format=esm --jsx=automatic \
 *        --outfile=src/lib/cairn-plot/renderers/__tests__/gpu-image-addon-check.browser.bundle.js
 *   2. Serve: cd cairn/ui/src/lib/cairn-plot/renderers/__tests__ && python3 -m http.server 8937
 *   3. Open in Chrome (claude-in-chrome):
 *        http://localhost:8937/gpu-image-pane.browser.html
 *
 * The generated `.bundle.js` files are NOT committed (gitignored) —
 * regenerate with the commands above whenever this harness, its sibling
 * Case-6 script, or their imports change.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import GpuImagePane, { type HdrData } from "../GpuImagePane";
import { getLiveSwapchainCount, isCanvasLive, MAX_LIVE_SWAPCHAINS } from "../../engine/pool";
import type { Viewport as ImageViewport } from "../../hooks/use-image-viewport";

declare global {
  interface Window {
    __gpuImagePaneTestResult?: "pass" | "fail";
    /** Set once this bundle's `main()` settles — the sibling
     *  `gpu-image-addon-check.browser.ts` bundle polls this to combine its
     *  own (independent) result into the page's final #status. */
    __gpuImagePaneMainDone?: boolean;
  }
}

const h = React.createElement;

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
  (window as unknown as { __gpuImagePaneTestResult?: "pass" | "fail" }).__gpuImagePaneTestResult = pass
    ? "pass"
    : "fail";
  document.title = pass ? "GPU IMAGE PANE PASS" : "GPU IMAGE PANE FAIL";
}

// Track console.error calls for the whole run.
const consoleErrors: string[] = [];
const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  consoleErrors.push(args.map(String).join(" "));
  origConsoleError(...args);
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 6000, stepMs = 20): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(stepMs);
  }
  return predicate();
}

// ---------------------------------------------------------------------------
// A small 4x4 grayscale HDR gradient (scene-linear), includes a value >1.0.
// ---------------------------------------------------------------------------
function buildHdr(): HdrData {
  const values = [0.0, 0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 0.05, 0.3, 0.6, 0.9, 1.2, 1.8, 2.5, 3.0];
  return { data: new Float32Array(values), shape: [4, 4], dtype: "<f4" };
}

/** Read back a canvas's CURRENT bitmap via createImageBitmap (works
 *  regardless of the canvas's own context type — webgpu/2d — unlike calling
 *  `canvas.getContext("2d")`, which would conflict with an already-created
 *  webgpu context on the SAME canvas). */
async function readbackCanvas(canvas: HTMLCanvasElement): Promise<ImageData> {
  const bitmap = await createImageBitmap(canvas);
  const tmp = document.createElement("canvas");
  tmp.width = bitmap.width;
  tmp.height = bitmap.height;
  const ctx = tmp.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, tmp.width, tmp.height);
}

function isNonBlank(img: ImageData): boolean {
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] !== 0 || img.data[i + 1] !== 0 || img.data[i + 2] !== 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Case 1-4: mount one HDR pane, readback + interaction.
// ---------------------------------------------------------------------------
async function runSingleCase(): Promise<boolean> {
  let ok = true;
  const container = document.createElement("div");
  container.id = "harness-single";
  container.style.width = "320px";
  container.style.height = "320px";
  document.body.appendChild(container);

  let latestViewport: ImageViewport = { zoom: 1, pan: { x: 0, y: 0 } };
  const hdr = buildHdr();
  const exposureEV = 0.5;
  const operator = "aces";
  const root = createRoot(container);

  function Harness() {
    const [viewport, setViewport] = React.useState<ImageViewport>(latestViewport);
    const onViewportChange = (v: ImageViewport) => {
      latestViewport = v;
      setViewport(v);
    };
    return h(
      "div",
      { style: { width: "300px", height: "300px" } },
      h(GpuImagePane, {
        hdr,
        tonemap: operator,
        exposure: exposureEV,
        zoom: viewport.zoom,
        pan: viewport.pan,
        onViewportChange,
        label: "gpu-image-pane-test",
      }),
    );
  }
  root.render(h(Harness));

  const gpuCanvasFound = await waitFor(() => !!container.querySelector("canvas[data-gpu-image-canvas]"));
  report(gpuCanvasFound, "GPU canvas mounts");
  ok = ok && gpuCanvasFound;
  if (!gpuCanvasFound) {
    root.unmount();
    container.remove();
    return false;
  }
  const gpuCanvas = container.querySelector("canvas[data-gpu-image-canvas]") as HTMLCanvasElement;

  const readyAttr = await waitFor(
    () => container.querySelector('[data-gpu-backend-ready="true"]') !== null,
  );
  report(readyAttr, "pane's pool handle acquired (data-gpu-backend-ready)");
  ok = ok && readyAttr;

  const overlayCanvases = container.querySelectorAll("canvas");
  const hasOverlayCanvas = overlayCanvases.length >= 2;
  report(hasOverlayCanvas, `TEV overlay canvas present (found ${overlayCanvases.length} canvases, want >=2)`);
  ok = ok && hasOverlayCanvas;

  // Wait for the GPU canvas to actually have non-blank content. Checked
  // structurally (not pixel-exact) — see this file's module doc note on why.
  const gotNonBlank = await (async () => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const img = await readbackCanvas(gpuCanvas);
      if (isNonBlank(img)) return true;
      await sleep(50);
    }
    return false;
  })();
  report(gotNonBlank, "GPU canvas has non-blank rendered content");
  ok = ok && gotNonBlank;

  // --- Interaction: alt+wheel zooms, plain wheel does not ---
  const viewportEl = container.querySelector("[data-gpu-image-viewport]") as HTMLElement;
  const rect = viewportEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // `useImageViewport`'s Alt-gate reads `useModifierKey()`, which tracks REAL
  // window `keydown`/`keyup` events for Alt/Control/Meta — NOT a WheelEvent's
  // own `altKey` property (that property is only consulted for parity with
  // how a browser reports the wheel event itself; the gate's state comes
  // from the separate keyboard listener). So "holding Alt" must be simulated
  // via an actual `keydown`/`keyup` pair around the wheel dispatch.
  const zoomBefore = latestViewport.zoom;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
  await sleep(20);
  viewportEl.dispatchEvent(
    new WheelEvent("wheel", { deltaY: -100, altKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true }),
  );
  await waitFor(() => latestViewport.zoom !== zoomBefore);
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true }));
  await sleep(20);
  const altWheelZoomed = latestViewport.zoom !== zoomBefore;
  report(altWheelZoomed, `alt+wheel changes viewport zoom (before=${zoomBefore}, after=${latestViewport.zoom})`);
  ok = ok && altWheelZoomed;

  const zoomAfterAlt = latestViewport.zoom;
  viewportEl.dispatchEvent(
    new WheelEvent("wheel", { deltaY: -100, altKey: false, clientX: cx, clientY: cy, bubbles: true, cancelable: true }),
  );
  await sleep(150);
  const plainWheelUnchanged = latestViewport.zoom === zoomAfterAlt;
  report(plainWheelUnchanged, `plain wheel (no Alt) leaves viewport unchanged (zoom stayed ${latestViewport.zoom})`);
  ok = ok && plainWheelUnchanged;

  // --- double-click resets to home ---
  viewportEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  const reset = await waitFor(() => latestViewport.zoom === 1 && latestViewport.pan.x === 0 && latestViewport.pan.y === 0);
  report(
    reset,
    `double-click resets viewport to home (zoom=${latestViewport.zoom}, pan=${JSON.stringify(latestViewport.pan)})`,
  );
  ok = ok && reset;

  root.unmount();
  container.remove();
  return ok;
}

// ---------------------------------------------------------------------------
// Case 5: pool cap under many panes.
// ---------------------------------------------------------------------------
async function runPoolCapCase(): Promise<boolean> {
  const N = 30;
  const container = document.createElement("div");
  container.id = "harness-many";
  container.style.width = "200px";
  container.style.height = `${N * 40}px`;
  document.body.appendChild(container);

  const roots: ReturnType<typeof createRoot>[] = [];
  for (let i = 0; i < N; i++) {
    const paneEl = document.createElement("div");
    paneEl.style.width = "64px";
    paneEl.style.height = "64px";
    container.appendChild(paneEl);
    const hdr: HdrData = { data: new Float32Array([0.1 * i, 0.2, 0.3, 0.4]), shape: [2, 2], dtype: "<f4" };
    const root = createRoot(paneEl);
    root.render(h(GpuImagePane, { hdr, tonemap: "srgb", exposure: 0, label: `pane-${i}` }));
    roots.push(root);
  }

  await waitFor(() => container.querySelectorAll("canvas[data-gpu-image-canvas]").length === N);
  // Give render effects a beat to settle (async acquirePane + upload + render chain).
  await sleep(1500);

  const live = getLiveSwapchainCount();
  const capOk = live <= MAX_LIVE_SWAPCHAINS;
  report(
    capOk,
    `mounted ${N} panes -> ${live} live swapchains (cap=${MAX_LIVE_SWAPCHAINS}): ${capOk ? "within cap" : "OVER CAP"}`,
  );

  for (const root of roots) root.unmount();
  container.remove();
  return capOk;
}

// ---------------------------------------------------------------------------
// Case 5b: park-aware render — a pane PARKED by LRU cap pressure (NOT by
// scrolling off-screen; every pane here stays on-screen the whole time) must
// RESTORE before rendering, so a re-render (an exposure change, here) shows
// the CORRECT new frame — never stale content from before it was parked.
// This is the many-panes-gallery scenario `engine/pool.ts`'s module doc
// describes: more visible panes than `MAX_LIVE_SWAPCHAINS`, so the LRU parks
// some of them even though nothing ever left the viewport.
// ---------------------------------------------------------------------------
async function runParkAwareRenderCase(): Promise<boolean> {
  let ok = true;
  const N = MAX_LIVE_SWAPCHAINS + 4; // over-cap by 4 with everything visible
  const size = 56;
  const cols = 8;
  const container = document.createElement("div");
  container.id = "harness-park-aware";
  container.style.display = "grid";
  container.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
  container.style.gap = "4px";
  // Pinned to the viewport (NOT normal document flow): `#result` above
  // accumulates one line per `report()` call as this run progresses, which
  // would otherwise keep pushing an in-flow container further down the page
  // — eventually scrolling some panes below the fold MID-TEST and flipping
  // their `IntersectionObserver` state to "not intersecting" for real
  // (parking them off-screen instead of by LRU-cap pressure alone), which
  // this case does not intend to exercise.
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.zIndex = "9999";
  container.style.background = "#000";
  document.body.appendChild(container);

  const hdrValues = [0.0, 0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 0.05, 0.3, 0.6, 0.9, 1.2, 1.8, 2.5, 3.0];
  const buildHdrN = (): HdrData => ({ data: new Float32Array(hdrValues), shape: [4, 4], dtype: "<f4" });
  const operator = "srgb";
  const initialExposure = 0.2;
  const newExposure = 1.7;

  const setExposureFns: Array<(e: number) => void> = new Array(N);
  const roots: ReturnType<typeof createRoot>[] = [];

  function Pane({ index }: { index: number }) {
    const [exposure, setExposure] = React.useState(initialExposure);
    setExposureFns[index] = setExposure;
    return h(GpuImagePane, {
      hdr: buildHdrN(),
      tonemap: operator,
      exposure,
      label: `park-pane-${index}`,
    });
  }

  for (let i = 0; i < N; i++) {
    const paneEl = document.createElement("div");
    paneEl.style.width = `${size}px`;
    paneEl.style.height = `${size}px`;
    container.appendChild(paneEl);
    const root = createRoot(paneEl);
    roots.push(root);
    root.render(h(Pane, { index: i }));
  }

  const cleanup = () => {
    for (const root of roots) root.unmount();
    container.remove();
  };

  const mounted = await waitFor(() => container.querySelectorAll("canvas[data-gpu-image-canvas]").length === N);
  report(mounted, `[park-aware] mounted ${N} visible panes (cap=${MAX_LIVE_SWAPCHAINS})`);
  if (!mounted) {
    cleanup();
    return false;
  }
  // Let the mount-time acquire/upload/render chain (and its LRU eviction) settle.
  await sleep(2000);

  const canvases = Array.from(container.querySelectorAll("canvas[data-gpu-image-canvas]")) as HTMLCanvasElement[];
  const liveCountAfterMount = getLiveSwapchainCount();
  const overCapPresent = liveCountAfterMount <= MAX_LIVE_SWAPCHAINS && N > MAX_LIVE_SWAPCHAINS;
  report(
    overCapPresent,
    `[park-aware] ${N} visible panes -> ${liveCountAfterMount} live (cap=${MAX_LIVE_SWAPCHAINS}), so some MUST be parked while still visible`,
  );

  let parkedIndex = -1;
  for (let i = 0; i < canvases.length; i++) {
    if (!isCanvasLive(canvases[i]!)) {
      parkedIndex = i;
      break;
    }
  }
  const foundParked = parkedIndex !== -1;
  report(foundParked, `[park-aware] found an on-screen pane the LRU parked (index=${parkedIndex})`);
  if (!foundParked) {
    cleanup();
    return false;
  }

  // Trigger a RE-RENDER on the still-parked, still-visible pane (an exposure
  // change) — the pool must transparently restore it before rendering.
  setExposureFns[parkedIndex]!(newExposure);
  await sleep(1000);

  const targetCanvas = canvases[parkedIndex]!;
  const restoredLive = isCanvasLive(targetCanvas);
  report(restoredLive, `[park-aware] pane[${parkedIndex}] restored to LIVE after its re-render request`);
  ok = ok && restoredLive;

  // Checked structurally (not pixel-exact) — see this file's module doc note
  // on why (canvas-compositing color management can introduce small
  // non-deterministic differences).
  const img = await readbackCanvas(targetCanvas);
  const nonBlank = isNonBlank(img);
  report(nonBlank, `[park-aware] pane[${parkedIndex}] re-rendered parked pane has non-blank content`);
  ok = ok && nonBlank;

  cleanup();
  return ok;
}

/**
 * Case 6 (addon capability-gated registration) is intentionally NOT tested
 * from this bundle: `plot-gpu-image-addon.tsx`'s top-level side effect
 * (`void tryRegister()`) must observe `window.__cairnPlotRegisterRenderer`
 * as it existed BEFORE the addon module first evaluates. A dynamic
 * `import()` of a LOCALLY-bundled module inside a single-file esbuild
 * bundle (no `--splitting`) does not reliably defer that top-level
 * evaluation to the point of the `import()` call — the module can end up
 * evaluated as part of the same synchronous bundle-init pass, before a
 * test-installed stub is in place, which would make the assertion
 * meaningless (or flaky) rather than verifying real behaviour. Testing it
 * properly needs a REAL separate `<script type="module">` (its own bundle,
 * its own module graph) after an inline, non-module `<script>` stub — see
 * `gpu-image-addon-check.browser.ts`, loaded as its own `<script>` tag in
 * `gpu-image-pane.browser.html`, right after this file's bundle.
 */
window.__gpuImagePaneMainDone = false;

async function main(): Promise<void> {
  try {
    const singleOk = await runSingleCase();
    const poolOk = await runPoolCapCase();
    const parkAwareOk = await runParkAwareRenderCase();

    const noConsoleErrors = consoleErrors.length === 0;
    report(noConsoleErrors, `no console.error calls during the run (got ${consoleErrors.length})`);
    // Snapshot first: `report(false, ...)` itself calls `console.error` (see
    // its `console[pass ? "log" : "error"]` below), which the override above
    // re-appends to `consoleErrors` — iterating the LIVE array here would
    // pick up each freshly-appended entry and never terminate.
    for (const e of consoleErrors.slice()) report(false, `console.error: ${e}`);

    setOverallStatus(singleOk && poolOk && parkAwareOk && noConsoleErrors);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  } finally {
    window.__gpuImagePaneMainDone = true;
  }
}

void main();
