/**
 * Q23/Q24 geometry regression harness (NOT a unit test — jsdom has no
 * WebGPU; driven live via claude-in-chrome, same convention as
 * `renderers/__tests__/gpu-image-pane.browser.ts`).
 *
 * Verifies, with PIXEL-LEVEL readback (not just structural/non-blank
 * checks), the two coordinate-space fixes made on top of Q22
 * (`GpuImagePane.tsx`/`GpuComparePane.tsx` canvas-sizing):
 *
 *   Q23 — `GpuComparePane` split mode: the rendered A|B boundary in the
 *   canvas must sit EXACTLY under the draggable separator, at any
 *   `splitPosition` and at any zoom, INCLUDING when the pane's aspect ratio
 *   differs from the image's (i.e. when the image is letterboxed — the case
 *   that exposed the pre-fix bug, since the separator and the shader's
 *   `split` uniform used to be measured in two different reference frames).
 *
 *   Q24 — `GpuImagePane` zoom: a zoomed-in image must FILL the canvas
 *   (no dead transparent bars left/right) instead of staying confined to
 *   its at-rest letterboxed sub-rect.
 *
 * Loads the real compiled Tailwind CSS (`harness-style.css`, copied from
 * `dist/plot-inline/style.css`) — both panes under test use `h-full`/
 * `flex-1`/`min-h-0`/`w-full` for layout; without the real utility classes
 * a bare test page gives every box an unconstrained content-based height,
 * which would invalidate every pixel-geometry assertion below.
 *
 * RUNNING:
 *   1. Bundle: cd cairn/ui && npx esbuild \
 *        src/lib/cairn-plot/media-compare/__tests__/gpu-compare-geometry.browser.ts \
 *        --bundle --format=esm --tsconfig=tsconfig.app.json \
 *        --outfile=src/lib/cairn-plot/media-compare/__tests__/gpu-compare-geometry.browser.bundle.js
 *   2. Copy CSS: cp dist/plot-inline/style.css \
 *        src/lib/cairn-plot/media-compare/__tests__/harness-style.css
 *   3. Serve: cd cairn/ui/src/lib/cairn-plot/media-compare/__tests__ && python3 -m http.server 8938
 *   4. Open in Chrome: http://localhost:8938/gpu-compare-geometry.browser.html
 *
 * The generated `.bundle.js`/`harness-style.css` are NOT committed
 * (gitignored) — regenerate with the commands above whenever this harness,
 * its imports, or the Tailwind build change.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import GpuComparePane from "../GpuComparePane";
import GpuImagePane from "../../renderers/GpuImagePane";
import type { Viewport as ImageViewport } from "../../hooks/use-image-viewport";

declare global {
  interface Window {
    __geomTestResult?: "pass" | "fail";
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
  window.__geomTestResult = pass ? "pass" : "fail";
  document.title = pass ? "GEOMETRY PASS" : "GEOMETRY FAIL";
}

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

/** A solid-color NxN PNG data URL. */
function solidColorDataUrl(size: number, r: number, g: number, b: number): string {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, size, size);
  return c.toDataURL();
}

async function readbackCanvas(canvas: HTMLCanvasElement): Promise<ImageData> {
  const bitmap = await createImageBitmap(canvas);
  const tmp = document.createElement("canvas");
  tmp.width = bitmap.width;
  tmp.height = bitmap.height;
  const ctx = tmp.getContext("2d")!;
  ctx.clearRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, tmp.width, tmp.height);
}

function pixelAt(img: ImageData, x: number, y: number): [number, number, number, number] {
  const xi = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  const i = (yi * img.width + xi) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

const isRed = (p: [number, number, number, number]) => p[0] > 180 && p[1] < 80 && p[2] < 80 && p[3] > 200;
const isBlue = (p: [number, number, number, number]) => p[2] > 180 && p[0] < 80 && p[1] < 80 && p[3] > 200;
const isGreen = (p: [number, number, number, number]) => p[1] > 120 && p[0] < 100 && p[2] < 100;
const isTransparent = (p: [number, number, number, number]) => p[3] < 10;
const isOpaque = (p: [number, number, number, number]) => p[3] > 200;

/**
 * The `pan` a REAL zoom-to-cursor wheel-tick sequence would leave in place
 * after zooming to `zoom` with the cursor held at the pane's own center
 * (`use-image-viewport.ts`'s wheel handler's own invariant:
 * `(cursorX - pan.x) / zoom` stays constant across zoom changes — see that
 * file's `newPanX` formula). Using `pan:{x:0,y:0}` at a high zoom instead
 * (a direct prop jump no real interaction produces) is a DEGENERATE input
 * under the full-canvas-viewport model (Q24): `pan:0` means "zoom toward
 * the canvas's origin (top-left)", which starts out in the checkerboard
 * margin here — zooming further from there stays in the margin, by design
 * (the coordinator's Q24 clarification: "the user can zoom toward ANY
 * point, including into the checkerboard margin areas" — that is what
 * `pan:0` at high zoom means, not a bug). Every zoomed case below zooms
 * centered on the pane instead, matching how a user actually zooms in.
 */
function centerZoomPan(paneW: number, paneH: number, zoom: number): { x: number; y: number } {
  const cx = paneW / 2;
  const cy = paneH / 2;
  return { x: cx * (1 - zoom), y: cy * (1 - zoom) };
}

/** Polls a canvas's own readback until its center pixel is opaque (a frame
 *  with real content has painted), up to 6s. */
async function waitForCanvasCenterOpaque(canvas: HTMLCanvasElement): Promise<void> {
  const deadline = Date.now() + 6000;
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const img = await readbackCanvas(canvas);
    if (isOpaque(pixelAt(img, img.width / 2, img.height / 2))) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }
}

