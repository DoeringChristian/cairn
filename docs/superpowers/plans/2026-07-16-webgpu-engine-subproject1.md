# WebGPU Engine — Sub-project 1 (Foundation + HDR Image Renderer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Each Task = one agent dispatch in a shared feature worktree; commit after each task.

**Goal:** Build a backend-agnostic GPU render abstraction (WebGPU primary, WebGL2 reduced fallback) and prove it by reimplementing the image + compare stack on it at full feature parity, with true HDR output on WebGPU.

**Architecture:** A thin RHI (`engine/`) with two backends behind one interface; a single shared `GPUDevice`/WebGL2 context for the whole page; images render on-demand through a fragment pipeline (exposure→colormap→tonemap→encode) that outputs HDR (`rgba16float` + `toneMapping:extended`) on WebGPU and SDR on WebGL2. The TEV overlay, zoom/pan, compare slider, diff submodes, and metrics all sit on top of / feed into the same pass. Ships as a lazy registry-loaded bundle addon; Python API and DataSpecs unchanged.

**Tech Stack:** TypeScript, React, WebGPU, WebGL2, WGSL + GLSL-ES-3.00 (inlined), Vite (per-renderer IIFE split), claude-in-chrome for GPU verification.

**Spec:** `docs/superpowers/specs/2026-07-16-webgpu-engine-design.md`.

## Global Constraints
- **Self-contained:** all shaders inlined as string modules; no external fetches; renders offline from data-in-props. (verbatim project rule)
- **Bundle guard:** `core.iife.js` must stay free of the engine until its addon is loaded; engine addon must NOT pull three/plotly. Verify each task.
- **Schema:** NO change to `plot-descriptor.ts` / `card_spec.py` / DataSpecs (`image`, `imghdr`) — `npm run check:plot-schema` green. Python `cp.Image`/`cp.Compare` API unchanged.
- **Alt-wheel gate preserved:** zoom uses `useModifierKey` (Alt/Ctrl/Meta), plain wheel scrolls the page. Never regress.
- **Parity gate (definition of done):** on BOTH backends — zoom/pan, colormap, exposure, all tonemap operators (linear|srgb|reinhard|aces), TEV overlay (per-channel colored digits + decimal/int notation + threshold), split slider (full-height, gapless, per-side numbers), blend, ALL diff submodes, diff metrics. Identical except HDR extended brightness (WebGPU only), confirmed by the user by eye.
- **Gates each task:** `cd cairn/ui && npx tsc -b --noEmit` (0) + `npm run build` + `npm run build:plot-inline` + bundle guard + `check:plot-schema` + `pytest tests/unit/test_plot_gallery_example.py`. Commit rebuilt `dist/`.
- **Ported semantics source of truth:** `cairn/ui/src/lib/cairn-plot/image/tonemap.ts` (`applyExposure`, `TONEMAP_OPERATORS = {linear,srgb,reinhard,aces}`, `outputEncode(x, gamma?)`, `srgbOetf`) and `renderers/HdrImagePane.tsx` / `ImagePane.tsx` (current CPU pipeline + colormap + diff) — the GPU shaders must reproduce these exactly.

---

## File Structure

- `engine/types.ts` — RHI interfaces (Device, Texture, Buffer, Sampler, RenderPipeline, ComputePipeline, BindGroup, RenderPass, Surface, Capabilities). Pure types.
- `engine/device.ts` — `createDevice()` backend selection + capability detection + the page-wide shared-device singleton.
- `engine/webgpu/` — WebGPU backend impl + HDR surface config. `device.ts`, `resources.ts`, `pass.ts`, `surface.ts`.
- `engine/webgl2/` — WebGL2 backend impl (SDR surface, fragment-equiv of compute). Same file split.
- `engine/shaders/` — `image.wgsl.ts` + `image.glsl.ts` (exposure/colormap/tonemap/encode), `compare.wgsl.ts` + `compare.glsl.ts` (split/blend/diff), `reduce.wgsl.ts` (metrics, WebGPU) + CPU-reduce fallback. `passthrough.*` for tests.
- `engine/image-engine.ts` — the image/compare/metrics renderer built on the RHI (backend-agnostic).
- `engine/pool.ts` — shared-device + LRU texture/swapchain pool + park/restore (IntersectionObserver-driven).
- `renderers/GpuImagePane.tsx` — React wrapper, SAME props as `ImagePane`/`HdrImagePane`; hosts the TEV overlay + zoom/pan + compare slider DOM; drives `image-engine`.
- Bundle: add engine addon to `vite` per-renderer split + register renderers via `__cairnPlotRegisterRenderer`.

