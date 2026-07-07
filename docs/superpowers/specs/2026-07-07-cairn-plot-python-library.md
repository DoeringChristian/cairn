# Design: `cairn-plot` as the single unified plot library, usable from Python (`cairn.plot`)

Status: **DESIGN ONLY** — read-only research spec. No code written, no branch, no commit.
Author context: extends `2026-07-07-notebook-python-and-embed.md` (WS-PYAPI / WS-EMBED, §11 fluent
element API) and `2026-07-04-visual-content-card.md` (the `viewport/` pluggable-render contract).
Repo tip at authoring: `ed8ab97f`.

This spec scopes **HOW** to make `cairn-plot` the one plot library, callable from Python as
`cairn.plot.X(...)`, **plots-only**, with **two author-selectable data modes**. The architecture is
already decided (below) and is **not** re-litigated here — this doc grounds it in the real code and
hands the coordinator an implementable, phased plan.

---

## 0. The decided architecture (restated, for grounding)

- The `cairn-plot` React **renderers are PURE** — data in via props. They are "the plots." **Cards**
  (`cairn/ui/src/components/*Card.tsx`) are data-provider + orchestration and **stay app-only** — they
  are **not** rendered in Jupyter. In Jupyter, **Python plays the card's role**: resolve data → feed
  the pure plot directly. The decoupling seam is **already** the pure-renderer prop boundary; there is
  **no `VisualContentCard` `/api` split to build.**
- **Two data modes, author-selectable per output:**
  - **LOCAL** — data baked into the HTML (content-addressed shared store, base64), self-contained,
    works with **no repo access**.
  - **ENDPOINT** — a bootstrap fetches data from the cairn repo endpoint.
  - The **SAME pure renderer** either way. Plotly-shaped: Python builds the spec + provides/links the
    data + ships the ONE React renderer; **Python never renders** the plot itself.
- **Snapshot tier DEFERRED. Cards-in-Jupyter DEFERRED** (plots-only now).

This **supersedes** the WS-PYAPI default from `2026-07-07-notebook-python-and-embed.md` §5/§11: today
`cairn.plot.X(handle)` emits a **`/embed/card` iframe** (`CardElement`, `cairn/sdk/elements.py:115`)
that boots the **whole viewer app** and renders the **card**. Under this spec the **default becomes a
self-contained/endpoint plot bundle that mounts the pure renderer**; the iframe path becomes an
optional/legacy fallback, not the default.

---

## 1. Per-renderer data-contract table (the crux for Python)

All renderers verified **prop-pure** — no `useData`/`useQuery`/`api.`/`fetch` anywhere in
`lib/cairn-plot/renderers/` or `lib/cairn-plot/viewport/` (see §2). Shared types:
`cairn/ui/src/lib/cairn-plot/types.ts` (`Series`, `ScatterPoint`, `ParallelColumn/Row`, `Viewport`,
`ImageOverlayData`, `PlotlyFigureLike`) and `transforms/histogram.ts` (`HistogramData`).

The seam is concrete: `ScalarPlotCard.tsx:535-556` builds a `plotProps` object (fetched `series` +
config) and renders `<ScalarPlot {...plotProps} />` (`:618`, `:627`). **Python must produce exactly
that `plotProps` shape.** The table below is that contract for every renderer.

