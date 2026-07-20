# cairn-plot extraction inventory (P-A boundary audit output)

Companion to `2026-07-19-cairn-plot-repo-extraction-prep.md`, workstream **P-A**.
Records the extractable TS surface, its external dependency set, the app→lib
import surface that becomes `@cairn-plot/*` at cutover, and the cut-line
decisions made to sever the last app-reaching imports.

Enforced by `cairn/ui/scripts/check-plot-boundary.mjs`
(`npm run check:plot-boundary`, wired into `.github/workflows/ci.yml` beside
`check:plot-schema`): the surface below has **zero** app-reaching imports.

---

## 1. Extractable surface (file inventory)

### 1a. Library — `cairn/ui/src/lib/cairn-plot/**` (143 files)

By subtree (file counts): `colormaps` 4 · `controls` 2 · `engine` 22 (incl.
WebGPU device/pool/shaders + `__tests__/*.browser.*`) · `hooks` 7 · `image` 11
(incl. EXR/tonemap decoders + `*.test.ts`) · `media-compare` 10 · `primitives`
12 · `renderers` 27 (incl. `scalar/*` + `__tests__/*.browser.*`) · `three` 10 ·
`transforms` 13 · `viewport` 17 (incl. `*.test.ts`) · `styles` 2 · top-level 6
(`index.ts`, `format.ts`, `theme.ts`, `types.ts`, `table-diff.ts`,
`tailwind-preset.ts`).

Extensions: 96 `.ts`, 37 `.tsx`, 8 `.browser.html` (test harness pages), 2
`.css` (new — see §4).

Full tree:

```
colormaps/{apply,index,lut,viridis}.ts
controls/{ToolbarConfig,types}.ts
engine/{device,image-engine,pool,test-hooks,types}.ts
engine/shaders/{compare,image,passthrough,reduce,scalebias}.wgsl.ts
engine/webgpu/{device,surface}.ts
engine/__tests__/{backend-readback,compare-pass,device-singleton,hdr-output,image-pass}.browser.{ts,html}
format.ts  index.ts  theme.ts  types.ts  table-diff.ts  tailwind-preset.ts
hooks/{index,use-container-size,use-device-pixel-ratio,use-emit-auto-height,use-image-viewport,use-modifier-key,use-series-visibility}.ts
image/{cache,decoders,diff,index,render-mode,tonemap,webgl-diff}.ts
image/{decoders,tonemap}.test.ts  image/decoders/exr.ts  image/decoders/exr.test.ts
media-compare/{cross-type-align,index,migrate-legacy-mode,mode,reference}.ts
media-compare/{compositor,GpuComparePane,post-processing}.tsx
media-compare/__tests__/gpu-compare-geometry.browser.{ts,html}
primitives/{Axis,Colorbar,ColormapSwatch,LabelChip,PixelAxes,PixelValueOverlay,PlotLegend,PlotToolbar,Tooltip}.tsx
primitives/{index,plot-to-png,tooltip-position}.ts
renderers/{BarChart,CpuImagePane,Figure,GpuImagePane,HdrImagePane,Heatmap,HistogramPlot,ImageOverlay,ImagePane,ParallelCoords,PointCloudViewer,ScalarPlot,ScatterPlot,Table}.tsx
renderers/{image-backend,index,use-chart-controller,use-image-controller}.ts
renderers/scalar/{scalar-legend,scalar-tooltip}.tsx  renderers/scalar/{use-plot-gestures,use-scalar-controller}.ts
renderers/__tests__/{engine-fallback,gpu-image-pane}.browser.{ts,html}  renderers/__tests__/gpu-image-addon-check.browser.ts
styles/{plot.css,tokens.css}
three/{BoxesViewer,MeshViewer,Scene3DCanvas,VolumeViewer}.tsx  three/{camera-sync,context-pool,diff,properties,use-scene3d,value-colors}.ts
transforms/{domain,downsample,figure-merge,histogram,index,merge-rows,normalize,outlier,pareto,parse-npy,parse-npz,smooth,x-axis}.ts
viewport/{boxes-viewport,image-viewport,mesh-viewport,pointcloud-viewport,volume-viewport}.tsx
viewport/{chart-viewport-math,chart-viewport-sync,cross-type,data-sources,image-viewport-sync,index,local-store,parse-overlay,types,use-chart-viewport}.ts
viewport/{chart-viewport-math,chart-viewport-sync}.test.ts
```

### 1b. Standalone entries / bootstrap — `cairn/ui/src/plot-*.ts(x)` (13 files)

```
plot-bootstrap.tsx        plot-core-main.tsx        plot-descriptor.ts
plot-figure-addon.tsx     plot-figure-renderer.tsx  plot-gpu-image-addon.tsx
plot-main.tsx             plot-node.tsx             plot-registry.tsx
plot-renderers.tsx        plot-standalone-helpers.tsx
plot-three-addon.tsx      plot-three-renderers.tsx
```

