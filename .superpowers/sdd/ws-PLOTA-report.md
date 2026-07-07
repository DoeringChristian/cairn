# WS-PLOTA — cairn-plot Phase A: renderer extractions + data-source seam

Branch `feature/cairn-plot-phaseA`, base `ed8ab97f` (confirmed via `git log --oneline -1` at
worktree start — not stale).

## Piece 1 — extract the Table renderer (commit `43e2f31a`)

Moved `TableGrid` verbatim (759 lines → 226 lines of pure component, `TableCard.tsx:159-362`)
into `cairn/ui/src/lib/cairn-plot/renderers/Table.tsx` as the default export `Table`, taking the
identical `{ table, rowsPerPage, hiddenColumns, diffStatuses?, invertDiff? }` props. `formatCell`
moved with it (it was only used inside `TableGrid`). `TableColumn`/`TableData` interfaces moved
from local declarations in `TableCard.tsx` into `Table.tsx` and are now imported back.
`diffCellClassName`/`CellComparison` stay in `../../table-diff` (app-owned, also used by
`ComparisonOverviewTab.tsx`) — `Table.tsx` imports them, following the existing precedent of
`lib/cairn-plot/image/render-mode.ts` reaching into `../../storage`.

Exported from `renderers/index.ts` and the top `lib/cairn-plot/index.ts` barrel (no bundle-size
concern — Table has no heavy deps).

`TableCard.tsx` now imports `Table as TableGrid` from `../lib/cairn-plot/renderers` and calls it
at both existing call sites (single-view `TablePane`, multi-view comparison pane) unchanged.
Removed now-dead `useEffect`/`diffCellClassName`/`TableColumn` imports from the card.

**Behavior-preservation evidence:** identical JSX/logic, just relocated; `npm run typecheck`
exit 0; `vite build` dist diff is a pure asset-hash rename (chunk reshuffle only, no
new/dropped chunks).

## Piece 2 — wrap the Figure (Plotly) renderer (commit `b2a4b3bb`)

Created `lib/cairn-plot/renderers/Figure.tsx` owning ALL direct `react-plotly.js`/`plotly.js-dist-min`
usage: `createPlotlyComponent(Plotly)`, the single `<Plot>` call site (consolidating what were 3
duplicated call sites — `FigurePane`, the main single-figure render, the overlay render),
`onPlotlyError`, `DARK_LAYOUT`, `extractViewState`, `deepMerge`, `applyViewOverrides`, and the
base+viewOverrides layout-merge pipeline. `FigureInteractiveCard.tsx` (985 → 737 lines) now keeps
only: `useSequence`/`usePlotlySource` data fetch, figure-merge orchestration
(`checkFigureMergeable`/`mergeFigures`), the step slider, `SharedView` state + `resetView` (the
`.js-plotly-plot` DOM autorange scan — unchanged, stays card-owned since it's imperative
DOM/Plotly-instance manipulation), and the `<img>` fallback decision.

**Prop interface (`FigureProps`):**
```ts
interface FigureInteractionSettings {
  displayModeBar: boolean; scrollZoom: boolean;
  hoverMode: "closest"|"x unified"|"y unified"|"none";
  dragMode: "zoom"|"pan"|"select"|"lasso"|"none";
  showLegend: boolean;
}
interface FigureProps {
  figure: PlotlyFigureLike;           // { data?, layout? }
  settings: FigureInteractionSettings;
  viewOverrides?: SharedView;         // Record<string, unknown>
  onRelayout?: (v: SharedView) => void;
  revision?: number;
  style?: React.CSSProperties;
  className?: string;
  enableLiveRelayout?: boolean;       // see below
}
```

One deliberate, documented behavior-preserving addition: `enableLiveRelayout`. Pre-extraction,
ONLY the multi-pane `FigurePane` attached a live `plotly_relayouting` DOM listener (real-time
sync during 3D camera drag); the main/overlay single-plot render sites did not. To preserve this
exact asymmetry, `Figure.tsx` gates that extra listener behind `enableLiveRelayout` (default off);
`FigurePane` passes `enableLiveRelayout` explicitly, main/overlay omit it — matching pre-extraction
behavior exactly.

