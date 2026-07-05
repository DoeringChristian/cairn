# Design: VisualContentCard — one card, pluggable Viewports (image + 3D unified)

**Status:** design / not started · **Date:** 2026-07-04 · **Author:** architecture pass (read-only)
**Supersedes the card-chrome half of:** `2026-07-03-3d-viewers.md`, the `spec-visual-compare.md` lineage referenced in `media-compare/mode.ts:8`.

---

## 0. TL;DR

The **comparison substrate is already unified** (WS‑VC1, on main): `media-compare/mode.ts`
(five-mode enum + `MediaCompareMode<TExtra>` extension point), `compositor.tsx`
(`CompositeMediaPane`), `use-media-reference` / `use-reference-drop` (per-run vs global
reference), `OffscreenComparePanes` (3D → snapshot → same compositor), `CompareSettingsPanel`.
All five cards already share it.

**What is NOT unified is the card shell.** `ImageGalleryCard` (1167 L) and the four 3D cards
(`MeshCard` 1133, `PointCloudCard` 1034, `BoxesCard` 1120, `VolumeCard` 1069 — ~4350 L of
near-duplicated chrome) each re-own: series fetch, step slider, the settings-panel JSX, the
single/multi/compare render dispatch, the "reference source" block, download/screenshot, and
label placement. Because the image card grew the richest feature set (draggable bottom-left
label, bottom mode selector, overlays, post-processing, external-baseline picker), the 3D cards
look impoverished by comparison (top-of-body / no first-class label, no bottom mode selector,
settings-modal-only compare UI).

**This epic collapses all five into one `VisualContentCard`** that owns the entire image-card
chrome/state/compare/settings/step/DnD/download surface, parameterized by a **`Viewport`
module** (in `cairn-plot`) + a **capability descriptor**. `object_type` selects the module.
Cross-type (image ↔ 3D) pixel compare **falls out for free** for side/split/blend (the compositor
already layers two frame-sources as `<img>`s regardless of origin) and is **feasible-but-gated**
for pixel `diff`.

---

## 1. Current state (analysis, cited)

### 1.1 The image card's full feature set — the reference

`components/ImageGalleryCard.tsx`. Registered by a plain `switch` in
`CardRenderer.tsx:187-188` (no descriptor object); min-size key `"image"` in
`card-kit/card-min-sizes.ts:24`.

| Feature | Where it lives | Cite |
|---|---|---|
| **Per-pane label chip — bottom-left, draggable** (grip icon, starts `CAIRN_IMAGE_MIME` viewport drag) | cairn-plot `ImagePane` (chip) + `SeriesChip.startViewportDrag` (payload) | `ImagePane.tsx:417-430`; split/blend chip in `compositor.tsx:186-197`; drag wired `ImageGalleryCard.tsx:470-472` |
| **Bottom mode selector** (pill row: normal/side/split/blend/diff) + inline split-position & blend-alpha sliders | card file (JSX), enum in cairn-plot | buttons `ImageGalleryCard.tsx:1092-1129`; enum `media-compare/mode.ts:14-22` |
| Header mode `<select>` + diff-submode `<select>`; settings-panel duplicates | card file | `:738-763`, `:951-972` |
| **Reference drag/drop** (chip→per-run, viewport→global; always lands on `mode:"diff"`) | card-kit `useReferenceDrop` + `applyReference` map | hook `use-reference-drop.ts:45-90`; map `ImageGalleryCard.tsx:455-463` |
| **Reference resolution** (global-positional / per-run step-matched / baselineIndex) | card-kit `useMediaReference` + cairn-plot `reference.ts` | `use-media-reference.ts:75-168`; `reference.ts:31-63` |
| Per-run vs global toggle; **external baseline picker** (local `ExternalBaselinePicker`) | card file | `:572-574`, `:201-309`, settings `:1003-1016` |
| **Step slider** | card-kit `useStepSlider` + `components/StepSlider` | `use-step-slider.ts:27-51`; UI `ImageGalleryCard.tsx:1131-1138` |
| **Multi-pane** — its OWN CSS grid of `CompositeMediaPane` (NOT `MultiPaneGrid`) | card file | `renderMultiPaneGrid :604-666` |
| **Settings panel** — its OWN JSX (NOT `CompareSettingsPanel`) | card file | `:778-1019` |
| **Screenshot** (composite export incl. REF grouping + colorbar) / single download | card file + `lib/download` | `:694-730`; `lib/download.ts:170-181` |
| **Zoom/pan** (modifier-gated wheel-to-cursor + pan) | cairn-plot `useImageViewport` | `hooks/use-image-viewport.ts:19-147` |
| **Overlays** (bbox + seg-mask, per-class toggles, score threshold) | parse in card; render cairn-plot `ImageOverlay` | parse `:157-187`; render `ImagePane.tsx:402-414` |
| **Post-processing** (brightness/contrast/gamma/exposure/offset/flip) | assembled in card; impl cairn-plot | `:424-431`; `media-compare/post-processing.tsx:22-86` |
| False-color / colormap + Colorbar | header/settings + cairn-plot colormaps | `:764-774`, `:1086-1088` |
| Canvas production (GPU/CPU pixel diff + false-color) | cairn-plot `ImagePane` | `ImagePane.tsx:126-306` |
| Chrome delegated up | `CardShell` / `CardHeader` | `:1044-1066`; `CardShell.tsx:9-73` |