Each backend file has one responsibility; `image-engine.ts` never imports a concrete backend (only `types.ts` + `device.ts`).

---

## Task 0 (SPIKE): Validate WebGPU HDR canvas config — GATES the HDR path

**Files:** Create scratch POC only (no repo source); write findings to `docs/superpowers/specs/2026-07-16-webgpu-hdr-spike.md`.

**Interfaces:** Produces the validated HDR-init recipe consumed by Task 3 (`configureHDRSurface`).

- [ ] **Step 1:** In the feature worktree, build a minimal WebGPU POC page (served over http; `file://` is blocked). Request an adapter/device; create a canvas; `context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() OR 'rgba16float', colorSpace: 'display-p3', toneMapping: { mode: 'extended' } })`. Render a full-screen quad outputting values >1.0 (e.g. 4.0, 8.0) next to a 1.0 (SDR-white) reference patch.
- [ ] **Step 2:** Load in claude-in-chrome on the user's HDR display (`matchMedia('(dynamic-range: high)')` = true here). Confirm: (a) `configure` with `toneMapping:{mode:'extended'}` + `rgba16float` succeeds without throwing; (b) readback / no console errors. Take a screenshot. NOTE: extended-*brightness* can only be confirmed by the user's eye — record what to look at (the >1.0 patch should be visibly brighter than the 1.0 patch on an HDR display).
- [ ] **Step 3:** If `toneMapping:{mode:'extended'}` is unsupported in this Chrome, try `{mode:'standard'}` + `rgba16float` and the `HDR` metadata path; record exactly which config Chrome accepts. Decide the final `configureHDRSurface` recipe (or, if no HDR config works, record that HDR brightness is deferred and the engine still ships with SDR parity — do NOT block the engine on HDR).
- [ ] **Step 4:** Write `2026-07-16-webgpu-hdr-spike.md`: the working config recipe, the SDR-fallback trigger, and the exact user-visible check. Commit. **Hand the screenshot + "look at this patch" instruction to the orchestrator to relay to the user.**

**Deliverable:** a validated (or explicitly-deferred) HDR surface recipe + findings doc. This unblocks Task 3's `configureHDRSurface`.

---

## Task 1: RHI type definitions (`engine/types.ts`)

**Files:** Create `cairn/ui/src/lib/cairn-plot/engine/types.ts`. Test: tsc only (pure types).