// ---------------------------------------------------------------------------
// Q23 — split separator tracks the rendered A|B boundary exactly, including
// when the pane is letterboxed (pane aspect != image aspect) and when zoomed.
// One PERSISTENT mount, driven via a window-exposed setter (avoids
// remount-per-step GPU-resource churn).
// ---------------------------------------------------------------------------
async function runSplitCase(): Promise<boolean> {
  let ok = true;
  const redUrl = solidColorDataUrl(32, 220, 20, 20);
  const blueUrl = solidColorDataUrl(32, 20, 20, 220);

  // Wide pane (600x200) against a SQUARE (32x32) source -> the image
  // letterboxes with bars on the LEFT/RIGHT — exactly the geometry that
  // exposed the pre-fix Q23 divergence (divider measured against the full
  // wrapper vs. the shader's `uv.x` measured against the — pre-fix —
  // shrunk-to-letterbox canvas).
  const container = document.createElement("div");
  container.id = "split-harness";
  container.style.width = "600px";
  container.style.height = "200px";
  document.body.appendChild(container);

  let setSplitFn: ((p: number) => void) | null = null;
  let setViewportFn: ((v: ImageViewport) => void) | null = null;
  let lastAppliedSplit = 0.5;

  function Harness() {
    const [split, setSplit] = React.useState(0.5);
    const [viewport, setViewport] = React.useState<ImageViewport>({ zoom: 1, pan: { x: 0, y: 0 } });
    setSplitFn = (p: number) => {
      lastAppliedSplit = p;
      setSplit(p);
    };
    setViewportFn = setViewport;
    return h(GpuComparePane, {
      imageUrl: blueUrl, // texB — foreground, RIGHT side (x >= split)
      baselineUrl: redUrl, // texA — reference, LEFT side (x < split)
      mode: "split",
      splitPosition: split,
      blendAlpha: 0.5,
      onSplitPositionChange: (p: number) => {
        lastAppliedSplit = p;
        setSplit(p);
      },
      zoom: viewport.zoom,
      pan: viewport.pan,
      onViewportChange: setViewport,
      label: "split-geom-test",
    });
  }
  const root = createRoot(container);
  root.render(h(Harness));

  const canvasFound = await waitFor(() => !!container.querySelector("canvas[data-gpu-compare-canvas]"));
  report(canvasFound, "[Q23] GPU compare canvas mounts");
  if (!canvasFound) {
    root.unmount();
    container.remove();
    return false;
  }
  const canvas = container.querySelector("canvas[data-gpu-compare-canvas]") as HTMLCanvasElement;
  const dividerEl = () => container.querySelector('[style*="col-resize"]') as HTMLElement | null;

  await waitForCanvasCenterOpaque(canvas);

  async function checkBoundaryMatchesHandle(label: string): Promise<boolean> {
    await sleep(200);
    const img = await readbackCanvas(canvas);
    const divider = dividerEl();
    if (!divider) {
      report(false, `${label}: divider element not found`);
      return false;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const dividerRect = divider.getBoundingClientRect();
    const dividerCenterX = dividerRect.left + dividerRect.width / 2;
    const devicePxPerCssPx = img.width / canvasRect.width;
    const dividerXInCanvasCss = dividerCenterX - canvasRect.left;
    const dividerXDevice = dividerXInCanvasCss * devicePxPerCssPx;
    const sampleY = img.height / 2;
    const offset = Math.max(4, devicePxPerCssPx * 3);
    const leftSample = pixelAt(img, dividerXDevice - offset, sampleY);
    const rightSample = pixelAt(img, dividerXDevice + offset, sampleY);
    const leftOk = isRed(leftSample);
    const rightOk = isBlue(rightSample);
    report(
      leftOk,
      `${label}: pixel just LEFT of separator handle is RED (reference/baseline) — got rgba(${leftSample.join(",")})`,
    );
    report(
      rightOk,
      `${label}: pixel just RIGHT of separator handle is BLUE (foreground) — got rgba(${rightSample.join(",")})`,
    );
    return leftOk && rightOk;
  }

  // --- zoom=1: 25% / 50% / 75% (all WITHIN the image's own letterboxed
  // band — this pane is height-constrained so the image spans roughly the
  // middle third of the canvas width; pick split fractions inside that band
  // so the divider sits ON the image, not out in the checkerboard). ---
  for (const pos of [0.4, 0.5, 0.6]) {
    setSplitFn!(pos);
    await sleep(150);
    // eslint-disable-next-line no-await-in-loop
    const good = await checkBoundaryMatchesHandle(`[Q23] zoom=1, splitPosition=${pos}`);
    ok = ok && good;
  }

  // --- pointer-drag: dispatch a real drag on the divider and confirm the
  // resulting onSplitPositionChange value matches (clientX - canvasRect.left)
  // / canvasRect.width (canvas-relative, not wrapper-relative). ---
  setSplitFn!(0.5);
  await sleep(200);
  {
    const divider = dividerEl()!;
    const canvasRect = canvas.getBoundingClientRect();
    const targetFrac = 0.45;
    const targetX = canvasRect.left + targetFrac * canvasRect.width;
    const targetY = canvasRect.top + canvasRect.height / 2;
    const dr = divider.getBoundingClientRect();
    divider.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: dr.left + dr.width / 2,
        clientY: dr.top + dr.height / 2,
        pointerId: 1,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: targetX, clientY: targetY, pointerId: 1 }),
    );
    await sleep(50);
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: targetX, clientY: targetY, pointerId: 1 }));
    await sleep(250);
    const dragOk = Math.abs(lastAppliedSplit - targetFrac) < 0.03;
    report(
      dragOk,
      `[Q23] pointer-drag to canvas-fraction ${targetFrac} -> splitPosition=${lastAppliedSplit.toFixed(3)} (canvas-relative, not wrapper-relative)`,
    );
    ok = ok && dragOk;
    const dragBoundaryOk = await checkBoundaryMatchesHandle("[Q23] after pointer-drag");
    ok = ok && dragBoundaryOk;
  }

  // --- zoomed in: boundary must still track the handle exactly ---
  const compareBox = canvas.getBoundingClientRect();
  setViewportFn!({ zoom: 2, pan: centerZoomPan(compareBox.width, compareBox.height, 2) });
  setSplitFn!(0.45);
  await sleep(300);
  const zoomedOk = await checkBoundaryMatchesHandle("[Q23] zoom=2, splitPosition=0.45");
  ok = ok && zoomedOk;

  root.unmount();
  container.remove();
  return ok;
}