| Renderer (file) | Required DATA props (exact shape) | Non-data config props | Source artifact / sequence shape | LOCAL bakes | ENDPOINT fetches |
|---|---|---|---|---|---|
| **ScalarPlot** `renderers/ScalarPlot.tsx:32` | `series: Series[]` = `{key,label,color,points:{x,y,wallTime?,context?}[],rawPoints?}[]`; `viewport: Viewport`; `xRange/yRange:[num\|null,num\|null]`; `promotedSeries: Record<string,{min,max}>` | `xAxis,xScale,yScale,lineType?,showLegend?,tooltip?,selectedSeriesKeys?`, callbacks, `className?` | scalar **sequence** points `(step,value,wallTime)` per (run,metric) | points JSON inline | `GET /api/.../sequence` |
| **ScatterPlot** `ScatterPlot.tsx:11` | `points: ScatterPoint[]` = `{id,x,y,color:num\|null,label?}[]` | `xLabel?,yLabel?,colorLabel?,xLog?,yLog?,pareto?,selectedIds?`, callbacks, `colors?` | one point/run: x,y,color = 3 metrics/params | points JSON | metric index query |
| **ParallelCoords** `ParallelCoords.tsx:8` | `columns: ParallelColumn[]`; `rows: ParallelRow[]` = `{id,values:(num\|null)[],raw:(str\|null)[],label?}`; `columnDomains:{min,max,isNumeric}[]` | `selectedIds?`, callbacks, `tooltipContent?` | one row/run; values aligned to columns (param/metric axes) | rows+columns JSON | metric index query |
| **BarChart** `BarChart.tsx:34` | `bars: BarDatum[]` = `{id,label,value,color?}[]` | `valueLabel?,logX?,compareMode?,runOrder?,selectedIds?`, callbacks, `colors?` | one bar/run for a metric | bars JSON | metric index query |
| **HistogramPlot** (bars) `HistogramPlot.tsx:9` | `counts:number[]`, `edges:number[]` (`edges.len=counts.len+1`) | `logY?` | single-step histogram artifact | counts/edges JSON | histogram artifact |
| **HistogramPlot** (heatmap) | `perStep: ({step:number}&HistogramData)[]` | `colormap,logColor?,bins?` | per-step histograms | perStep JSON | per-step artifacts |
| **Heatmap** `Heatmap.tsx:7` | `matrix: number[][]` (`matrix[y][x]`) | `colormap,min?,max?,logColor?,originTop?,*Label?,*TickLabel?` | dense 2D grid artifact | matrix JSON | matrix artifact |
| **ImagePane** `ImagePane.tsx` | `imageUrl:string\|null`, `baselineUrl:string\|null`; optional `overlay:ImageOverlayData` | `diffMode,interpolation,colormap,showAxes,processing?,zoom?,pan?,label`, callbacks | image artifact **bytes** (PNG/JPEG) + overlay in metadata | `data:image/*;base64` URL | `api.artifactUrl(hash)` |
| **ImageOverlay** `ImageOverlay.tsx` | `data: ImageOverlayData` (`.boxes[]`, `.masks[].png_b64`, `.class_labels`); `naturalWidth/Height:number` | `settings: ImageOverlaySettings` | image `artifact_metadata` (boxes + base64 PNG masks) | metadata JSON inline | in artifact metadata |
| **PointCloudViewer** `PointCloudViewer.tsx` | `data: Float32Array` (flat `nPoints*channels`); `channels`; `nPoints`; `bounds:{min,max}`; optional `overrideColors:Float32Array` | `colorMode,pointSize,background,showAxes?,sync?` | `.npy`/`.npz` (`parseNpy`/`parseNpz`) + metadata `{n_points,channels,bounds,properties}` | base64 npy/npz bytes | fetch+parse npz |

**Viewport-module TData** (the media/3D `Pane` prop payloads — `viewport/*.tsx`; the pane is pure,
the app-layer `useData` produces these — see §2):

| Module (file) | `TData` shape | Artifact bytes |
|---|---|---|
| image `image-viewport.tsx` | `ImageViewportItem{url:string\|null, overlay?:ImageOverlayData\|null}` | PNG/JPEG; URL from hash |
| pointcloud `pointcloud-viewport.tsx` | `PointCloudViewportItem{arrays:{data:Float32Array,properties},meta:{n_points,channels,bounds,properties}}` | `.npy`/`.npz` |
| mesh `mesh-viewport.tsx` | `MeshViewportItem{arrays:{positions:Float32Array,faces:Uint32Array,colors?,normals?,properties},meta}` | `.npz` |
| boxes `boxes-viewport.tsx` | `BoxesViewportItem{arrays:{mins,maxs,depth:Float32Array,properties},meta}` | `.npz` |
| volume `volume-viewport.tsx` | `VolumeViewportItem{arrays:{data:Float32Array},meta:{shape[D,H,W],vmin,vmax,spacing,origin,bounds}}` | `.npy` |

**Two stragglers (proposed pure renderers — §3):**

| Renderer | DATA props | Source |
|---|---|---|
| **Table** (new `renderers/Table.tsx`) | `table: TableData{columns:{name,type}[], data:unknown[][], truncated?}`; `diffStatuses?: CellComparison[][]`; `rowsPerPage`, `hiddenColumns`, `invertDiff?` | table JSON artifact `{columns,data,truncated}` |
| **Figure** (new `renderers/Figure.tsx`) | `figure: PlotlyFigureLike{data,layout}`; `settings: FigureInteractionSettings`; `viewOverrides?`, `revision?` | `plotly_json` source artifact |

---

## 2. Media / 3D renderer purity finding (critical for effort)