**Interfaces:**
- Produces (consumed by every later task):
```ts
export type Backend = "webgpu" | "webgl2";
export interface Capabilities { hdr: boolean; compute: boolean; float16: boolean; }
export type TextureFormat = "rgba8unorm" | "rgba16float" | "rgba32float" | "r32float";
export interface Texture { readonly width: number; readonly height: number; readonly format: TextureFormat; write(data: ArrayBufferView): void; destroy(): void; }
export interface Sampler { readonly _s: unknown; }
export interface RenderPipeline { readonly _p: unknown; }
export interface ComputePipeline { readonly _c: unknown; }        // webgpu only
export interface BindGroupEntry { binding: number; resource: Texture | Sampler | { uniform: ArrayBufferView }; }
export interface BindGroup { readonly _b: unknown; }
export interface Surface { readonly canvas: HTMLCanvasElement; readonly hdr: boolean; configure(width: number, height: number): void; getCurrentTextureView(): unknown; }
export interface Device {
  readonly backend: Backend;
  readonly capabilities: Capabilities;
  createTexture(width: number, height: number, format: TextureFormat): Texture;
  createSampler(opts?: { filter?: "nearest" | "linear" }): Sampler;
  createRenderPipeline(spec: { shaderWGSL: string; shaderGLSL: string; targetFormat: TextureFormat; }): RenderPipeline;
  createComputePipeline?(spec: { shaderWGSL: string }): ComputePipeline;   // undefined on webgl2
  createBindGroup(pipeline: RenderPipeline, entries: BindGroupEntry[]): BindGroup;
  createSurface(canvas: HTMLCanvasElement, opts: { hdr: boolean }): Surface;
  renderFullscreen(target: Surface | Texture, pipeline: RenderPipeline, bindGroup: BindGroup): void;   // draws a fullscreen triangle
  readback(source: Surface | Texture): Promise<Uint8Array | Float32Array>;   // for tests + metrics fallback
  destroy(): void;
}
```
- [ ] **Step 1:** Write the interfaces above verbatim. **Step 2:** `npx tsc -b --noEmit` → 0. **Step 3:** Commit.

---

## Task 2: WebGL2 backend (`engine/webgl2/`)

**Files:** Create `engine/webgl2/device.ts` (implements `Device`). Test via browser (jsdom has no WebGL2): a POC readback test.

**Interfaces:** Consumes `types.ts`. Produces `createWebGL2Device(): Device` with `backend:"webgl2"`, `capabilities:{hdr:false, compute:false, float16:<EXT_color_buffer_float?>}`.

- [ ] **Step 1 (failing test):** Add `engine/__tests__/backend-readback.browser.ts` (a harness page, run via claude-in-chrome): create device, a 2×2 `rgba32float` texture written with known values, a `passthrough` pipeline (samples texture → writes to an offscreen rgba8 target), `renderFullscreen`, `readback` → assert output pixels equal the input (within 1/255). Run against WebGL2 → FAILS (device not implemented).
- [ ] **Step 2:** Implement the WebGL2 `Device`: FBO-backed offscreen targets, float textures (`EXT_color_buffer_float`), a fullscreen-triangle VAO, GLSL program from `shaderGLSL`, uniform upload for `{uniform}` bind entries (WebGL2 has no bind groups → map bindings to `uniform`/`sampler2D` locations by convention `u_bindN` / `t_bindN`), `readback` via `readPixels`. Surface = the canvas' webgl2 context (SDR, `drawingBufferColorSpace='display-p3'`).
- [ ] **Step 3:** Run the readback test → PASS. **Step 4:** tsc + build + bundle-guard. **Step 5:** Commit.

---

## Task 3: WebGPU backend + HDR surface (`engine/webgpu/`)

**Files:** Create `engine/webgpu/device.ts`, `engine/webgpu/surface.ts`. Uses Task 0's recipe.

**Interfaces:** Consumes `types.ts` + Task-0 recipe. Produces `createWebGPUDevice(): Promise<Device>` (`backend:"webgpu"`, `capabilities:{hdr:<per Task0>, compute:true, float16:true}`) and `configureHDRSurface(context, device)`.

- [ ] **Step 1 (test):** Same `backend-readback` harness against WebGPU → FAILS.
- [ ] **Step 2:** Implement WebGPU `Device`: adapter/device request (shared — see Task 6 pool), `GPUTexture` from `TextureFormat`, `GPUSampler`, render pipeline from `shaderWGSL`, bind groups (native), fullscreen draw, `readback` via `copyTextureToBuffer` + `mapAsync`. `createSurface({hdr})` → `configureHDRSurface` (Task-0 recipe) when `hdr && capabilities.hdr`, else SDR `bgra8unorm`.
- [ ] **Step 3:** readback test PASS. **Step 4:** gates + bundle guard (three/plotly-free). **Step 5:** Commit.

