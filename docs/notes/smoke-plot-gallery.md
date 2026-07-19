# cairn-plot gallery smoke harness

`cairn/ui/scripts/smoke-plot-gallery.mjs` (run: `cd cairn/ui && npm run smoke:plot`)
is a dependency-free regression gate for the standalone `cairn.plot` renderers.

## What it does

1. Regenerates the offline gallery from `examples/demo_cairn_plot.py`
   (`-o $TMPDIR/cairn-smoke-gallery.html`) — one `<section>` per plot type, each
   with its plot baked inline and rendered by the same `dist/plot-inline` bundle
   the web app ships.
2. Loads that file in a real headless Chromium (`--dump-dom`) and parses the
   painted DOM (bundle `<script>`/`<style>` blocks are stripped first, so we only
   ever assert against *rendered* nodes).
3. Asserts, per section, that real content rendered:
   - every section has an `<svg>` with >=8 descendants **or** a `<canvas>` **or** a
     `<table>` **or** an `<img src="data:...">`;
   - the Line / Scatter / Bar / Histogram / Heatmap sections have an `<svg>` with
     axis-tick `<text>` nodes;
   - no renderer placeholder text (`could not render`, `BundleUnavailable`);
   - zero `<img>` with an empty / `data:,` src.
   Prints a per-section PASS/FAIL table and exits non-zero on any failure.

It catches the class of regression where a section renders its toolbar/chrome but
no plot body — e.g. a chart `<svg>` gated on a measured container size that only
ever arrived from an async ResizeObserver (fixed in `use-container-size.ts`), or
the older missing-icon / broken-`<img>` bugs. None of those trip `tsc` or pytest.

## Why the capture is *early*, not settled

That ResizeObserver regression is a **first-paint gap**: with the fix the chart
body is seeded synchronously (layout effect) and is present on the first frame;
without it the last-settling section (the synced-chart grid) stays blank until
the async observer delivers (~400ms of virtual time), then fills in. A long
`--virtual-time-budget` (e.g. 15s) fast-forwards clean past that window and the
bug hides. The harness therefore captures at a short **250ms** virtual-time
budget — after every renderer's real first paint (~100ms here), before the broken
build's async catch-up. Virtual time is code-deterministic (Chromium advances it
through scheduled timers, decoupled from wall-clock), so this instant is stable
across machines. Override with `SMOKE_VT_BUDGET_MS` when debugging.

## Prerequisites

- **A Chromium-family browser.** Auto-detected (Chrome / Chromium / Chrome Canary,
  plus Brave / Edge on macOS, plus `google-chrome`/`chromium` on `PATH`); or set
  `CHROME_BIN=/path/to/browser`. Software WebGL (SwiftShader) is enabled so the
  WebGL 3D sections (PointCloud / Mesh / Volume / Boxes) still mount a `<canvas>`
  headlessly on a GPU-less box.
- **A `dist/plot-inline` built from current source.** The gallery inlines that
  bundle, so a stale committed `dist/` renders stale behavior. Run
  `npm run build:plot-inline` first if the renderers changed. (The harness will,
  correctly, go red if the committed bundle predates a renderer fix.)

## Not yet wired into CI

`ci.yml`'s `ui` job runs `npm run build` + typecheck but not `build:plot-inline`
or `smoke:plot`, and GitHub's ubuntu runners have no browser. Making this a CI
gate is a follow-up: add a job that installs Chrome, runs `npm run build:plot-inline`,
then `npm run smoke:plot`.