### 1.2 The 3D cards' divergence

The four are near-identical clones of each other (same skeleton `use*Blob → *Body → *Pane →
*ComparePane → *ComparePanel`, `MAX_PANES=4`, `defaultHeight=380`). They **already share the
compare family** with the image card (`useMediaReference`, `useReferenceDrop`,
`useCompareReferenceMeta`, `OffscreenComparePanes`, `CompareSettingsPanel`, `MultiPaneGrid`,
`useCardSeries`, `useStepSlider`). Divergence from the image card:

- **No first-class label chip.** Label = `CardShell` title/subtitle + `MultiPaneGrid` pane
  badges (these badges *are* draggable as `CAIRN_IMAGE_MIME` sources — `MeshCard.tsx:826-835`).
  There is nothing equivalent to the image card's standalone bottom-left `SeriesChip`.
- **No bottom mode selector.** Mode is derived from settings; all compare UI lives in the
  **settings modal** via `CompareSettingsPanel` (`MeshCard.tsx:1050-1070` and peers). Render
  dispatch `renderSingle/renderCompare/renderMulti` at `MeshCard.tsx:960-966`.
- **Always-on reset-view** (`viewModified` hardcoded `true`; `resetScene3DViews`) —
  `MeshCard.tsx:998-1002` — vs image card gating on "camera moved."
- **"Sync 3D views" camera-sync toggle** (`useCameraSync`/`Scene3DSyncOptions`) — 3D-only,
  `MeshCard.tsx:678-687,1044-1049`.
- **Native geometry diffs** appended via `MediaCompareMode<TExtra>` (`diff-geometry`,
  `diff-property`, `diff-position`, `diff-value`) with topology-match gating + mismatch
  explainer — rendered by the card itself through `three/diff.ts`, NOT the compositor
  (`mode.ts:38-46`; `MeshCard.tsx:455-509`).
- **Per-type controls** a capability schema must express: Mesh {colorMode, shading, wireframe,
  doubleSided}; PointCloud {**pointSize**, colorMode}; Boxes {**depthMin/Max**, **value
  filter**, visible-count readout}; Volume {mip/iso, **isovalue**, **6-slider clip box**,
  quality steps, **always-on Colorbar**, **PropertySelector that is a deliberate no-op** —
  `VolumeCard.tsx:692-696`}.
- **`.npz/.npy` blob fetch+parse** replacing the image card's direct artifact-URL `<img>`.
- **~250 L per card duplicated**: the `use*Blob` hook, `multiQueries`/`seriesPoints` derivation,
  `comparedIdx` baseline-skip, and the `*ComparePanel` + "Reference source" settings block are
  copy-pasted with only the type name and diff math swapped.

### 1.3 Viewport substrate today — the canvas contract

