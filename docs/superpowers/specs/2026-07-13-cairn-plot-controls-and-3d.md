# cairn-plot: standardized controls (Plotly-style toolbar) + 3D enhancements

Design for epic #69. Base `ea42614a`. Status: **awaiting user approval + fork decisions**.

## Guiding decision (the crux)

All toolbar/reset/screenshot controls live in the app **cards** today (`components/CardHeader.tsx:170-234`); pure renderers render zero control UI, so standalone Python plots have none. Fix: one new primitive **`lib/cairn-plot/primitives/PlotToolbar.tsx`** + a **`PlotController`** abstraction (`lib/cairn-plot/controls/`), rendered BY the pure renderers in their own root — so controls appear identically in standalone plots and cards.

The three incompatible viewport models — scalar `{xMin,xMax,yMin,yMax}` (`types.ts:44`), image `{zoom,pan}` (`hooks/use-image-viewport.ts:4`), 3D camera — are **not** unified; they hide behind an imperative `PlotController` interface each renderer implements in its own terms.

## `PlotController` + `<PlotToolbar>`
- `controls/types.ts`: `PlotController { capabilities, dragMode, cameraMode?, zoomIn/zoomOut/autoscale/reset/setDragMode/screenshot/isModified, setCameraMode? }`. `ControllerCapabilities{zoom,pan,boxZoom,autoscale,reset,screenshot,camera3d}` — static renderers set only `screenshot:true`, so the toolbar shows just the camera button for them.
- `primitives/PlotToolbar.tsx`: Plotly-modebar-shaped button stack (fa-camera / box-zoom / pan / zoom± / expand(autoscale) / house(home) + 3D orbital↔turntable), gated per-capability, styled to match `CardHeader.tsx:181-186`.
- `controls/ToolbarConfig.ts`: `{enabled?, buttons?, position?, visibility?}` — per-button + disable + placement.
- Renderer-local **screenshot** reuses `lib/download.ts` (`exportChartFromContainer` for SVG renderers, `exportImagesAsComposite` for images, `renderer.domElement.toDataURL` for 3D) closing over each renderer's own root ref.

## Per-renderer controllers
- ScalarPlot `renderers/scalar/use-scalar-controller.ts` (wraps viewport + gestures; persistent drag-mode replaces modifier-gating at `use-plot-gestures.ts:188`).
- ImagePane `hooks/use-image-controller.ts` (zoom clamp 0.25–16×, reset {zoom:1,pan:0}).
- Static renderers → shared `controls/static-controller.ts` (screenshot only).
- 3D `three/use-scene3d-controller.ts` on the `Scene3DHandle` (reset=`fitToBounds`, dolly zoom, cameraMode, screenshot); toolbar mounted in `Scene3DCanvas.tsx`.

## Shareable + disable-able controls (requirement C)
- Generalize `three/camera-sync.ts` (already a `groupId` EventTarget bus with echo-guard) → **`controls/control-sync.ts`** typed action bus: `SyncAction = camera3d | viewport2d | imageViewport | dragMode | cameraMode`; `publishControl/subscribeControl/getLastControl` (kind-keyed late-join). A toolbar action on one view drives linked views across a `cp.Grid` with `shared.sync`.
- Descriptor: extend `SharedProps.sync` (`plot-descriptor.ts:116`) to `{viewport?,camera?,dragMode?,cameraMode?}`; add `toolbar?: ToolbarConfig` to `SharedProps` (grid-wide) and `PlotLeafNode` (per-leaf; `enabled:false` = **disable per view**). Python `cp.X(controls=bool|dict, ...)` mirrors `show_axes→showAxes`. TS↔pydantic↔schema lockstep + conformance test.

## 3D enhancement slices
- **D1 X/Y/Z planes** — `showPlanes` view field; extend `updateAxesHelpers` (`use-scene3d.ts:346`) with 3 semi-transparent planes sized off `boundsRef`. Small.
- **D2 orbital/turntable** — `cameraMode` view field → OrbitControls config at `use-scene3d.ts:480` (polar clamp / up-lock). Small.
- **D3 colored meshes** — (a) configurable colormap (unhardcode viridis `MeshViewer.tsx:90`, one prop); (b) **per-face** colors/values via a de-indexed geometry path (indexed at `:179`) + `MeshColorMode "face-values"|"face-colors"` + `face_values_*`/`face_colors` handler members. Part (b) depends on **G3b**.
- **D4a image pixel tooltip** — retain ImagePane's decoded `ImageData`, `pointermove` → PixelAxes rect math (`PixelAxes.tsx:38-52`) → `Tooltip`. Small. (Share the helper with the in-flight `HdrImagePane`.)
- **D4b 3D ID-buffer picking** — new `three/id-buffer.ts`: a `WebGLRenderTarget` the scene renders into with an id override material encoding `elementIndex→RGB` (24-bit); on `pointermove` (rAF-throttled) acquire renderer → render id pass → `readRenderTargetPixels` 1px → decode → value/label via `three/properties.ts` → project world→screen → `Tooltip`. Restore-to-visible in the same tick (park() discipline). Highest risk (sync GPU readback, pool interplay, id precision).

## Sequenced slices
S1 D2 orbital/turntable · S2 D1 planes · S3 image tooltip · S4 mesh colormap — **quick wins, no forks, parallelizable now**.
S5 PlotController+PlotToolbar foundation (standalone-only) — **crux/med**. S6 descriptor toolbar/controls field. S7 control-sync generalization (2D/dragMode/cameraMode sharing). S8 card convergence (FORK-1). S9 mesh per-face (needs G3b). S10 3D ID-buffer picking — **high risk, independent, schedule last/parallel**.

## Fork decisions (resolved by user 2026-07-13)
- **F1 → contract now, visual convergence later.** Cards call the new `PlotController` immediately (one control brain); keep the current `CardHeader` buttons; flip cards to the overlay toolbar in slice **S8**. The overlay toolbar ships visually for standalone plots in S5.
- **F2 → hover-reveal.** Toolbar fades in on hover (`opacity-0 group-hover:opacity-100`, matching `CardHeader.tsx:155`); `ToolbarConfig.visibility:"always"` opt-in.
- **F3 → 32-bit RGBA id-buffer (4.3B elements).** Encode `elementIndex` across all four channels. **Implementation MUST handle the alpha hazards:** render the id pass with blending OFF (`gl.disable(BLEND)`), a non-premultiplied `WebGLRenderTarget`, clear to id=0 sentinel, and decode `r|g<<8|b<<16|a<<24` from `readRenderTargetPixels` without any alpha-premultiply round-trip. Verify a known id round-trips exactly (esp. ids with a high alpha byte).
- **F4 → persistent drag-mode default + modifiers as transient override** (recommended; revisitable). The toolbar sets a persistent pan/box-zoom mode; holding Alt/Ctrl/Meta temporarily inverts it (preserves current muscle memory).
- **F5 → de-index geometry only when per-face data is active** (recommended; revisitable). Indexed per-vertex path unchanged (no regression); the 3× vertex expansion happens only for `MeshColorMode "face-*"`.

## Status: DESIGN COMPLETE — awaiting user approval of the full sequenced plan before any #69 implementation (user chose "approve everything first"). HDR + G3b proceed independently.