### 1c. Standalone build configs — `cairn/ui/vite.plot-*.config.ts` (4 files)

```
vite.plot-core.config.ts   vite.plot-figure.config.ts
vite.plot-gpu-image.config.ts   vite.plot-three.config.ts
```

### 1d. Plot build/gen scripts — `cairn/ui/scripts/*` (4 files)

```
gen-plot-spec-schema.mjs   check-plot-spec-schema.mjs
sync-plot-assets.mjs       smoke-plot-gallery.mjs
```

(The guard itself, `scripts/check-plot-boundary.mjs`, is a monorepo-side lint,
not part of the shipped surface.)

### 1e. Schema — `docs/schemas/cairn-plot-spec.schema.json`

Generated from the TS types by `gen-plot-spec-schema.mjs`; consumed by the
pydantic side + `check-plot-spec-schema.mjs` drift guard.

**Surface files scanned by the boundary lint:** 164 (`.ts/.tsx/.mjs`).

---

## 2. External (node_modules) dependency set → future `ui/package.json`

Every bare specifier imported anywhere in the surface, grouped by role. Versions
are the current monorepo pins (`cairn/ui/package.json`).

### Runtime dependencies (imported by lib / entries)
| package | version | used by |
| --- | --- | --- |
| `react` | ^18.3.1 | everything (peer) |
| `react-dom` | ^18.3.1 | entry mount (`react-dom/client`) |
| `recharts` | ^2.13.0 | `renderers/ScalarPlot.tsx` (line/scatter/bar/hist SVG) |
| `three` | ^0.185.1 | `three/**`, `viewport/*-viewport.tsx` (3D: mesh/volume/boxes/pointcloud) |
| `plotly.js-dist-min` | ^3.5.0 | `renderers/Figure.tsx`, `plot-figure-*` (Figure passthrough) |
| `react-plotly.js` | ^2.6.0 | `renderers/Figure.tsx` |

### Type-only devDependencies
`@types/react` ^18.3.12 · `@types/react-dom` ^18.3.1 · `@types/three` ^0.185.0 ·
`@types/react-plotly.js` ^2.6.4 · `@webgpu/types` ^0.1.71 (engine WebGPU).

### Build / tooling devDependencies
`vite` ^5.4.10 + `@vitejs/plugin-react` ^4.3.3 (the 4 `vite.plot-*.config.ts`) ·
`typescript` ^5.6.3 · `tailwindcss` ^3.4.14 + `postcss` ^8.4.47 +
`autoprefixer` ^10.4.20 (preset + `styles/*.css` compilation) ·
`ts-json-schema-generator` ^2.9.0 (`gen-plot-spec-schema.mjs`).

### Node builtins (scripts only — no package needed)
`node:assert`, `node:child_process`, `node:fs`, `node:os`, `node:path`,
`node:test`, `node:url`, `node:zlib`.

> Note: `plotly.js-dist-min` is deliberately NOT reachable through the
> `lib/cairn-plot/index.ts` barrel (see the comment there) — it is only pulled
> by the lazily-loaded `Figure` renderer, keeping its ~5MB UMD bundle out of the
> eager core chunk. Preserve that at extraction (optional/peer for Figure).

---

## 3. App → lib import surface (the `@cairn-plot/*` rewrite target)

At cutover these become `@cairn-plot/*` package imports. Excludes the plot-*
standalone entries (they ARE the surface).

- **57 import statements** across **23 app files**.

By file (import-statement count):

| count | file |
| --- | --- |
| 7 | `components/MeshVisualCard.tsx` |
| 7 | `components/BoxesVisualCard.tsx` |
| 6 | `components/VolumeVisualCard.tsx` |
| 6 | `components/PointCloudVisualCard.tsx` |
| 5 | `components/card-kit/OffscreenComparePanes.tsx` |
| 3 | `components/card-kit/visual-compare-settings.ts` |
| 2 | `pages/ComparisonOverviewTab.tsx` |
| 2 | `components/VisualContentCard.tsx` |
| 2 | `components/viewport-registry.tsx` |
| 2 | `components/TableCard.tsx` |
| 2 | `components/FigureInteractiveCard.tsx` |
| 2 | `components/card-kit/CompareSettingsPanel.tsx` |
| 1 | `embed-main.tsx` |
| 1 | `components/TensorCard.tsx` |
| 1 | `components/ScatterPlotCard.tsx` |
| 1 | `components/ScalarTileCard.tsx` |
| 1 | `components/ScalarPlotCard.tsx` |
| 1 | `components/ParallelCoordsCard.tsx` |
| 1 | `components/HistogramCard.tsx` |
| 1 | `components/card-kit/use-media-reference.ts` |
| 1 | `components/card-kit/cross-type-frame.tsx` |
| 1 | `components/BarChartCard.tsx` |
| 1 | `App.tsx` |