---

## Task 4: Device selection + shared-device singleton (`engine/device.ts`)

**Files:** Create `engine/device.ts`.

**Interfaces:** Produces `getSharedDevice(): Promise<Device>` — returns ONE page-wide device (WebGPU if `navigator.gpu` + adapter, else WebGL2), memoized. `resetSharedDevice()` for tests.

- [ ] **Step 1 (test):** harness asserts `getSharedDevice()` twice returns the same instance; on a WebGPU-capable browser `.backend==="webgpu"`. FAILS.
- [ ] **Step 2:** Implement selection + memoization + a `?forceWebGL2` URL/param override (for the parity gate). **Step 3:** test PASS. **Step 4:** gates. **Step 5:** Commit.

---

## Task 5: Image pass — exposure/colormap/tonemap/encode shaders (`engine/image-engine.ts` + shaders)

**Files:** Create `engine/shaders/image.wgsl.ts`, `engine/shaders/image.glsl.ts`, `engine/image-engine.ts`.

**Interfaces:** Consumes `Device`. Produces `renderImage(device, target, srcTexture, params)` where
```ts
export interface ImageParams { exposureEV: number; operator: "linear"|"srgb"|"reinhard"|"aces"; gamma?: number; colormap?: Float32Array /*256×4 LUT*/; isScalar: boolean; hdrOut: boolean; uv: {x:number;y:number;w:number;h:number} /*viewport window*/; }
```
Uniform block (std140-compatible, shared WGSL/GLSL): `exposureEV, operator(int), gamma, isScalar(int), hdrOut(int), uvRect(vec4)`.

- [ ] **Step 1 (test — TDD via readback):** harness: upload a known float image (e.g. gradient with values incl. >1.0), run `renderImage` to an SDR `rgba8` target with `operator:"aces", exposureEV:0`, readback, and assert pixels match a JS reference computed by the EXISTING `tonemap.ts` functions (import `applyExposure`,`TONEMAP_OPERATORS.aces`,`outputEncode`) within 1/255. Repeat for linear/srgb/reinhard + a nonzero EV + a scalar+colormap case. FAILS (renderImage absent).
- [ ] **Step 2:** Author `image.wgsl`/`image.glsl` fragment shaders porting `tonemap.ts` EXACTLY: `v = sample(uvRect); v = v*2^exposureEV; if(isScalar) v = colormapLUT(v.r); v = operator(v); out = hdrOut ? v : encode(v, gamma)`. Implement `renderImage` wiring uniforms + LUT texture. Keep the `uvRect` windowing (zoom/pan) in the vertex/fragment UV.
- [ ] **Step 3:** readback tests PASS on both backends. **Step 4:** gates. **Step 5:** Commit.

---

## Task 6: `GpuImagePane` + resource pool + registry (`renderers/GpuImagePane.tsx`, `engine/pool.ts`)

**Files:** Create `renderers/GpuImagePane.tsx`, `engine/pool.ts`; modify the renderer registry + vite bundle config.

**Interfaces:** `GpuImagePane` takes the SAME props as `ImagePane`/`HdrImagePane` (data, colormap, exposure, tonemap, viewport, onViewportChange, pixel-overlay props). `pool.ts`: `acquirePane(canvas): PaneHandle` / `releasePane(h)` — shared device + LRU of live textures/swapchains + park (free GPU texture, keep CPU buffer) / restore (re-upload from CPU buffer) driven by IntersectionObserver.

