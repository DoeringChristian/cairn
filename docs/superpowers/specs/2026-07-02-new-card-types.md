# New Card Types — Feature Specification

**Date:** 2026-07-02. **Companion:** `docs/cards-style-guide.md` (binding for all workstreams).
**Origin:** gap analysis vs W&B + TensorBoard/MLflow/Comet/Neptune/Aim/ClearML. Cairn's card
system was just refactored (card-kit hooks, CardDescriptor union, CardShell slots, cairn-plot
library) — these features are its first consumers.

Seven parallel workstreams, each in its own worktree/branch. Assigned ports for local
verification servers: A=4311, B=4312, C=4313, D=4314, E=4315, F=4316, G=4317.

---

## Workstream A — Histogram chart + Tensor card (branch `feature/histogram-tensor`)

**A1. Finish the histogram card.** The SDK already stores full `counts` + `edges` as `.npz`
(`HistogramHandler`), and `HistogramCard.tsx` renders only a metadata grid ("coming in a
later pass" comment). Build `cairn-plot/renderers/HistogramPlot.tsx`:
- Per-step view: SVG bar chart of counts vs bin edges (log-y toggle), tooltip with bin
  range + count. Axis/format utilities from cairn-plot (`formatNum`).
- Steps view: W&B-style heatmap over steps (x = step, y = bin, color = count via existing
  colormap LUTs) as a settings-selectable mode when >3 steps logged.
- Data path: the card fetches the artifact blob and parses the npz in the browser. npz is
  a zip of npy entries: write a small `parse-npy.ts` + `parse-npz.ts` under
  `cairn-plot/transforms/` (npy v1/v2 header + typed-array view; zip entries are STORED
  (uncompressed) by numpy's `savez` — support stored entries; if a file uses deflate, use
  DecompressionStream). No new deps.
- Card keeps step slider (`useStepSlider`), gains settings: view mode (bars/heatmap),
  log-y, colormap (reuse `Colormap` type).

**A2. Tensor card.** `cairn.Tensor` → `.npy` blob (`TensorHandler`) currently falls to
UnknownTypeCard. New `TensorCard.tsx` (register `case "tensor"` in CardRenderer, add to
AddCardModal TYPE_ORDER):
- Header: shape/dtype/min/max/mean from metadata (no blob fetch needed for collapsed view).
- Body views (settings-selectable): **stats** (metadata grid, default when blob > 10MB),
  **histogram** (client-computed bins over the flattened tensor → reuse HistogramPlot),
  **heatmap** (2D tensors, or a slice of ND tensors via per-dimension index selectors;
  canvas render through the existing colormap LUT path — read how ImagePane applies
  colormaps). Reuse `parse-npy.ts` from A1.
- Step slider across logged steps.
Out of scope: 3D surface plots, editing. Demo: `examples/demo_histogram_tensor.py` logging
evolving histograms (shifting gaussian), 2D tensors (attention-map-like), 3D tensor slices.

---

## Workstream B — Table card (branch `feature/table-card`)

**SDK:** `cairn.Table` wrapper (`wrappers.py`): construct from `columns=[...], data=[[...]]`,
or `dataframe=` (pandas via `_optional`). Handler `handlers/table.py`, object_type `table`,
serializes JSON `{"columns": [{"name", "type": "number"|"string"|"bool"|"other"}], "data":
[[...]]}` (values JSON-native; non-native values `str()`-ed). Row cap 10_000 at log time
(truncate + `"truncated": true` + original row count in metadata). Metadata: n_rows, n_cols,
column names (first 20).

**UI:** `TableCard.tsx` (lazy). Hand-rolled grid, no dep:
- Column sort (asc/desc, numeric-aware), case-insensitive substring filter box, pagination
  (100 rows/page) — all client-side on the parsed JSON.
- Sticky header row; `mono` cells for numbers; cell overflow ellipsis + title tooltip.
- Step slider across logged steps (a table per step); CSV download header action (reuse
  `downloadCsv` from `lib/download.ts`).
- Settings: rows-per-page, column visibility toggles.
- Multi-run comparison: `MultiPaneGrid` panes (one table per run), like Audio/Video do.
Out of scope v1 (note in card code as comments): media-in-cells, cross-table joins, derived
columns. Demo: `examples/demo_table.py` — per-epoch predictions table (mixed types, 1k rows)
+ a small summary table, two runs for comparison panes.

---

## Workstream C — Image bounding boxes + segmentation masks (branch `feature/image-overlays`)

**SDK:** extend `cairn.Image` wrapper with optional `boxes=` and `masks=`:
- `boxes`: list of `{position: {minX, minY, maxX, maxY}, domain: "pixel"|"fraction"
  (default fraction), class_id: int, label: str|None, score: float|None}` — plus a
  `class_labels: {int: str}` map on the wrapper. Serialized into sequence/artifact
  **metadata** JSON under `"boxes"` (small). Validate at log time; cap 500 boxes.
- `masks`: dict name → 2D uint8/int ndarray of class ids. Each mask is PNG-encoded
  (grayscale, palette-free) and embedded base64 in metadata under `"masks": {name:
  {"png_b64", "class_labels": {...}}}`; cap 2MB base64 per mask, else raise with a clear
  message. (One artifact per point is a hard ingest constraint — metadata is the sidecar.)
**UI:** overlay layer inside `cairn-plot/renderers/ImagePane.tsx` (and its fullscreen/modal
path): an absolutely-positioned `<canvas>`/SVG scaled with the image transform (must track
the existing zoom/pan CSS transform — read `useImageViewport` usage first):
- Boxes: colored per class (SERIES_COLORS cycle), label + score chip; controls (header or
  settings): per-class visibility toggles, score-threshold slider (0–1), overlay on/off.
- Masks: decode PNG → offscreen canvas, colorize per class id via LUT, alpha-composite with
  an opacity slider; per-class toggles shared with boxes.
- Overlay state lives in card settings (persisted). Works in single, multi-pane, split and
  blend modes (in split/blend, overlay the FOREGROUND image only — document this).
Out of scope: 3D boxes, polygon annotations, editing. Demo: `examples/demo_image_overlays.py`
— synthetic scenes with 2 classes of boxes + a segmentation mask evolving over steps.

---

## Workstream D — HTML card + Markdown card (branch `feature/html-markdown`)

**SDK:** `cairn.Html(html: str)` and `cairn.Markdown(text: str)` wrappers; handlers
`handlers/html.py` / `handlers/markdown.py`; object_types `html`, `markdown`; UTF-8 blobs;
metadata: byte size + first-160-char stripped preview (mirror TextHandler).
**UI:**
- `HtmlCard.tsx` (lazy): sandboxed iframe (`sandbox="allow-scripts"`, `srcdoc`), no network
  escape hatch beyond what sandbox allows; auto-height via the plugin protocol's
  `cairn:resize` postMessage IF the document posts it (inject the same tiny listener shim
  PluginCard uses — read PluginCard's iframe srcdoc wiring first), else fixed height from
  card settings. Step slider. Never render logged HTML outside a sandboxed iframe.
- `MarkdownCard.tsx` (lazy): `react-markdown` + `remark-gfm` (pre-approved deps), prose
  styling consistent with the app (headings/mono/code blocks using theme tokens; no
  raw-HTML passthrough — keep `react-markdown`'s default HTML escaping ON). Step slider.
Both: register in CardRenderer + AddCardModal; multi-run panes via MultiPaneGrid.
Demo: `examples/demo_html_markdown.py` — an HTML mini-report (inline SVG sparkline, styled
table) per step + markdown training notes with GFM tables/checklists.

---

## Workstream E — Summary cards: bar chart, scalar tile, run-comparer upgrade, AddCardModal
completeness (branch `feature/summary-cards`)

All UI-only, multi-run (workspace) card types — extend the `CardDescriptor`
`kind: "multi-run"` union exactly like `parallel`/`scatter` (cardType strings `"bar"`,
`"tile"`), including AddCardModal `AddCardSelection` tabs and ComparePage descriptor
construction. Settings keys follow the multi-run pattern ({runId: compare:<id>,
metricName: cardType, contextHash: card.id}) — never invent a new shape.

**E1. BarChartCard**: for a chosen scalar metric (settings: metric picker like ScatterPlot's
axis picker; aggregation last|min|max|mean over the series), horizontal bars, one per run,
sorted (settings: by value/by name), run-colored via SERIES_COLORS, value labels, click →
run selection (`useRunSelection`), log-x toggle. Renderer `cairn-plot/renderers/BarChart.tsx`
(pure SVG, mirror ScatterPlot's structure incl. tooltip + useContainerSize).
**E2. ScalarTileCard**: big-number tile for one metric: settings pick metric + aggregation
(across runs: best/mean/latest + which run "best" means min|max); shows value (formatNum),
metric name, run label, delta vs previous step when available. Compact — designed for
colSpan 1.
**E3. Run-comparer upgrade** (`pages/ComparisonOverviewTab.tsx`): add a summary-metrics
section (per run: LAST value of each scalar metric, columns = runs, rows = metrics, capped
at 50 metrics with a filter box) and a "differences only" toggle that hides rows where all
runs are equal (params + env + metrics sections all obey it).
**E4. AddCardModal completeness**: add the missing existing types (`artifact`, `plugin`) to
TYPE_ORDER/TYPE_LABELS so they can be added manually. (Tensor is workstream A's line —
coordinate by keeping your edit to exactly your additions.)
Demo: none needed beyond existing data (uses scalars) — but write
`examples/demo_summary_cards.py` seeding 4 runs with distinct final metrics anyway, so the
merge agent has deterministic data.

---

## Workstream F — Point-cloud card (branch `feature/pointcloud`)

**SDK:** `cairn.PointCloud` wrapper: from ndarray shaped (N,3) xyz, (N,4) xyz+category, or
(N,6) xyz+rgb (0-255 or 0-1 auto-detected). Downsample >300_000 points at log time (uniform
random, seeded) + record original count. Serialize `.npy` float32 (N,C) blob; metadata:
n_points, channels ("xyz"|"xyzc"|"xyzrgb"), bounds (min/max per axis), original count.
Object_type `pointcloud`. Handler `handlers/pointcloud.py`.
**UI:** `PointCloudCard.tsx` (lazy — three.js only loads here). Renderer
`cairn-plot/renderers/PointCloudViewer.tsx`:
- `three` (pre-approved dep): Points + BufferGeometry, orbit controls implemented against
  the project's self-contained rule (attach your own pointer/wheel handlers — you may use
  three's OrbitControls class since it binds to the canvas internally; the requirement is
  no EXTERNAL React hooks needed by consumers).
- Color: rgb channel if present; else category → SERIES_COLORS; else height (z) → viridis
  LUT from cairn-plot colormaps. Settings: point size, color mode, background.
- Camera: fit-to-bounds on load + double-click to re-fit; persist camera in transient state
  only (NOT settings — too noisy).
- WebGL context hygiene: dispose geometry/renderer on unmount (multi-pane comparisons
  create several contexts — cap panes at 4 with a "showing 4 of N" note).
- npy parsing: reuse workstream A's `parse-npy.ts` IF merged first; otherwise vendor your
  own copy at the same path and note it — merge agents will dedupe (identical path/content).
Step slider; multi-run panes via MultiPaneGrid (≤4). Demo: `examples/demo_pointcloud.py` —
rotating synthetic shapes (sphere/torus) with rgb + a categorical scan, 2 runs.

---

## Workstream G — SDK plot helpers (branch `feature/plot-helpers`)

Pure-Python `cairn/plot.py` (exported as `cairn.plot`), producing **plotly figures** that
flow through the existing `figure` pipeline (zero new UI). Pure numpy implementations — NO
sklearn dependency (accept y_true/y_pred/y_probas arrays directly):
- `cairn.plot.confusion_matrix(y_true, y_pred, class_names=None, normalize=None|"true"|"pred")`
  → annotated plotly heatmap.
- `cairn.plot.pr_curve(y_true, y_probas, labels=None, classes_to_plot=None)` — binary +
  one-vs-rest multiclass; interpolated precision envelope like the common convention.
- `cairn.plot.roc_curve(y_true, y_probas, labels=None, classes_to_plot=None)` + AUC in trace
  names (trapezoid rule).
- `cairn.plot.bar(labels, values, title=None)` and `cairn.plot.line_series(xs, ys, keys)` —
  thin conveniences.
Plotly is already an optional dep (`_optional.py` / media extra): raise a clear ImportError
message mentioning `pip install cairn-track[media]` when missing. Numeric edge cases: empty
classes, single-class input, NaN handling — decide, document in docstrings, and pytest each
(`tests/unit/test_plot_helpers.py`, golden-value assertions on small hand-computed inputs).
Demo: `examples/demo_plot_helpers.py` logging all helpers for a fake 3-class classifier
across steps. No UI changes at all.

---

## Merge order (for the integration phase)

G → D → A → E → B → C → F (smallest/most-independent first; C touches ImagePane which no
other workstream edits; F may share `parse-npy.ts` with A — dedupe at merge).

## Global acceptance (every workstream)

Typecheck exit 0, vite build green, SDK pytest green, demo example logs cleanly into a fresh
repo, `cairn ui --repo ... --port <assigned>` serves it and the API returns the new
sequences, commit(s) on the feature branch with dist rebuilt by the hook. Browser-level UI
verification is performed serially by merge agents on port 4301 after each merge.