These resolve via relative paths (`../lib/cairn-plot/...`) today; there is no
`@/`-style path alias in `cairn/ui` (verified — no `paths` in any tsconfig, no
`resolve.alias` in any vite config), so the rewrite is a mechanical
prefix-swap `.../lib/cairn-plot → @cairn-plot`.

---

## 4. Cut-line decisions (how the app-reaching imports were severed)

Before the fixes there were **5 real** app-reaching imports (a 6th regex hit,
`lib/cairn-plot/index.ts:143`, was a path string inside a comment — not a real
import). Each fix keeps behavior identical and the app compiling.

1. **`image/render-mode.ts` → `../../storage` (`storageKeys.renderMode`)**
   — *Duplicate a tiny constant.* Replaced the app-registry import with a local
   `const RENDER_MODE_STORAGE_KEY = "cairn:render-mode"` (byte-identical). The
   app's `lib/storage.ts` registry keeps its `renderMode` entry with a
   cross-reference comment; the plot lib is the only reader/writer of that key.

2. **`renderers/Table.tsx` → `../../table-diff`** — *Move shared code into the
   lib.* `lib/table-diff.ts` → `lib/cairn-plot/table-diff.ts` (pure,
   framework-free tabular-diff core). App importers rewired: `TableCard.tsx` and
   `ComparisonOverviewTab.tsx` now import `../lib/cairn-plot/table-diff` (app →
   lib, which is allowed). It is genuinely plot-owned — the Table renderer is
   its primary consumer.

3. **`plot-bootstrap.tsx` → `./lib/emit-auto-height`** — *Move into the lib.*
   `lib/emit-auto-height.ts` → `lib/cairn-plot/hooks/use-emit-auto-height.ts`,
   re-exported from `hooks/index.ts`. The other app consumer, `embed-main.tsx`
   (a non-plot standalone entry), now imports it from `./lib/cairn-plot/hooks`.

4-5. **`plot-core-main.tsx` / `plot-main.tsx` → `./index.css`** — *Self-contained
   stylesheet + preset (Task 3).* The standalone builds no longer import the
   app's global `src/index.css`. New, lib-owned:
   - `lib/cairn-plot/tailwind-preset.ts` — the semantic plot palette
     (`bg/fg/border/accent` + `mono` font). The app `tailwind.config.ts` now
     lists it via `presets: [cairnPlotPreset]` and keeps only its app-only
     `status.*` colors in `theme.extend` (Tailwind deep-merges → identical
     utilities). The plot-inline build consumes the same preset transitively
     through `tailwind.config.ts`/`postcss.config.js`.
   - `lib/cairn-plot/styles/tokens.css` — the `.cairn-plot-doc` theme-token
     contract (light/dark vars + semantic-utility routing + checkerboard vars),
     moved verbatim out of `index.css`.
   - `lib/cairn-plot/styles/plot.css` — the stylesheet entry the plot builds
     import (`@tailwind` layers + `.num/.mono`, `.input`, `.cairn-checkerboard`,
     FA icon sizing + `@import "./tokens.css"`).

   The app's `src/index.css` is **untouched** (app CSS unchanged / byte-identical
   — dual-home for now; post-extraction the app can consume the lib preset/css).

### style.css equivalence (Task 3 verification)
Rebuilt `dist/plot-inline/style.css` before vs after: **516 → 499 rules**
(35 569 → 32 781 bytes). Every removed rule is app-shell-only and never used by
standalone plot pages (verified: not referenced by the lib, nor by the
`packages/cairn-plot` report/page templates): `.card` (+ its selection rules),
`.btn`/`.btn:hover`, `.kbd`, `.cairn-draggable-card *:not(.cairn-drag-grip)`,
`.cairn-drop-target`, the `@media (hover:hover)` card-drag-reveal, and the
`@media (max-width:767px)` mobile grid rules (the drag-reveal rules are gated on
a `.cairn-draggable-card` ancestor that never exists in an emitted plot, so they
were already inert there). All plot-relevant rules (Tailwind reset + utilities,
`.num/.mono`, `.input`, `.cairn-checkerboard`, FA sizing, and the full
`.cairn-plot-doc` token contract) are byte-preserved. The only *addition* is the
Tailwind `/*! tailwindcss vX | MIT */` license banner comment (cosmetic). Net:
equivalent minus app-shell CSS the standalone never used.

---

## 5. Gates (all green, this branch)
`tsc -b --noEmit` 0 · `npm run build` ok · `npm run build:plot-inline` ok ·
`npm run smoke:plot` 22/22 sections render · `npm run check:plot-boundary` clean
(164 files) · `pytest tests/unit/test_plot_spec_conformance.py` 27 passed.
(`dist/` rebuilt locally for verification but intentionally NOT committed here.)