- [ ] **Step 1 (test):** browser harness renders `<GpuImagePane>` with an HDR float image; assert a live canvas mounts, the engine addon registered (`__cairnPlotBundleLoaded`), no console errors, and readback of the canvas matches the SDR reference (forceWebGL2). Also mount 30 panes and assert only ≤N swapchains are live (pool cap). FAILS.
- [ ] **Step 2:** Implement `GpuImagePane`: on mount `acquirePane`, upload data → `renderImage` on demand (mount + on viewport/exposure/operator/compare change ONLY, not per-frame); host the existing TEV overlay (`PixelValueOverlay`) reading the retained CPU float buffer; zoom/pan via the `uvRect` uniform + `useModifierKey` alt-wheel; IntersectionObserver park/restore. Register `image`/`imagehdr` → `GpuImagePane` in the renderer map behind a capability flag; keep old panes as the ultimate fallback if the engine fails to init.
- [ ] **Step 3:** tests PASS. **Step 4:** browser-verify zoom/pan + overlay + alt-wheel-gate (plain wheel scrolls page). gates + bundle guard (engine is a lazy addon; core clean). **Step 5:** Commit.

---

## Task 7: Compare (split/blend/diff) + metrics on the engine

**Files:** Create `engine/shaders/compare.wgsl.ts`/`.glsl.ts`, `engine/shaders/reduce.wgsl.ts`; extend `image-engine.ts` (`renderCompare`, `computeMetrics`); wire into `GpuImagePane`/the compositor.

**Interfaces:** `renderCompare(device, target, texA, texB, {mode:"split"|"blend"|"diff", split, alpha, diffSubmode, colormap, ...ImageParams})`; `computeMetrics(device, texA, texB): Promise<{mse:number; psnr:number; mae:number}>` (GPU reduce on WebGPU, `readback`+CPU on WebGL2).

- [ ] **Step 1 (test):** readback tests — split at `split=0.5` yields A on left / B on right; blend `alpha` = `mix`; each diffSubmode matches a JS reference over `texA,texB`; `computeMetrics` matches a CPU MSE/PSNR reference within tolerance. FAILS.
- [ ] **Step 2:** Author compare shaders (sample A and B, branch by mode/submode, colormap the diff) + the reduction. Wire the split slider (full-height, gapless DOM overlay — reuse the current compositor DOM) + per-side TEV numbers to the same `split` uniform. Display metrics as today.
- [ ] **Step 3:** tests PASS both backends. **Step 4:** gates. **Step 5:** Commit.

---

## Task 8: Parity verification + standalone/card wiring + bundle addon finalize

**Files:** Modify `plot-renderers.tsx` (standalone image adapters → GpuImagePane), the compositor path, vite bundle split, `lib/cairn-plot/index.ts` exports. No schema change.

- [ ] **Step 1:** Wire the engine into standalone emit + the app card path behind the capability flag (fallback to legacy panes on engine-init failure). **Step 2:** Full PARITY GATE in claude-in-chrome on BOTH backends (`?forceWebGL2` and default): run down the Global-Constraints parity checklist — screenshots of each. **Step 3:** Confirm the HDR path activates on the HDR display (relay the user-visible check from Task 0 to the orchestrator → user). **Step 4:** Full gates (tsc, build, plot-inline, bundle guard core-clean, check:plot-schema, pytest gallery/components/elements). Commit dist. **Step 5:** Final commit + report the parity matrix (feature × backend) + the HDR-confirmation instruction for the user.

---

## Self-Review (against the spec)
- **Spec coverage:** RHI (T1–T4), HDR output (T0,T3), image pass (T5), compare (T7), metrics (T7), overlay/viewport/integration (T6,T8), resource-management/many-panes (T6 pool — the concern the user raised), parity gate (T8). ✓ All spec §1–§9 mapped.
- **WebGL2-reduced principle:** capabilities gate hdr/compute off on WebGL2; SDR + CPU-reduce fallback (T2,T3,T7). ✓
- **Alt-wheel gate:** T6 preserves `useModifierKey`. ✓
- **No schema change:** asserted every task. ✓
- **Type consistency:** `Device`/`Texture`/`renderImage`/`renderCompare`/`computeMetrics`/`getSharedDevice`/`acquirePane` names consistent across T1–T8. ✓
- **Risk front-loaded:** HDR spike is Task 0 and does not block the SDR engine if HDR config is unsupported. ✓
