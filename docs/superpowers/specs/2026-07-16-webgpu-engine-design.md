# cairn-plot WebGPU Engine — Design (Epic + Sub-project 1)

Status: approved design (brainstorming). Base `f2d33ab4`.
Supersedes the Q16 "true HDR via WebGL/`<img>`" direction — that feasibility pass proved 2D-canvas HDR is unavailable (no `configureHighDynamicRange`, no rec2100 colorspaces) and WebGL HDR is unreliable, so we move to a custom WebGPU engine whose HDR support is first-class.

## Decision record (user-confirmed)
- **Scope:** ONE unified WebGPU engine for **images + 3D** (mesh / point cloud / volume / boxes), **replacing three.js**. 2D charts (scatter/line/bar/histogram/heatmap/parallel-coords) stay on SVG/Recharts — out of scope.
- **Fallback:** WebGPU primary + **WebGL2 fallback in ONE engine** (one abstraction/scene graph we own; no three.js). WebGL2 is a *reduced* path: no compute, no HDR — but it renders the full feature set in SDR so shared self-contained notebooks display for everyone. **WebGPU = full** (HDR, compute image ops, advanced volume, GPU picking); **WebGL2 = graceful reduced**.
- **Driving features (all four):** GPU compute for image/data ops (colormap/diff/tonemap/exposure/metrics off the CPU); large-scale data/perf (instancing, culling, LOD, streaming); better volume + 3D quality (raymarching + transfer functions, OIT, MSAA); GPU picking / ID-buffer interaction.
- **HARD PARITY CONSTRAINT:** the image viewer + compare modes must remain fully correct on the new engine — zoom/pan, colormap, exposure, ALL tonemap operators, TEV per-pixel value overlay (per-channel colored digits + decimal/int notation + threshold), split slider (full-height, gapless, per-side sampling), blend, ALL diff submodes, and diff METRICS. HDR extended-brightness is the only added capability.