| Concern | Image path | 3D path |
|---|---|---|
| Visible surface | `<img>` or 2D `<canvas>` (`ImagePane.tsx:347,375`) | live WebGL `<canvas>` = `renderer.domElement` (`use-scene3d.ts:114`) |
| Feed to compositor | `imageUrl: string` (artifact URL) | `dataUrl` from `canvas.toDataURL()` (`use-offscreen-snapshot.ts:35`) |
| Render trigger | React effect on props | imperative `requestRender()` (`use-scene3d.ts:108`) |
| Frame notification | none | `onFrame(canvas)` push (`use-scene3d.ts:42,114`) |
| fit/reset | implicit zoom=1/pan=0 | `fitToBounds(bounds)` + `resetScene3DViews` (`use-scene3d.ts:58,261`) |
| View change | `onViewportChange({zoom,pan})` | OrbitControls change → `publishCameraState` (`camera-sync.ts`) |

Key facts driving the interface design:
- **Compositing for side/split/blend is DOM/CSS, not pixel** — the compositor stacks two `<img>`
  with `clip-path` (split) or `opacity` (blend), `compositor.tsx:126-197`. Only `diff` is truly
  pixel-wise, and `CompositeMediaPane` delegates it straight back to `ImagePane`'s
  GPU/CPU pipeline (`compositor.tsx:347-370`, `image/diff.ts` + `image/webgl-diff.ts`).
- **The 3D path already adapts DOWN to the image contract**: snapshot → PNG data-URL → `<img>`
  → the SAME `CompositeMediaPane` (`OffscreenComparePanes.tsx:141-174`). So the compositor
  **already consumes a type-agnostic frame-source string.** This is the de-facto Viewport
  contract we formalize.
- **Two diff notions in 3D**: image-space (snapshot→compositor) AND geometry-space
  (`three/diff.ts`, per-element, card-rendered). The interface must carry both.
- **WebGL budget**: image diff = **1** process-wide singleton GL context, reused across all
  panes, never disposed (`webgl-diff.ts:76-95`). 3D = **1 context per live viewer**, disposed on
  unmount (`use-scene3d.ts:150,187-193`); a 3D compare card = **2** (two hidden offscreen
  viewers, `OffscreenComparePanes.tsx:153-159`) + a renderer-less OrbitControls controller that
  deliberately allocates **no** context. **No pooling** — each 3D pane linearly consumes the ~8–16
  browser budget. `MAX_PANES=4` is the mitigation.

### 1.4 Already shared (the base) vs not

**Shared / bind to, don't recreate:** `media-compare/{mode,compositor,reference,post-processing,
migrate-legacy-mode}`, `card-kit/{use-media-reference,use-reference-drop,use-compare-reference-meta,
use-card-series,use-step-slider,use-run-info,MultiPaneGrid,CompareSettingsPanel,
OffscreenComparePanes,use-offscreen-snapshot,PropertySelector,card-min-sizes}`,
`CardShell`/`CardHeader`/`CardDetailModal`, `SeriesChip`/`SeriesChipStrip`, `camera-sync`.

**Not yet shared but should be (this epic):** the card body itself (settings-panel JSX, render
dispatch, screenshot, external-baseline picker, the multi-pane grid — the image card even has its
own grid instead of `MultiPaneGrid`), and the label/mode-selector chrome the 3D cards lack.

---

## 2. Target architecture

### 2.1 `VisualContentCard` — one card

`components/VisualContentCard.tsx` is **`ImageGalleryCard` generalized in place** — not a new
component written from scratch. It owns, once, everything in §1.1: `CardShell` wiring, settings
persistence, `effectiveMode`/`setMode` + legacy migration, `useCardSeries` + multi-run
fetch/step-map, the single/multi/compare render dispatch, the reference family
(`useMediaReference`/`useReferenceDrop`/`ExternalBaselinePicker`/per-run-vs-global), the step
slider, the bottom mode selector + split/blend sliders, screenshot/download, and the **draggable
bottom-left label**. Everything type-specific is delegated to the injected Viewport module and
gated by its capability descriptor.

```tsx
function VisualContentCard<TData, TView, TSettings>(props: {
  runId: string; metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[]; controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey; onRemove?: () => void; autoOpenSettings?: boolean;
  viewport: ViewportModule<TData, TView, TSettings>;   // ← the only thing that varies per type
}) { /* the ex-ImageGalleryCard body, parameterized */ }
```

Each of the five cards collapses to a **thin registration** — a one-line binding in a
`viewportRegistry`, and `CardRenderer`'s five bespoke cases become one:

```tsx
// CardRenderer.tsx
const mod = viewportRegistry[metric.object_type];   // image|mesh|pointcloud|boxes3d|volume
if (mod) return <VisualContentCard {...baseProps} viewport={mod} .../>;
```

Net: `ImageGalleryCard` (1167) + 4×(~1000–1130) ≈ **5500 L → one ~1200 L card + five ~150–300 L
viewport modules** (data hook + Pane wrapper + per-type SettingsControls + native-diff spec).

### 2.2 `Viewport` interface (cairn-plot) — actual TS

Lives at `lib/cairn-plot/viewport/`. A Viewport module is a **registration record**, not a class;
"inheritance" is composition (the card *is* the base; modules plug in). The Pane contract is the
existing de-facto one (ImagePane props ∪ Scene3D `onFrame`) formalized.

```ts
// lib/cairn-plot/viewport/types.ts
import type { MediaCompareModeKind, MediaCompareMode, DiffMode } from "../media-compare/mode";

