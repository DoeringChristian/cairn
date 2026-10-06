# Changelog

## 0.3.0 — 2026-10-06

The first tagged release. cairn-track and cairn-ui are released together at
the same version; `cairn-track[ui]` pins the matching cairn-ui commit.

### Breaking

- **cairn-plot is gone**: no `cairn.plot`, no `[plot]` extra, no
  `vendor/cairn-plot` submodule. The viewer draws with uPlot, Plotly and three.js.
- **Artifacts v2**: one versioned artifact model (entries, versions, aliases,
  tags, lineage, `download()` to a directory); data from the old artifact
  tables is not read.
- **Config is nested** (`run.config` is a nested dict) and `summary` is a
  separate channel; metric rules live on `run.track(summary=, x=)`
  (`define_metric` is gone).
- **No contexts**: a sequence is `(run, name)`; use name prefixes.
- **Comparisons are workspaces**: a comparison copies the project workspace
  layout; old comparison tables are dropped.
- **Images map by dtype**: float `[0, 1]`, uint8 `[0, 255]`, clipped; PNG by
  default (`encoding=` for EXR/npy); sRGB conversion only with `linear=True`.
- **Tokens are per server** (`cairn login URL`, `cairn logout`, `[tokens]` table).
- **CLI reshaped**: every data command takes `--repo` / `--server` and works
  on local repos; `cairn artifact …` and `cairn report …` groups.
- **Viewer manifests**: the setting tab `data` is now `values`.
- `Run.url` is the URL `cairn open` prints (the UI), also for local repos.
- Back-compat paths removed throughout the SDK (`log_artifact(type=)`,
  `wal.checkpoint()`, bare-int checkpoints, `value_range`, `run[key] = value`).

### Added

- **Custom data and viewers**: `cairn.Data(payload, kind=…)`;
  browser-only viewers in a sandboxed iframe (`cairn:sdk`, vendored imports),
  `cairn viewer init | add | dev | publish | ls`, `Run.use_viewer`,
  one default viewer per kind, built-in `cairn.volume` ray marcher.
- **Galleries for every media kind** (a list of media is one gallery point).
- **Artifacts**: directory and multi-file artifacts, external references,
  explorer and draggable lineage graph, whole versions download as a zip.
- **Run selection** shared with the UI (`RunQuery.where(expr)`, `Run.eval`),
  `Run.final`, `reader.run(id).edit()`, bulk history.
- **Runs**: resume, fork and rewind; stop from the UI; alerts with webhooks;
  git remote and working-tree diff; disabled mode.
- **Sweeps**: server API, `cairn sweep` / `cairn agent`, `cairn.sweep`.
- **Integrations**: Lightning, Keras, XGBoost, Hugging Face; `run.watch` for
  torch gradients/parameters; `cairn import-tb`.
- **CLI**: archive/unarchive, `export-runs` / `import-runs` (run archives),
  `cairn diff`, `configure --repo`, reports by id and across projects.
- Reports with share links (scoped, default-deny), comments and assets.

### Web UI

- **Workspaces**: the run page is the project workspace; sections, drag & drop,
  include unlisted metrics, saved layouts.
- **One card editor**: add a card from a section's ghost card
  (Data → Type with live previews → the editor); tabs
  `Data | Type | Values | Display | Expr`, title in the header.
- **Unified card header** on every card: screenshot (what you see),
  download, add to report, reset view, settings, duplicate, close.
- Images and videos: no flicker on stepping, prefetch and caching, split
  compare against a reference, zoom that survives resizes, video loop.
- Plotly figures on WebGL with a page-wide WebGL budget; 3D figures rotate
  and sync.
- Markdown is GFM + Pandoc with inline math everywhere.
- Runs table: resizable columns, grouping that follows the sort.
- Logged HTML is served as its own sandboxed document.

### Performance and reliability

- `metric_stats` summary index maintained at ingest: the runs list and
  workspaces load without scanning series.
- Batched, column-wise `/series` reads; gzipped JSON; the UI bundle is served
  gzipped and immutable (5.9 MB → 0.4 MB on the wire).
- Reads on a pool of read-only connections; bounded ingest transactions off
  the event loop; the SDK backs off to the local WAL and `finish()` is bounded.
- Concurrent processes opening a fresh repo no longer race on the WAL switch.
- Panels mount as they come near the screen.

### Security

- Custom viewers and logged HTML run in opaque-origin sandboxed frames;
  the app's shells set `frame-src 'self' blob:`; artifact blobs are served
  with `nosniff` and `Content-Security-Policy: sandbox`.

### Docs

- New documentation site (MkDocs Material, GitHub Pages): getting started,
  guides, web UI guide, Python/CLI references, custom viewers guide.

### Known issues

- Reset view does not reset the step slider or hidden series.
- A custom viewer's `setHeight()` has no effect.
- Downloading an empty card yields a CSV with headers only.
- With a custom viewer as a kind's default, a single card cannot switch back
  to the built-in renderer.
- The local write-ahead log grows until the run finishes.
- Very heavy parallel series reads are served one at a time.
- `npm audit` reports 9 advisories in build-time dependencies that need
  major upgrades (tailwindcss 4, vite 8, react-router 7).