## Too large for one spec → decomposition (each later sub-project gets its own spec)
1. **Engine foundation + HDR image renderer** (THIS SPEC) — the RHI abstraction + WebGPU/WebGL2 backends + capability detection + self-contained WGSL/GLSL bundling, proven end-to-end by porting the image/HDR + compare stack at full parity.
2. **3D primitives** — mesh (per-face colors, MSAA), point cloud (instanced, screen/world size), boxes; orbit camera + camera-sync + axes/reference-planes. three.js kept until parity.
3. **Volume rendering + quality** — raymarching + transfer functions, OIT, AA.
4. **GPU picking / interaction** — ID-buffer picking + hover tooltips (absorbs epic #69 S10).
5. **Large-scale data** — culling / LOD / streaming (cross-cutting; folds into 2–3).
6. **three.js removal** — delete three.js + the WS-3DR2 WebGL context-pool machinery once 3D is at parity; rebundle.

---

## Sub-project 1 — Engine foundation + HDR image renderer

**Approach:** a minimal-but-real RHI — build only the abstraction the image renderer needs now, but as the genuine foundation (extensible to 3D), and prove it by porting the image/compare stack. (Rejected: full-RHI-up-front delays the first shippable slice; renderer-first-abstract-later risks a messy seam when 3D lands.)

### 1. RHI core — `cairn/ui/src/lib/cairn-plot/engine/`
Backend-agnostic interface with two implementations (`webgpu/`, `webgl2/`):
- `createDevice(): Device` — picks WebGPU (`navigator.gpu`) else WebGL2; exposes `backend: "webgpu"|"webgl2"` and `capabilities: { hdr: boolean; compute: boolean; float16: boolean }`.
- Resources: `Texture` (rgba8 / rgba16float / rgba32float, 2D, uploadable from `Uint8Array`/`Float32Array`), `Buffer`, `Sampler`, `RenderPipeline` (vertex+fragment), `ComputePipeline` (WebGPU only; WebGL2 exposes `capabilities.compute=false`), `BindGroup`, `RenderPass`/`CommandEncoder`, `Surface` (canvas swapchain + HDR config).
- Shaders authored as **WGSL + GLSL-ES-3.0 pairs**, inlined as string modules in the bundle (self-contained preserved). Small hand-written set for Sub-project 1; a WGSL→GLSL transpile step is a possible later optimization, NOT now.
- Each unit has one clear purpose + a well-defined interface, testable independently.

### 2. HDR output / surface
- **WebGPU:** `context.configure({ device, format: "rgba16float", colorSpace: "display-p3", toneMapping: { mode: "extended" } })` when `matchMedia("(dynamic-range: high)")` matches → true extended-brightness HDR. (Validate the exact WebGPU HDR canvas config empirically first thing in implementation — API is recent; the `toneMapping.mode:"extended"` + `rgba16float` path is the documented mechanism.)
- **WebGL2 / SDR displays:** standard 8-bit sRGB surface, tonemapped output — identical to today.
- Capability-gated + auto-detected; a control allows forcing SDR.

### 3. Image render pass
- Upload image to a texture: 8-bit → rgba8; float HDR → rgba16float/32float.
- Full-screen quad fragment shader: `sample → applyExposure(ev) → colormap(via LUT texture, for scalar images) → tonemap operator(linear|srgb|reinhard|aces) → outputEncode`. Mirrors `image/tonemap.ts` semantics exactly.
- HDR branch (WebGPU-HDR): skip SDR tonemap, output extended-range to the HDR surface. SDR branch: tonemap → 8-bit.
- Exposure + operator are **uniforms** → interactive with no CPU re-encode (the GPU-compute-for-image-ops win; today `HdrImagePane` is per-pixel JS).

### 4. Compare on the engine
- split / blend / diff = a GPU pass sampling TWO textures: split by `uv.x < slider`, blend by `mix(a,b,alpha)`, diff = colormapped `|a-b|`/signed with all existing submodes.
- Slider + full-height separator remain DOM overlays (reuse current compositor DOM). Per-side sampling is inherent in the shader (no double-render). Baseline/reference selection unchanged.

### 5. Metrics
- Diff metrics (MSE / PSNR / MAE / etc. — whatever the current compositor shows) via **GPU reduction** (compute pass on WebGPU; mipmap-reduction or CPU fallback on WebGL2). Same UI/display as today.

### 6. Overlay, viewport, integration
- **TEV overlay unchanged:** retains the CPU-side raw float/8-bit buffer (already tracked in `ImagePane`/`HdrImagePane`), draws the 2D-canvas number layer ON TOP of the GPU canvas — per-channel colored digits (`CHANNEL_COLORS`), decimal/int notation (`formatChannelValue`), screen-px threshold. Reads the same buffer we already retain.
- **Viewport (zoom/pan):** becomes a UV-window uniform in the image/compare pass (GPU-side, replaces CSS transform), shared by the overlay + compare slider so numbers/divider stay aligned. Alt-gated wheel via `useModifierKey` preserved.
- **Integration:** the engine ships as a registry-loaded bundle addon (runtime `registerRenderer`/`__cairnPlotRegisterRenderer`); `ImagePane`/`HdrImagePane` reimplemented on the engine behind the **same props** (or a new `GpuImagePane` swapped in via the renderer map). Self-contained emit unchanged (data-in-props + inlined shaders). Python `cp.Image`/`cp.Compare` API + the `image`/`imghdr` DataSpecs are **unchanged** — HDR just renders truly now.

### 7. Parity gate (definition of done)
Every feature verified on BOTH backends (force WebGL2 via `?forceWebGL2` / disabling WebGPU): zoom/pan, colormap, exposure, all tonemap operators, TEV overlay (colored digits + int/decimal notation), split + slider (full-height, gapless) + per-side numbers, blend, all diff submodes, metrics. Identical across backends EXCEPT HDR extended brightness (WebGPU only), which the user confirms by eye on their HDR display.

### 8. File layout (proposed)
- `engine/device.ts` (createDevice + capability detect), `engine/types.ts` (RHI interfaces).
- `engine/webgpu/*` (WebGPU backend + HDR surface config + compute), `engine/webgl2/*` (WebGL2 backend).
- `engine/shaders/*.wgsl.ts` + `*.glsl.ts` (inlined image + compare + reduction shaders).
- `engine/image-engine.ts` (the image/compare/metrics renderer built on the RHI).
- `renderers/GpuImagePane.tsx` (React wrapper, same props as ImagePane) — swapped in via the renderer registry.
- Bundle: new engine addon in the per-renderer split; core stays free of it until loaded.

### 9. Testing
- tsc + build + `build:plot-inline` + bundle guard (core free of the engine until addon-loaded; no three/plotly leak).
- `check:plot-schema` green (no DataSpec change).
- pytest gallery/components/elements pass (Python API unchanged).
- Browser (both backends): the parity gate (§7) — self-contained static page, WebGPU + forced-WebGL2 runs, screenshots; HDR visual confirm handed to the user.

## Risks
- **WebGPU HDR canvas config** is recent — validate `toneMapping:{mode:"extended"}` + `rgba16float` produces extended brightness on the user's display FIRST (spike before building on it). If unavailable in their Chrome, fall back plan: rec2100 swapchain or defer HDR-brightness to a browser-version note (still ship the GPU engine + SDR parity).
- **Dual-backend parity cost** — every shader authored twice (WGSL + GLSL). Keep the Sub-project-1 shader set minimal (image, compare, reduction). This is the main effort sink; transpile is a later option.
- **Self-contained bundle size** — engine addon adds WGSL+GLSL; verify it stays a lazy addon (not eager core).
- **Overlay/viewport alignment** — moving zoom/pan from CSS transform to a GPU UV-window must keep the TEV overlay + slider pixel-aligned; regression-test alignment.
- **Metrics numerical parity** — GPU reduction must match the current CPU metric values within tolerance.

## Not in this sub-project
3D primitives, volume, picking, large-data, three.js removal — later sub-projects, each its own spec. 2D charts stay SVG/Recharts permanently.