**Bundle-size regression found and fixed during this piece:** initially exported `Figure` from both
`renderers/index.ts` and the top `lib/cairn-plot/index.ts` barrels. Several cards are eagerly
bundled (not behind `lazy()`) — `ScalarPlotCard`, `HistogramCard`, `TensorCard`,
`VisualContentCard`, `viewport-registry` — and all import from those same barrels. Because
`plotly.js-dist-min` is a large non-tree-shakeable (UMD-style) bundle, merely being *reachable*
through the re-export chain pulled its full ~5MB into the eager main chunk even though nothing
eager actually used `Figure` (main chunk ballooned from 831KB to 5.69MB, and the previously-separate
`FigureInteractiveCard` lazy chunk vanished, having been absorbed into eager). Fixed by NOT
re-exporting `Figure` from either barrel; `FigureInteractiveCard.tsx` imports it directly from
`../lib/cairn-plot/renderers/Figure`. Rebuilt: main chunk back to 831.30 kB (identical to
pre-Piece-2), `FigureInteractiveCard` chunk 4,829.98 kB (matches pre-extraction 4,831.03 kB, tiny
diff from comment/whitespace only) — confirms the lazy boundary is intact. This mirrors an
existing documented precedent in the codebase (`viewport/index.ts`'s note on why
`pointcloud-viewport.tsx`, which pulls in `three`, is deliberately NOT barrel-exported).

## Piece 3 — extract the data-source seam (commit pending — see report SHA below)

New `lib/cairn-plot/viewport/data-sources.ts`:

```ts
interface DataSource {
  artifactUrl(hash: string): string;        // hash -> URL (image <img src>, or fetch target)
  bytes(hash: string): Promise<ArrayBuffer>; // hash -> raw bytes (binary parsers)
}
function createEndpointDataSource(artifactUrl: (hash: string) => string): DataSource
// derives `bytes` via a plain `fetch(artifactUrl(hash))` — today's ONLY implementation.

function resolveImageViewportItems(args, source: DataSource, parseOverlay): ViewportDataResult<ImageViewportItem>
// pure hash->TData core, mirrors viewport-registry.tsx's pre-extraction useImageData body exactly.

function fetchPointCloudArrays(hash: string, source: DataSource): Promise<PointCloudArrays>
// fetch+parse core (npz/npy sniff + parse), mirrors PointCloudVisualCard.tsx's pre-extraction
// fetchPointCloudArrays exactly, resolving bytes via source.bytes instead of
// fetch(api.artifactUrl(hash)) directly.
```