**Verdict: every renderer AND every `viewport/` module is PROP-PURE.** No `useData`, `useQuery`,
`useMutation`, `api.*`, `/api`, `axios`, or backend `fetch()` executes inside `lib/cairn-plot/`. The
grep hits are **comments or the `ViewportModule.useData` interface *signature* only**
(`viewport/types.ts:318`, plus doc comments at `:15-23,152-183`; `image-viewport.tsx:21`,
`pointcloud-viewport.tsx:53`). The only in-renderer side effects are **texture/image decode of
already-provided data**: `ImagePane.tsx:151,178` (`img.src = imageUrl` prop), `ImageOverlay.tsx:141`
(`img.src = data:...;base64,${mask.png_b64}` prop), `Heatmap.tsx:82` (canvas paint), and
gesture/resize listeners (`scalar/use-plot-gestures.ts`, `hooks/use-container-size.ts`). The
`hooks/` dir fetches nothing.

**Where the fetch actually lives (the ONE seam Python replaces):** the concrete
`ViewportModule.useData(args: ViewportDataArgs) → ViewportDataResult<TData>` is composed at the
**app layer** in `cairn/ui/src/components/viewport-registry.tsx`, NOT in cairn-plot. For **image**,
`useImageData` (`viewport-registry.tsx:84-97`) is a pure synchronous map `hash → api.artifactUrl(h)`
(a string formatter, no network) + `parseOverlay(metadata)`. For **3D**, `useData` is the
react-query `.npz` fetch+parse (pointcloud's lives in `PointCloudVisualCard.tsx:50`).

**Implication: effectively ZERO shim needed at the renderer/viewport level.** The prop-pure `Pane`s
already accept baked-in `TData`. Python's LOCAL/ENDPOINT modes are just **two implementations of the
`useData`-equivalent hash→TData mapping**, done in the *plot bootstrap* (§4), not inside cairn-plot:
- **ENDPOINT**: `hash → {url: `${endpoint}/api/artifacts/${hash}`}` (image) or fetch+`parseNpz` (3D)
  — the same logic as `viewport-registry.tsx`, just pointed at an absolute endpoint base.
- **LOCAL**: `hash → {url: data:...;base64,<bytes-from-store>}` (image) or
  `parseNpy/parseNpz(<bytes-from-store>)` (3D). **cairn-plot already exports `parseNpy`, `parseNpz`,
  `computeHistogram`** (`lib/cairn-plot/index.ts:31-36`), so the LOCAL bootstrap reuses the exact
  same parsers the app uses — no duplicate parsing code.

**One real refactor this exposes:** the image/3D `useData` mappers currently sit in app files
(`viewport-registry.tsx`, `PointCloudVisualCard.tsx`) and call `api.artifactUrl`. To share them
between the app and the plot bundle without importing the app's `api` client, **extract the
pure `hash → TData` core** (given a base URL / a byte-lookup, produce `TData`) into
`lib/cairn-plot/viewport/data-sources.ts` (new), parameterized by a `DataSource` interface
`{artifactUrl(hash): string}` **or** `{bytes(hash): Uint8Array}`. The app passes its `api`-backed
source; the plot bundle passes a LOCAL (store) or ENDPOINT (absolute-URL) source. This is the single
small, well-scoped seam addition — a `~1` file, `~2` function extraction, behavior-preserving.

---

## 3. Straggler extraction / wrapping plans (parallel, behavior-preserving, in-app)

Both cards currently **fetch internally** (react-query + `fetch(api.artifactUrl(...))`) — neither
takes data via props. Making them use a pure renderer both cleans the app AND yields the pure plot
Python needs.

### 3a. `TableCard.tsx` (760 lines) → extract `lib/cairn-plot/renderers/Table.tsx`

`TableCard` has **no cairn-plot import** and renders inline. But its `TableGrid` subcomponent
(`TableCard.tsx:159-362`) is **already a pure, self-contained grid** and is the natural extraction
target: it owns sort (3-state click cycle, numeric/string-aware, nulls-last, `:198-242`), text filter
(`:190-196`), client-side pagination (`:224-234,337-359`), column visibility (`:180-183`), cell
formatting (`formatCell:142-146`), diff coloring (`diffCellClassName` from `lib/table-diff`, tracked
by original row index), truncation notice (`:331-335`). No virtualization; plain `<table>`.

**Plan (behavior-preserving move):** move `TableGrid` verbatim → `renderers/Table.tsx` as default
export `Table`; move `formatCell` with it (or into `cairn-plot/format.ts`). Export `TableData` /
`TableColumn` (today declared in the card, `:51-62`) as the data contract. Keep `CellComparison` type
from `lib/table-diff` (or relocate the type into `cairn-plot/types.ts`). **Stays in the card** (data
provider): `useTableBlob`/`useTableBlobs`/`useSequence`, step slider, diff computation
(`computeTableDiff`), multi-pane grid, CSV export (`csvCell`, `downloadCurrentCsv`), settings panel,
and `TablePane` (fetch-glue). Card becomes thin: fetch → `<Table table={...} diffStatuses={...} />`.

Prop interface (== today's `TableGrid` signature, a rename):
```ts
export interface TableColumn { name: string; type: "number"|"string"|"bool"|"other" }
export interface TableData { columns: TableColumn[]; data: unknown[][]; truncated?: boolean }
export interface TableProps {
  table: TableData; rowsPerPage: number; hiddenColumns: string[];
  diffStatuses?: CellComparison[][]; invertDiff?: boolean; className?: string;
}
```

### 3b. `FigureInteractiveCard.tsx` (985 lines) → wrap into `lib/cairn-plot/renderers/Figure.tsx`

Uses react-plotly: `const Plot = createPlotlyComponent(Plotly)` (`:35`, `plotly.js-dist-min`), with
three duplicated `<Plot data layout config .../>` call sites (`FigurePane:361-370`, main `:755-767`,
overlay `:833-845`). Layout pipeline: base + `DARK_LAYOUT` + settings, width/height stripped for
autosize, then `applyViewOverrides`/`extractViewState`/`deepMerge` (`:166-249`) for cross-pane
zoom/pan/3D-camera sync. Data fetched via `usePlotlySource` (`:141-155`) → `PlotlyFigureLike{data,layout}`.

**Plan (WRAP — Plotly stays INSIDE):** create `renderers/Figure.tsx` owning **all** direct Plotly
usage (`createPlotlyComponent`, `<Plot>`, the `plotly.js-dist-min` import, `onPlotlyError`,
`DARK_LAYOUT`/`extractViewState`/`deepMerge`/`applyViewOverrides` — already pure, consolidating them
removes the 3× duplication). The card keeps `useSequence`/`usePlotlySource`/overlay fetch, merge
orchestration (`checkFigureMergeable`/`mergeFigures`), step slider, `SharedView` state + `resetView`
(its `.js-plotly-plot` DOM scan keeps working), and the `<img>` fallback decision (that path is
`ImagePane`, stays card-orchestrated). Deeper Plotly-removal is **deferred** — the wrapper keeps
Plotly for now; the point is a pure, data-via-props boundary.

Prop interface:
```ts
export interface FigureInteractionSettings { displayModeBar:boolean; scrollZoom:boolean;
  hoverMode:"closest"|"x unified"|"y unified"|"none"; dragMode:"zoom"|"pan"|"select"|"lasso"|"none";
  showLegend:boolean }
export interface FigureProps { figure: PlotlyFigureLike; settings: FigureInteractionSettings;
  viewOverrides?: Record<string,unknown>; onRelayout?: (v:Record<string,unknown>)=>void;
  revision?: number; style?: React.CSSProperties; className?: string }
```

Both stragglers ship **in-app, behind the existing cards** (behavior-preserving), and are then
Python-emittable via the same bootstrap. They can proceed in **parallel** with each other and are the
recommended **first workstream** (§7).

---

## 4. The plot bundle + bootstrap (design)

Reuse the **existing 2nd-vite-entry infra** (`vite.config.ts:13-22` `rollupOptions.input =
{main:index.html, embed:embed.html}`; `embed-main.tsx` mounts `#embed-root` with StrictMode →
QueryClientProvider → MemoryRouter → one `CardRenderer`). Add a **THIRD, sibling entry** — a "plot"
entry that mounts a **pure `cairn-plot` renderer** (not `CardRenderer`, no card, no MemoryRouter/app
chrome needed unless a renderer transitively needs router context — verify; the pure renderers do
not).

**Files to add:**
- `cairn/ui/plot.html` — mirrors `embed.html`; mount `<div id="cairn-plot-root">`; `<script
  type="module" src="/src/plot-main.tsx">`; `class="bg-bg text-fg"` + `index.css` so tokens apply.
- `cairn/ui/src/plot-main.tsx` — the **one bootstrap, pluggable source**:
  1. Read the **plot descriptor** from an inlined `<script type="application/cairn-plot+json">` blob
     on the page (LOCAL default — self-contained, no URL param) OR a `?sid=`/`?src=` param (ENDPOINT).
     The descriptor = `{ renderer: "scalar"|"scatter"|...|"image"|"pointcloud"|..., props: <the
     renderer's non-data config>, data: <DataSpec>, mode: "local"|"endpoint" }`.
  2. **Resolve the `DataSpec` → the renderer's data-contract props (§1)** via a pluggable
     `DataSource`: LOCAL reads content-addressed blobs from the page store (§5) and, for 3D/hist,
     runs cairn-plot's own `parseNpy/parseNpz/computeHistogram`; ENDPOINT builds absolute
     `artifactUrl`s / fetches bytes from the repo endpoint. This reuses the extracted
     `viewport/data-sources.ts` (§2) for media/3D and a trivial passthrough for the 2D JSON contracts.
  3. `createRoot(#cairn-plot-root).render(<Renderer {...resolvedProps} />)` — a small `RENDERER_MAP:
     Record<string, React.ComponentType>` selecting the pure renderer by name. It imports the **SAME**
     `lib/cairn-plot` renderers the UI uses (consistency by construction).
  4. Emit `cairn:resize` auto-height (reuse `embed-main.tsx:87-106`'s `useEmitAutoHeight`) so the
     notebook host can size the output — same protocol as embed.
- `vite.config.ts`: add one line `plot: "plot.html"` to `rollupOptions.input`. Default Vite output
  naming shares the `/assets` chunk graph, so React + cairn-plot dedup across entries; **commit
  `dist/`** (memory: pip installs can't always build).
- Server (`app.py` `_mount_spa_or_placeholder`): serve `dist/plot.html` bytes at `GET /plot` (read
  once at startup, like `index.html`/`/embed/card`), **registered before the SPA catch-all**. Needed
  only for the ENDPOINT/URL variant; LOCAL needs no server (the HTML+JS+data are self-contained,
  emitted by Python — see §7 bundle strategy for how the JS gets to a self-contained page).

**LOCAL vs ENDPOINT is one branch in step 2.** Same entry, same `RENDERER_MAP`, same renderers.

---

## 5. The content-addressed shared store (LOCAL mode)

A **page-level registry** so multiple plots on one page (multiple notebook cells share the same page
DOM) **dedup + share** their baked blobs (an image referenced by two plots is stored once).

**Shape** — a single global keyed by content hash, written include-once:
```html
<script type="application/cairn-plot-store+json" id="__cairn_plot_store__">
{ "sha256:ab12…": { "mime":"image/png", "b64":"iVBORw0K…" },
  "sha256:cd34…": { "mime":"application/x-npy", "b64":"k05VTVBZ…" } }
</script>
<script>window.__cairnPlotStore = window.__cairnPlotStore || {};
  Object.assign(window.__cairnPlotStore, JSON.parse(
    document.getElementById("__cairn_plot_store__").textContent));</script>
```
- **Registration is additive/idempotent** (`Object.assign` merges each cell's blobs; a repeated hash
  is a no-op) — so N cells contribute to ONE `window.__cairnPlotStore`, deduped by hash.
- A plot's descriptor references blobs **by hash**; the LOCAL `DataSource.bytes(hash)` = base64-decode
  `window.__cairnPlotStore[hash].b64`; `DataSource.artifactUrl(hash)` = `data:${mime};base64,${b64}`.
- **2D JSON contracts** (Series/points/matrix) are small and MAY be inlined directly in the descriptor
  (not the blob store) — the store is for large binary artifacts (image bytes, npy/npz) that benefit
  from dedup. Both live on the page; only the *large* ones are content-addressed.
- Hash = the artifact's existing content hash when known (server-backed data), else
  `sha256(bytes)` computed in Python at emit time.

This mirrors plotly's `include_plotlyjs`/`div` split: JS once, data-per-plot, shared where possible.

---

## 6. The Python emit (`cairn.plot`) + data-shaping

**Current state (already landed):** `cairn/plot.py` has `scalar/figure/table/image/mesh/pointcloud/
volume/boxes/media_compare/*_compare` builders (`:660-798`). Handle (`DataRef`) → `_card_element(...)`
→ `CardElement` (the **iframe** `/embed/card` path). Raw simple data → `HtmlElement` (self-contained
Plotly HTML, scalar/figure/table only). `_card_element` (`:604-655`) builds a `CardSpec`
(`card_spec.py` — `id,type,series:[SeriesRef{runId,name,context_hash}],settings`) and wraps it.
`elements.py` has `Element` (base, `_repr_html_`/`_repr_mimebundle_`), `HtmlElement`, `CardElement`
(iframe + degradation, `POST /api/embed/specs → sid → <iframe src=/embed/card?sid=…>`).

**What changes.** Introduce a **`PlotElement`** (new, `cairn/sdk/elements.py`) — the plots-only,
renderer-mounting display object that **replaces `CardElement` as the default** return of the
`cairn.plot.*` builders:

- `cairn.plot.X(data, *, mode="local"|"endpoint")` (author-selectable per output; default in §7).
  Keep `X(data)` ergonomics; add the keyword. `media_compare(a,b,*,mode=...)` already uses `mode` for
  the *compare* mode — use a **distinct** kw for the data mode (`data="local"|"endpoint"` or
  `embed=False`) to avoid collision.
- **Data-shaping = resolve the `DataRef`/raw → the renderer's data-contract shape from §1:**
  - **ENDPOINT**: descriptor carries `{mode:"endpoint", endpoint:<server>, renderer, props,
    data:{hashes/seriesRefs}}`. For scalar/scatter/etc., the by-reference `(runId,name,context_hash)`;
    for image/3D, the artifact `hash`. The bootstrap fetches from `<server>` at render time. Server
    URL/auth resolved via the existing `Transport`/`discovery`/`config` chain and the
    `_server_url_of`/`_repo_path_of` helpers already in `plot.py:571-599`.
  - **LOCAL**: Python **resolves the data now** (via the existing `reader.py` — `Run.sequence(name)` /
    `Run.artifact(name,step)` behind the `DataRef`), shapes it to the §1 contract, base64s any binary
    into the store (§5), and inlines the descriptor. For **2D** the contract is plain JSON (Python
    builds `Series[]`/`points[]`/`matrix` directly — the same shapes the TS cards build in
    `ScalarPlotCard.tsx:183-203`). For **image**, bake PNG/JPEG bytes + parse overlay metadata into
    `ImageOverlayData`. For **3D**, bake the `.npy`/`.npz` bytes (the bootstrap parses them with
    cairn-plot's `parseNpy/parseNpz`). Handler byte formats to reproduce: pointcloud `.npy`/`.npz`
    Float32 (`handlers/pointcloud.py`), image PNG/JPEG + base64 masks in metadata (`handlers/image.py`),
    table JSON `{columns:[{name,type}],data,truncated}` (`handlers/table.py`).
  - **Raw data** (`np.ndarray`/PIL/bytes) → **only LOCAL** makes sense (there is no server ref);
    resolves the `_resolve_series` `NotImplementedError` (`plot.py:544-570`) for the LOCAL path — this
    IS the deferred "WS-INLINE" capability, now enabled *for plots via baking*, not via a new
    CardRenderer variant.
- **`PlotElement._repr_html_` / `_repr_mimebundle_` / marimo** emits, plotly-style, **include-once**:
  (1) the **renderer bundle** (the `dist` plot JS) — inlined once per page or linked (§7); (2) the
  **store** blobs (§5, LOCAL) or endpoint refs (ENDPOINT); (3) a **mount `<div id>` + descriptor
  `<script application/cairn-plot+json>`** + a `bootstrap(divId, descriptor)` call. Multiple elements
  on a page share bundle + store (include-once guard on `window.__cairnPlotBundleLoaded`).
- **Reuse `card_spec.py` where possible:** the ENDPOINT descriptor's by-reference data can reuse
  `SeriesRef`/`CardSpec` shapes (Python already validates against `docs/schemas/`). But note the plot
  descriptor is **renderer-props-shaped**, not card-spec-shaped — for LOCAL 2D it carries resolved
  `Series[]`, which `CardSpec` does not model. Add a small `PlotSpec` pydantic model (sibling of
  `CardSpec` in `card_spec.py`) = `{renderer, mode, props, data}` with a matching TS type in
  `lib/cairn-plot` so Python↔TS stay in lockstep (extend the existing schema drift-check).

**The iframe (`CardElement`) becomes optional/legacy** — kept for the full **card** experience
(interactive settings panel, live server data) when a user explicitly wants it; the plots-only
`PlotElement` is the default `cairn.plot.*` return.

---

## 7. Default mode, bundle strategy, and phasing

**Default data mode.** Recommend **LOCAL as the default** for `cairn.plot.*`: it is self-contained,
survives notebook export / no-repo-access / `file://` (the case where WS-PYAPI's iframe fails,
`notebook-python-and-embed.md:398`), and needs no running server — the strongest "just works"
posture. **ENDPOINT** is opt-in for large/live data where baking is too heavy (big point clouds,
many-step sequences) and a repo endpoint is reachable. (Open question O1.)

**Bundle strategy (renderer JS).** Mirror `include_plotlyjs`:
- **Default: inline-once.** First `PlotElement` on a page inlines the plot bundle JS (guarded by
  `window.__cairnPlotBundleLoaded`); subsequent elements skip it. Fully self-contained, offline.
- **Opt-in: link** to `<server>/assets/plot-*.js` (smaller notebooks, needs server reachable) — the
  ENDPOINT companion.
- **No CDN** (cairn-plot is first-party; no external host). Bundle size is the cost of inline — the
  plot entry should tree-shake to only the imported renderers; verify the 3D/Plotly renderers are
  **lazy chunks** so a scalar plot does not inline three.js/plotly. (Open question O2.)

**Which renderers ship to Python first.** The **clean 2D + single-image** ones — `scalar, scatter,
parallel, bar, histogram, heatmap, image` (single-view), plus `table` and `figure` once the stragglers
land. These have trivial LOCAL baking (JSON or single PNG). **3D** (pointcloud/mesh/boxes/volume) ships
next (npy/npz baking + lazy three.js chunk). **`media_compare`'s compare/diff is currently
card-orchestrated** (the `VisualContentCard` resolves reference + drives the `CompositeMediaPane`
compositor via the `useMediaReference`/`baselineIndex` machinery). The **compositor itself is pure**
(`media-compare/compositor.tsx` — `CompositeMediaPane`, no api/fetch; verified §media-compare grep).
So a **pure two-pane "compare" mount is feasible** but requires the bootstrap to feed BOTH resolved
frames + the `mode`/`baselineIndex`/`diffMode` — more than a single renderer. **Recommendation: defer
`media_compare` to a later phase** (single-view first; compare after the two-pane compositor is driven
directly from the bootstrap), matching the task's "media_compare compare/diff is card-orchestrated"
note.

**Phasing (with review/gates):**

```
Phase A  STRAGGLERS (parallel, in-app, behavior-preserving)   ── no Python yet
  A1  TableCard → renderers/Table.tsx   (move TableGrid; card stays thin)
  A2  FigureInteractiveCard → renderers/Figure.tsx (wrap Plotly; card uses wrapper)
  A3  Extract viewport/data-sources.ts (pure hash→TData core; app passes api source)
  Gate: app renders identically (browser-verify each card); no data-via-props regressions.

Phase B  PLOT BUNDLE + BOOTSTRAP  (needs A3; independent of Python)
  B1  plot.html + plot-main.tsx + RENDERER_MAP + pluggable DataSource (LOCAL+ENDPOINT)
  B2  content-addressed store (§5); cairn:resize auto-height; vite 3rd entry; commit dist
  B3  GET /plot server route (ENDPOINT variant), before catch-all
  Gate: hand-crafted descriptor + store renders each 2D/image renderer standalone in a
        bare HTML page (LOCAL) and against a running repo (ENDPOINT); browser-verify.

Phase C  PYTHON EMIT + DATA-SHAPING  (needs B)
  C1  PlotElement (elements.py) + PlotSpec (card_spec.py) + TS PlotSpec type + schema drift-check
  C2  cairn.plot.* return PlotElement; LOCAL data-shaping per §1 (2D JSON, image bytes, overlay)
  C3  _repr_html_/_repr_mimebundle_/marimo include-once emit; default mode=local
  C4  raw-data LOCAL path (resolves _resolve_series NotImplementedError for plots)
  Gate: Jupyter + marimo display smoke (each renderer); offline/file:// self-contained render;
        Python↔TS PlotSpec round-trip.

Phase D  3D + media_compare  (needs C)
  D1  npy/npz baking + lazy three.js chunk; pointcloud/mesh/boxes/volume to Python
  D2  two-pane compare mount driven from bootstrap (media_compare)
  Gate: 3D render offline; compare modes (side/split/blend/diff) match the card.

Deferred: snapshot tier; cards-in-Jupyter; deeper Plotly removal from Figure.
```

**First workstream = Phase A (the stragglers + the `data-sources.ts` extraction)** — parallelizable,
in-app, behavior-preserving, and the prerequisite that turns Table/Figure into pure plots and quarantines
the media/3D fetch behind a pluggable source.

---

## 8. Risks + open questions

- **O1 — default data mode.** LOCAL-by-default (self-contained, recommended) vs ENDPOINT-by-default
  (small notebooks, needs server). Recommend LOCAL. Confirm.
- **O2 — bundle weight of inline-once.** Inlining the plot JS per page is heavy if three.js/plotly are
  eagerly bundled. Requires lazy renderer chunks so a scalar plot ships only the 2D core. Confirm the
  lazy-chunking approach and acceptable inline size.
- **O3 — `PlotSpec` as a second TS↔Python contract.** The plot descriptor is renderer-props-shaped
  (esp. LOCAL 2D carrying resolved `Series[]`), which `CardSpec` does not model. Adding `PlotSpec`
  (+ its own schema drift-check) is the honest option but is a second contract to maintain. Accept, or
  force everything through `CardSpec` + a by-ref-only ENDPOINT (losing LOCAL self-containment)?
- **R1 — media_compare purity boundary.** The compositor is pure but the *reference resolution*
  (`useMediaReference`, `baselineIndex`, cross-type) is card-orchestrated. A two-pane bootstrap must
  re-implement the minimal resolve (feed two frames + mode) without pulling the card. Scoped to Phase D;
  risk it drifts from the card's behavior — pin with a visual parity check.
- **R2 — router/query context.** Confirm the pure renderers need neither `MemoryRouter` nor
  `QueryClientProvider` (they should not — they are prop-pure); if any transitively imports a hook that
  does, wrap minimally in `plot-main.tsx` as `embed-main.tsx` does.
- **R3 — data volume in LOCAL.** Baking many-step sequences / large point clouds inflates the notebook.
  The store dedups across cells, but a single huge artifact is still inlined; ENDPOINT is the escape
  hatch — document the size guidance.
- **R4 — 3D bundle in a notebook.** three.js + WebGL in a Jupyter output cell (multiple live GL
  contexts across cells) — the `context-pool.ts`/`webglContextsPerPane` budgeting is card-level today;
  the bootstrap must honor a per-page GL budget. Phase D concern.
- **R5 — theme tokens.** The renderers use `bg-bg`/`text-fg` CSS tokens (`index.css`); the plot page
  must ship those (as `embed.html` does) or plots render unstyled. Include the token CSS in the inline
  bundle.
- **R6 — hash source for LOCAL.** For raw (untracked) data there is no server content hash; compute
  `sha256(bytes)` in Python at emit. Ensure it matches the store key the bootstrap reads.

---

## Appendix — key files cited

- Pure renderers: `cairn/ui/src/lib/cairn-plot/renderers/{ScalarPlot,ScatterPlot,ParallelCoords,BarChart,HistogramPlot,Heatmap,ImagePane,ImageOverlay,PointCloudViewer}.tsx`; barrel `renderers/index.ts`; shared `lib/cairn-plot/types.ts`, `transforms/histogram.ts`; `lib/cairn-plot/index.ts` (exports `parseNpy/parseNpz/computeHistogram`).
- Viewport contract: `lib/cairn-plot/viewport/types.ts` (`ViewportModule.useData` :318, `ViewportPaneProps` :204, `ViewportDataArgs` :162); modules `viewport/{image,pointcloud,mesh,boxes,volume}-viewport.tsx`; app-layer `components/viewport-registry.tsx:84-97` (`useImageData`), `components/PointCloudVisualCard.tsx:50`.
- media-compare (pure compositor): `lib/cairn-plot/media-compare/{index,compositor,reference,mode}.ts` (no api/fetch).
- Seam example: `components/ScalarPlotCard.tsx:535-556,618,627`.
- Stragglers: `components/TableCard.tsx` (`TableGrid` :159-362, `TableData` :51-62); `components/FigureInteractiveCard.tsx` (`:35,141-155,166-249,361-370`).
- Embed infra to mirror: `cairn/ui/vite.config.ts:13-22`; `cairn/ui/src/embed-main.tsx` (:87-106 auto-height, :189-202 fetch); `cairn/ui/embed.html`; `cairn/server/app.py` `_mount_spa_or_placeholder` (:230-279, `/embed/card` :248-261); `cairn/server/routes/embed.py`; `cairn/server/embed_specs.py`.
- Python emit: `cairn/plot.py` (builders :660-798, `_card_element` :604-655, `_resolve_series` :544-570, server helpers :571-599); `cairn/sdk/elements.py` (`Element`/`HtmlElement`/`CardElement` :76-283); `cairn/sdk/card_spec.py` (`CardSpec`/`SeriesRef`/`CardSettingsSpec`, `CARD_TYPES`); handlers `cairn/sdk/handlers/{pointcloud,image,table,figure}.py`.
- Superseded default: `docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md` §5/§11.