/** Type-agnostic frame the compositor consumes for side/split/blend/diff.
 *  Image path yields {url}; 3D path yields {canvas} (or {dataUrl}). One of the two. */
export type FrameSource =
  | { kind: "url"; url: string }                    // artifact URL — image path, zero-copy
  | { kind: "canvas"; canvas: HTMLCanvasElement }   // live/offscreen canvas — 3D path
  | { kind: "dataUrl"; dataUrl: string };           // snapshot — current 3D bridge

/** Common view-state: a discriminated union (2D and 3D are NOT one concrete type). */
export type ViewState =
  | { kind: "image2d"; zoom: number; pan: { x: number; y: number } }
  | { kind: "camera3d"; position: [number,number,number]; target: [number,number,number]; zoom: number };

export interface NativeModeSpec<M extends string = string> {
  mode: M;                                  // e.g. "diff-geometry"
  label: string;
  /** Card-rendered (three/diff.ts), NOT the compositor. Precondition to enable. */
  enabledFor(content: unknown, reference: unknown): boolean;   // topology match
  disabledReason?: string;                  // shown when enabledFor is false
}

export interface ViewportCapabilities<M extends string = never> {
  coreModes: readonly MediaCompareModeKind[];   // image: all 5; 3D: all 5 (via offscreen snapshot)
  nativeModes: readonly NativeModeSpec<M>[];    // 3D geometry diffs; [] for image
  hasSteps: boolean;
  postProcessing: boolean;                      // brightness/contrast/gamma — image true, 3D false
  overlays: boolean;                            // bbox/seg-mask — image only
  colorbar: "always" | "conditional" | "never";
  cameraSync: boolean;                          // "Sync 3D views" — 3D only
  resetView: "tracked" | "always";              // image gates on modified; 3D always-on
  crossTypeCompare: boolean;                     // may reference a different object_type
  webglContextsPerPane: number;                  // 0 (image, shared singleton) | 1 (3D)
  maxPanes: number;                              // image: unbounded-ish; 3D: 4
  label: { placement: "bottom-left"; draggable: true };  // UNIFORM — 3D inherits image's
}

/** What VisualContentCard renders for ONE viewport. Both ImagePane and the 3D
 *  viewers are adapted to this. The frame-source output is the compositor bridge. */
export interface ViewportPaneProps<TData, TView, TSettings> {
  data: TData; reference?: TData;
  settings: TSettings;
  view: TView; onViewChange: (v: TView) => void;
  diffMode: "none" | DiffMode;                  // pixel diff (image + 3D-snapshot)
  nativeMode?: string;                          // geometry diff (3D only)
  /** Emit a compositor-consumable frame after each render (pixel compositing). */
  onFrame?: (f: FrameSource) => void;
  label: string; isBaseline?: boolean;
  isDraggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
  fill?: boolean;
}