`viewport-registry.tsx`'s `useImageData` is now a thin `useMemo` wrapper around
`resolveImageViewportItems(args, endpointDataSource, parseOverlay)` — `parseOverlay` itself stays
in `viewport-registry.tsx` (app-owned, reused by `VisualContentCard.tsx`; it was already pure with
no `api.artifactUrl` dependency, so it wasn't part of the seam that needed extracting).
`PointCloudVisualCard.tsx`'s `usePointCloudBlobs` now calls `fetchPointCloudArrays(hash,
dataSource)` instead of its own inline fetch+parse; the local `looksLikeNpz`/`fetchPointCloudArrays`
functions and now-unused `parseNpy`/`parseNpz`/`extractProperties`/`PropertyMap` imports were
removed from the card.

`createEndpointDataSource`/`resolveImageViewportItems`/`fetchPointCloudArrays`/`DataSource`/
`PointCloudArrays` ARE exported from `viewport/index.ts` and the top barrel — safe to do so because
`data-sources.ts` has zero heavy dependencies (`parseNpy`/`parseNpz` are already eager-safe via
`TensorCard`; `PropertyMap`/`three/properties.ts` has no `three` import). No local (baked-store)
provider is wired up — that's explicitly Phase B; this piece only adds the interface + the
ENDPOINT implementation, with the app passing its `api.artifactUrl`-backed source exactly as
before.

**Behavior-preservation evidence:** same `api.artifactUrl` calls, same fetch/parse logic, just
parameterized over `source` instead of calling `api.artifactUrl` directly; `npm run typecheck`
exit 0; `vite build` dist diff is 21 old / 21 new asset files (pure rename), including a benign
chunk-name change (`properties-*.js` → `PropertySelector-*.js`) caused by Rollup's facade-naming
heuristic picking a different name after `PointCloudVisualCard.tsx`'s import list shrank — content
size delta negligible (rename percentage ~93%+ on unrelated chunks; PointCloud/Mesh/Boxes/Volume
chunk sizes unchanged in shape).

## Gates

- `cd cairn/ui && npm run typecheck` — exit 0 after every piece.
- `node_modules/.bin/vite build` — green after every piece; dist source diff is chunk-reshuffle
  only (verified via `git status --short` rename detection: equal deleted/added counts each time,
  no new/dropped top-level chunks).
- `uv run --extra dev pytest tests/unit` — 502 passed, 2 skipped, **15 failed** — matches the
  stated baseline exactly (`test_cli.py`/`test_config.py`/`test_config_target.py`/
  `test_local_transport.py`, all pre-existing env/config-resolution failures unrelated to this
  UI-only change).
- `dist/` committed each piece per project convention (pre-commit hook rebuilds + stages it
  automatically).

## Browser self-verify (`--no-auth`, port 4414, demo repo seeded from `examples/demo_table.py`,
`examples/demo_plot_helpers.py`, `examples/demo_pointcloud.py`, `examples/demo_training.py`)

- **Table card** (`table-demo` project): `predictions` (1000×5, paginated) and `summary` (4×3)
  render identically; tested numeric column sort (3-state cycle), text filter ("fish" →
  285/1000 rows, sort order preserved), pagination controls — all working via the extracted
  `Table` renderer.
- **Figure card** (`demo` project `training_curves`; `plot-helpers-demo` `eval.roc_curve`/
  `eval.pr_curve`/`eval.per_class_accuracy`/`eval.loss_curves`): single-run figures render
  correctly; drag-zoom → home/reset-view icon appears (`viewModified` gating intact) → click
  resets the view correctly; multi-run **panes** comparison mode (exercises `FigurePane` +
  `enableLiveRelayout`) renders two side-by-side panes correctly; multi-run **overlay** comparison
  mode (exercises `renderOverlayPlot` + `mergeFigures`) correctly merges both runs' traces into
  one plot with per-run-prefixed legend entries and continues to support drag-zoom. No console
  errors or uncaught axis-scaling exceptions in any case.
- **Image card** (`demo` project `predictions.sample`): moving-circle animation renders correctly
  via the extracted `resolveImageViewportItems`/`createEndpointDataSource` path.
- **Point Cloud card** (`pointcloud-demo` project, `run-a`): `big_scan` (rotating sphere) and
  `grid_scan` (torus) WebGL 3D viewers render correctly via the extracted
  `fetchPointCloudArrays`/`createEndpointDataSource` path — confirms Piece 3's npz/npy fetch+parse
  extraction is behavior-identical.
- **Comparison view**: opened a 2-run comparison (`plot-helpers-demo`), Overview + Metrics & Media
  tabs both render correctly (metric diff table, side-by-side + overlay figure cards as above) —
  nothing regressed.
- No console errors observed on any page (`read_console_messages` with `onlyErrors: true`, checked
  after fresh navigations on each of the above).
- Killed the port-4414 server after verification; port 4301 untouched.

## Anything not cleanly pure

- The `enableLiveRelayout` prop addition (Piece 2) — not semantically new behavior, but it IS a
  new prop not in the spec's literal `FigureProps` sketch, added specifically to preserve an
  existing pane-vs-single asymmetry that would otherwise have been silently changed by a naive
  extraction.
- The Piece 2 barrel-export bundle-size regression (caught and fixed within the same piece/commit,
  documented above) — a real risk in this kind of extraction that isn't obvious from the spec text
  alone; resolved before committing, verified via chunk-size diff against the pre-extraction
  baseline.
- Piece 3's `parseOverlay` was deliberately left in `viewport-registry.tsx` rather than moved into
  `data-sources.ts`, since it has no `api.artifactUrl` dependency (nothing to extract) and moving
  it would have widened the diff without functional benefit.