// ---------------------------------------------------------------------------
// Q24 — a zoomed-in GpuImagePane fills the canvas (no dead transparent bars).
// ---------------------------------------------------------------------------
async function runZoomFillCase(): Promise<boolean> {
  let ok = true;
  const greenUrl = solidColorDataUrl(32, 20, 200, 20);

  // Wide pane (600x200) against a SQUARE (32x32) source -> letterboxed
  // left/right at rest.
  const container = document.createElement("div");
  container.id = "zoom-harness";
  container.style.width = "600px";
  container.style.height = "200px";
  document.body.appendChild(container);

  let setViewportFn: ((v: ImageViewport) => void) | null = null;

  function Harness() {
    const [viewport, setViewport] = React.useState<ImageViewport>({ zoom: 1, pan: { x: 0, y: 0 } });
    setViewportFn = setViewport;
    return h(GpuImagePane, {
      imageUrl: greenUrl,
      colormap: "none",
      zoom: viewport.zoom,
      pan: viewport.pan,
      onViewportChange: setViewport,
      label: "zoom-geom-test",
    });
  }
  const root = createRoot(container);
  root.render(h(Harness));

  const canvasFound = await waitFor(() => !!container.querySelector("canvas[data-gpu-image-canvas]"));
  report(canvasFound, "[Q24] GPU image canvas mounts");
  if (!canvasFound) {
    root.unmount();
    container.remove();
    return false;
  }
  const canvas = container.querySelector("canvas[data-gpu-image-canvas]") as HTMLCanvasElement;
  await waitForCanvasCenterOpaque(canvas);

  // --- AT REST (zoom=1): letterbox bars near the canvas edges must be
  // transparent (checkerboard shows through — genuinely no image there). ---
  {
    const img = await readbackCanvas(canvas);
    const leftEdge = pixelAt(img, 2, img.height / 2);
    const rightEdge = pixelAt(img, img.width - 3, img.height / 2);
    const center = pixelAt(img, img.width / 2, img.height / 2);
    const restLettersOk = isTransparent(leftEdge) && isTransparent(rightEdge) && isOpaque(center) && isGreen(center);
    report(
      restLettersOk,
      `[Q24] at rest (zoom=1): canvas edges transparent (checkerboard), center opaque green — ` +
        `left=rgba(${leftEdge.join(",")}) right=rgba(${rightEdge.join(",")}) center=rgba(${center.join(",")})`,
    );
    ok = ok && restLettersOk;
  }

  // --- ZOOMED IN enough to fill the pane's aspect (600/200 = 3x wider than
  // tall; the image is square, so home dispW = 200 (height-constrained) —
  // zooming to 4x, CENTERED on the pane (the pan a real cursor-centered
  // wheel-zoom would leave — see `centerZoomPan`'s doc comment for why
  // `pan:0` at high zoom is a degenerate, not a representative, input),
  // should let the image's effective on-screen width reach ~800 > 600,
  // i.e. fill the canvas edge-to-edge. ---
  const imgBox = canvas.getBoundingClientRect();
  setViewportFn!({ zoom: 4, pan: centerZoomPan(imgBox.width, imgBox.height, 4) });
  await sleep(350);
  {
    const img = await readbackCanvas(canvas);
    const leftEdge = pixelAt(img, 2, img.height / 2);
    const rightEdge = pixelAt(img, img.width - 3, img.height / 2);
    const zoomFillOk = isOpaque(leftEdge) && isGreen(leftEdge) && isOpaque(rightEdge) && isGreen(rightEdge);
    report(
      zoomFillOk,
      `[Q24] zoomed in (zoom=4): canvas edges now OPAQUE green (image fills canvas, no dead bars) — ` +
        `left=rgba(${leftEdge.join(",")}) right=rgba(${rightEdge.join(",")})`,
    );
    ok = ok && zoomFillOk;
  }

  // --- pan to the edge: with a solid-color image this can't be visually
  // distinguished from "still full", so instead confirm panning FAR in one
  // direction (on top of the centered zoom=4 pan above) reveals checkerboard
  // on the OPPOSITE edge (proves pan can reach/exceed the content bounds,
  // i.e. is not clamped to the old letterboxed sub-rect — no explicit clamp
  // exists at all; Q18's OOB -> transparent path is what makes "panned past
  // the content" show checkerboard instead of a hard edge/error). ---
  const centered4 = centerZoomPan(imgBox.width, imgBox.height, 4);
  setViewportFn!({ zoom: 4, pan: { x: centered4.x + 300, y: centered4.y } });
  await sleep(350);
  {
    const img = await readbackCanvas(canvas);
    const leftEdge = pixelAt(img, 2, img.height / 2);
    const rightEdge = pixelAt(img, img.width - 3, img.height / 2);
    // Panned hard right: left edge should now show checkerboard
    // (transparent — content panned past it), right edge stays image.
    const panOk = isTransparent(leftEdge) && isOpaque(rightEdge) && isGreen(rightEdge);
    report(
      panOk,
      `[Q24] panned hard right at zoom=4: LEFT edge now transparent (content panned past it), RIGHT edge still image — ` +
        `left=rgba(${leftEdge.join(",")}) right=rgba(${rightEdge.join(",")})`,
    );
    ok = ok && panOk;
  }

  // --- Home/reset (double-click) must re-letterbox correctly. ---
  setViewportFn!({ zoom: 1, pan: { x: 0, y: 0 } });
  const viewportEl = container.querySelector("[data-gpu-image-viewport]") as HTMLElement;
  viewportEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  await sleep(350);
  {
    const img = await readbackCanvas(canvas);
    const leftEdge = pixelAt(img, 2, img.height / 2);
    const homeOk = isTransparent(leftEdge);
    report(homeOk, `[Q24] reset to home re-letterboxes (canvas edge transparent again) — left=rgba(${leftEdge.join(",")})`);
    ok = ok && homeOk;
  }

  root.unmount();
  container.remove();
  return ok;
}

async function main(): Promise<void> {
  try {
    const splitOk = await runSplitCase();
    const zoomOk = await runZoomFillCase();
    setOverallStatus(splitOk && zoomOk);
  } catch (err) {
    report(false, `threw: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    setOverallStatus(false);
  }
}

void main();