export interface ViewportModule<TData, TView, TSettings, M extends string = never> {
  objectType: string;                            // "image" | "mesh" | ...
  capabilities: ViewportCapabilities<M>;
  /** Fetch + parse: image → artifact URLs (useSequence); 3D → npz/npy blob (use*Blob). */
  useData(args: ViewportDataArgs): TData;
  defaultSettings(): TSettings;
  /** Renders ONE viewport. ImageViewport wraps ImagePane; 3D wraps <XViewer/> via useScene3D. */
  Pane: React.ComponentType<ViewportPaneProps<TData, TView, TSettings>>;
  /** Per-type controls injected into the shared settings panel (point size, isovalue, …).
   *  `present: false` for a control means "inert but shown" (Volume PropertySelector). */
  SettingsControls: React.ComponentType<{ settings: TSettings; update: (p: Partial<TSettings>) => void; meta: unknown }>;
  /** Geometry-space diff renderer, if any (three/diff.ts). Absent for image. */
  nativeDiff?: { render: React.ComponentType<ViewportPaneProps<TData, TView, TSettings>> };
}
```

**How the five collapse:**
- `ImageViewport`: `useData` = `useSequence`→artifact URLs; `Pane` wraps `ImagePane`, emits
  `{kind:"url"}` (and, for cross-type diff, a `{kind:"canvas"}` by drawing the img once);
  `capabilities` = all 5 core modes, `nativeModes:[]`, `postProcessing:true`, `overlays:true`,
  `resetView:"tracked"`. **`VisualContentCard + ImageViewport` must be pixel-identical to today's
  `ImageGalleryCard`** — the acceptance test for WS‑VC3.
- `MeshViewport`/`PointCloudViewport`/`BoxesViewport`/`VolumeViewport`: `useData` = the ex-`use*Blob`;
  `Pane` wraps the existing `<XViewer/>` (via `useScene3D`) and, for compare, routes through
  `OffscreenComparePanes` emitting `{kind:"canvas"|"dataUrl"}`; `nativeModes` from
  `three/diff.ts`; `SettingsControls` = the per-type block; `capabilities.cameraSync:true`,
  `resetView:"always"`, `maxPanes:4`, `webglContextsPerPane:1`, `colorbar` = `"always"`
  (Volume) / `"conditional"` (others).

### 2.3 Modes as capabilities → the SAME bottom mode selector

`VisualContentCard` renders **one** bottom mode selector by iterating
`capabilities.coreModes ∪ capabilities.nativeModes` (native ones gated by `enabledFor`, greyed
with `disabledReason`). This is exactly the image card's existing pill row
(`ImageGalleryCard.tsx:1092-1129`) generalized to iterate the descriptor instead of a hardcoded
`MEDIA_COMPARE_MODE_KINDS`. Because the selector, label placement (`bottom-left`), and drag
chrome are card-owned and uniform, **3D gets the identical selector + draggable bottom-left label
for free** — closing the two headline parity gaps. `CompareSettingsPanel` becomes the settings-modal
mirror only (the 3D cards' current sole home), not the primary surface.

### 2.4 Cross-type pixel compare (image ↔ 3D) — verdict

**Verdict: side / split / blend — yes, essentially free. Pixel `diff` — feasible but gated off by
default. Native geometry diff — same-type only, by construction.**

Rationale: the compositor consumes type-agnostic `FrameSource`s and layers them as `<img>`
(`compositor.tsx`). An image (`{kind:"url"}`) and a 3D snapshot (`{kind:"canvas"|"dataUrl"}`) are
both frame-sources, so **side/split/blend across an image and a 3D viewport already works** the
moment the reference picker/drop is allowed to accept a different-`object_type` series (today
`use-media-reference` resolves within the family; the only real change is relaxing that filter).

Pixel `diff` cross-type is mechanically possible — resample both frames to a common raster,
letterbox to matching aspect, then run the existing `image/diff.ts` pipeline — but is **semantically
meaningful only when the two rasters depict the same spatial content** (e.g. a rendered-vs-captured
frame at the same camera). We therefore gate it behind `capabilities.crossTypeCompare` **and** a
runtime "compatible raster" check, default the cross-type mode set to `{side,split,blend}`, and
require an explicit opt-in for cross-type `diff` with a resample step. Constraints: resolution
mismatch (image native size vs 3D canvas size), aspect/letterbox alignment, and colorspace
(sRGB image vs WebGL output). Prototype this first (§4 WS‑VC6, risk #1).

---

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | `VisualContentCard` = `ImageGalleryCard` refactored **in place**, not rewritten | Behavior-preserving; the image card already *is* the base. Avoids a second card diverging. |
| D2 | "Inherit" = **composition/registration**, not class inheritance | `viewportRegistry[object_type] → ViewportModule`; card injects it. Matches existing `CardRenderer` switch. |
| D3 | Viewport modules live in **`lib/cairn-plot/viewport/`** | Per mandate; the viewers already live in cairn-plot. |
| D4 | Compositor keeps consuming a **`FrameSource`** (url/canvas/dataUrl), not a rewritten ImageData contract | The 3D→snapshot→`<img>` bridge already works; lowest-risk, no ImagePane rewrite. (Canvas/ImageData frame contract is a *later* optional cleanup, removes the PNG encode.) |
| D5 | `ViewState` is a **discriminated union**, not a shared concrete type | 2D affine and 3D camera pose are structurally different; only the *pattern* (immutable value + full-replace callback + echo-guarded bus) is shared — generalize `camera-sync`'s bus. |
| D6 | Native (geometry) diffs stay **card-rendered via `three/diff.ts`**, declared as `nativeModes` | Already the design in `mode.ts:38-46`; not run through compositor. |
| D7 | Capability schema distinguishes **"absent" / "conditional" / "present-but-inert"** | Volume's no-op PropertySelector + Boxes' conditional value-filter demand it. |
| D8 | Cross-type `diff` **gated + opt-in**; side/split/blend cross-type **on** when `crossTypeCompare` | Semantics only hold for aligned rasters. |
| D9 | Preserve per-type **`maxPanes`** and `webglContextsPerPane` in the descriptor; card enforces | WebGL budget — image unbounded, 3D capped at 4. |
| D10 | The image card's own multi-pane grid and `MultiPaneGrid` **reconcile to one** | Today the image card has a bespoke grid (`:604-666`) and 3D uses `MultiPaneGrid`; the unified card picks one (prefer `MultiPaneGrid`, extended to host any Pane). |

---

## 4. Migration — incremental, behavior-preserving

Each phase ships and is reviewable on its own. WS‑VC1 (shared compare substrate) is **already on
main**.

- **WS‑VC3 — Interface + ImageViewport + generic card (no 3D yet).**
  Define `viewport/types.ts` (the interface above). Wrap `ImagePane` as `ImageViewport`. Extract
  `ImageGalleryCard`'s body into `VisualContentCard<…>` and re-register the `"image"` case as
  `VisualContentCard + ImageViewport`. **Acceptance: pixel-identical to today's image card**
  (overlays, screenshot compositor, external baseline picker, post-processing, all modes). Highest
  regression risk (§5 #3); do it first and hardest.
- **WS‑VC4 — Wrap the four 3D viewers as Viewport modules.**
  For each: `useData` = ex-`use*Blob`; `Pane` wraps `<XViewer/>` + `OffscreenComparePanes` for
  compare; `SettingsControls` = per-type block; `nativeDiff` from `three/diff.ts`; `capabilities`.
  No card wiring yet — modules built + unit-rendered in isolation.
- **WS‑VC5 — Switch the 3D cards to `VisualContentCard` + delete bespoke chrome.**
  Re-register `mesh/pointcloud/boxes3d/volume` cases; delete `MeshCard`/`PointCloudCard`/
  `BoxesCard`/`VolumeCard` (~4350 L). 3D **gains** the bottom mode selector, draggable
  bottom-left label, per-run/global reference chrome, unified settings — the parity mandate.
- **WS‑VC6 — Cross-type compare.**
  Relax the reference picker/drop to accept different-`object_type` series; enable side/split/blend
  cross-type; prototype + gate cross-type `diff` (resample/letterbox). Riskiest; last.

---

## 5. Risks / open questions

1. **Cross-type canvas compositing (prototype FIRST).** Is image↔3D pixel `diff` ever meaningful,
   and what resample/letterbox/colorspace normalization does it need? Likely ship side/split/blend
   cross-type and leave `diff` behind an opt-in. *Open:* does any real workflow want it?
2. **Viewport interface generality — reactive vs imperative render.** ImagePane renders reactively
   from props and exposes a *URL*, not a frame callback; the 3D path renders imperatively and pushes
   `onFrame(canvas)`. D4 keeps the URL frame-source so ImagePane need not be rewritten — but
   cross-type `diff` (WS‑VC6) forces ImageViewport to *also* produce a `{kind:"canvas"}`. *Open:*
   accept the small asymmetry, or bite off the canvas/ImageData frame contract (removes the 3D PNG
   encode) as part of VC6?
3. **Not regressing the image card.** Behavior-preserving refactor of 1167 L with overlays, the
   composite screenshot exporter, external-baseline picker, and post-processing. Mitigation: keep
   the settings shape byte-identical; snapshot/visual-diff the image card before/after WS‑VC3.
4. **WebGL budget under one card.** The unified card must enforce `maxPanes` and
   `webglContextsPerPane` from the descriptor (image unbounded, 3D capped at 4, offscreen compare =
   2 contexts). No pooling exists (`use-scene3d.ts:150`); a dashboard of many 3D cards can still
   exhaust the browser. *Open:* introduce a renderer pool, or keep the `MAX_PANES=4` + on-demand
   render mitigation?
5. **Two multi-pane grids (D10).** Reconciling the image card's bespoke grid with `MultiPaneGrid`
   without regressing either's layout/labels.
6. **Label semantics.** 3D's draggable *pane badge* becomes the image's draggable *bottom-left
   chip* — confirm the `CAIRN_IMAGE_MIME` viewport-drag payload is identical for a 3D snapshot pane
   (it claims to be, `MeshCard.tsx:826-835`).

---

## 6. Collision / sequencing note (for the controller)

**Files this epic heavily rewrites:** `ImageGalleryCard.tsx` (→ `VisualContentCard`), the four 3D
cards (deleted in WS‑VC5), `cairn-plot` viewers (`ImagePane`, `MeshViewer`, `PointCloudViewer`,
`BoxesViewer`, `VolumeViewer` — wrapped, not gutted), `CardRenderer.tsx` (five cases → one),
`media-compare/*` (extended, not rewritten).

**vs `feature/ai-reports-core` (WS‑AR1 — `cardFromSpec` extraction, `CardRenderer` /
`ReportCardsBlock` / markdown):**
- **Shared file: `CardRenderer.tsx`.** AR1 touches the **descriptor/report side** — extracting the
  `AddCardSelection → ComparisonCard` mapping into `cardFromSpec`
  (`2026-07-04-ai-authored-reports.md:388`, `ReportCardsBlock.tsx:108-127`) and adding a
  `language-cairn` markdown fence. VC touches the **`switch(object_type)` case bodies**. These are
  **orthogonal regions of the same file** — AR1 does not alter `CardDescriptor` or `baseProps`; VC
  does not alter the descriptor or report mapping.
- **Recommendation: land WS‑AR1 first** (in flight, smaller CardRenderer surface, extraction-only),
  then VC rebases and collapses the five switch cases underneath the unchanged descriptor contract.
  VC's collapse should keep `baseProps` + the per-case prop set byte-identical so AR1's
  `cardFromSpec` output still routes correctly.
- **No overlap** between AR1 and the card internals VC rewrites (AR1 never touches
  `ImageGalleryCard`, the 3D cards, or `cairn-plot` viewers).

**vs the just-merged 3D compare parity + resize work (on main):** VC **builds directly on it** —
`media-compare/mode.ts`, `compositor.tsx`, `use-media-reference`, `OffscreenComparePanes`,
`CompareSettingsPanel` are the WS‑VC1 base. VC **extends** these (iterate capabilities, add
`FrameSource`), it must not fork or rewrite them. Flag: `mode.ts` + `compositor.tsx` are the shared
seam between that merged work and VC.

---

## 7. Appendix — where each image-card feature moves

| Feature | Today | After |
|---|---|---|
| bottom-left draggable label | ImagePane + SeriesChip | **card-owned, uniform** (3D inherits) |
| bottom mode selector | card JSX, hardcoded enum | **card, iterates `capabilities`** |
| reference family | card-kit (shared) | unchanged (bound by card) |
| step slider | card-kit (shared) | unchanged |
| multi-pane | bespoke grid vs `MultiPaneGrid` | **one grid (D10)** |
| settings panel | bespoke JSX vs `CompareSettingsPanel` | **card core + `SettingsControls` per module** |
| post-processing / overlays | image-only | **capability-gated** (`postProcessing`,`overlays`) |
| zoom/pan vs orbit | `useImageViewport` vs `camera-sync` | **`ViewState` union + common bus (D5)** |
| pixel diff | ImagePane pipeline | unchanged; consumed via `FrameSource` |
| geometry diff | 3D card + three/diff | **`nativeModes` (D6)** |
| screenshot/download | card + lib/download | card core |
