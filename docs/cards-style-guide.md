# Cairn Card Implementation Style Guide

Binding conventions for every new card type. Read this fully before writing code; the
per-feature spec (`docs/superpowers/specs/2026-07-02-new-card-types.md`) references it.
When this guide and existing code disagree, follow the newest existing code (the viewer
was structurally refactored in July 2026 — `card-kit/`, `CardDescriptor`, CardShell slots
are the current idioms; anything predating them is not a pattern to copy).

## 1. Data model

- One `object_type` string per loggable type: lowercase, singular, no punctuation
  (`table`, `html`, `markdown`, `pointcloud`). It is an opaque string to the server.
- Blob size cap 10MB (`TensorHandler` shows the pattern). Anything bigger must downsample
  at log time and record that in metadata.
- Metadata must carry whatever the card needs for its header/subtitle WITHOUT fetching the
  blob (counts, dims, dtype, duration…), mirroring `AudioHandler` (peaks/duration) and
  `ImageHandler` (thumbnail).

## 2. SDK (Python) conventions

- Wrapper class in `cairn/sdk/wrappers.py` (read `Histogram`/`Tensor` there first), exported
  from `cairn/__init__.py`.
- Handler in its own file `cairn/sdk/handlers/<type>.py` implementing the `TypeHandler`
  protocol (`registry.py`); registered in `handlers/__init__.py`. Registration is LIFO —
  later registration wins `can_handle` dispatch. Wrapper-only types (like Histogram/Tensor)
  dispatch on the wrapper class, never on raw values; do NOT add auto-dispatch on `dict`/
  `list`/`str` — those are taken.
- Optional dependencies go through `handlers/_optional.py` (read it); `can_handle` must
  return False when the optional dep is missing, never raise at import time.
- Every SDK change ships a pytest under `tests/unit/` mirroring the existing handler tests
  (find them with `grep -rl Handler tests/unit/`). Run `uv run pytest tests/unit -k <type>`.

## 3. UI conventions

**Card component** (`cairn/ui/src/components/<Type>Card.tsx`):
- Props: the series-card contract — `{ runId, metric: SequenceMeta, extraSeries?,
  controlledSeries?, settingsKeyOverride?, onRemove?, autoOpenSettings? }`. Workspace-level
  (multi-run) cards instead extend the `CardDescriptor` `kind: "multi-run"` union in
  `CardRenderer.tsx` — read how `parallel`/`scatter` are wired end to end (CardRenderer →
  ComparePage descriptor → AddCardModal `AddCardSelection`) and mirror it exactly.
- Settings: one interface extending `BaseCardSettings` (card-kit) with `version: 1`;
  persistence ONLY through `useCardSeries`'s owned settings (series cards) or
  `useCardSettings` (multi-run cards). Never build storage keys by hand — key shapes are
  frozen; new non-card keys go through `lib/storage.ts`'s registry.
- Plumbing hooks — use, don't reimplement: `useCardSeries` (series merge + settings),
  `useStepSlider` + `resolveAtStep` (stepped media), `useRunInfo` (labels for selection
  panels), `MultiPaneGrid` (multi-run pane layout for per-run media), `useSequencesForRuns`
  (fan-out fetches). Read one existing consumer of each before use (AudioPlayerCard is the
  smallest full example).
- Chrome: render through `CardShell` with `settingsPanel`/`modalContent`/`selectionPanel`
  slots, `headerActions` for inline controls, `dropProps` from `useSeriesDrop` if the card
  accepts series drops. Never hand-roll the card wrapper div.
- Heavy cards are lazy: `const XCard = lazy(() => import("./XCard"))` in CardRenderer with
  the existing Suspense fallback pattern (see `figure`/`plugin` cases).
- Run labels: always via `shortRunLabel`/`seriesLabel` + subscribe `useRunMetadataVersion()`
  and include it in the deps of any memo that computes labels.

**Renderers** (pure view components) go in `cairn/ui/src/lib/cairn-plot/renderers/`:
- Props-only API; NEVER import from `src/api/` or `src/components/` (library boundary).
- Self-contained interaction: the renderer owns its resize (use `useContainerSize`), zoom,
  and pan; no external hooks may be required to make it behave (hard project rule).
- Colors: `SERIES_COLORS` and colormap LUTs from cairn-plot; UI chrome colors via Tailwind
  theme tokens (`text-fg-muted`, `bg-bg-elevated`, `border-border`, `text-accent`) — no
  hardcoded hex. Identifiers/values render in the `mono` class.
- Export from `renderers/index.ts` + main barrel ONLY what cards consume.

**Registration checklist** (every new type):
1. `CardRenderer.tsx` switch case (lazy if heavy).
2. `AddCardModal.tsx`: add to `TYPE_ORDER` + `TYPE_LABELS` (series types) or the
   `AddCardSelection` union path (multi-run types).
3. If the type can appear in comparisons, verify it renders through ComparePage's
   CardRenderer path with `controlledSeries`.

## 4. Dependencies

Pre-approved additions — nothing else without an explicit spec note:
- `three` (pointcloud workstream only).
- `react-markdown` + `remark-gfm` (markdown workstream only).
Hand-roll everything else (tables, histograms, overlays are all in reach of SVG/canvas +
existing cairn-plot utilities). No d3, no ag-grid, no chart libs beyond the existing
recharts/plotly.

## 5. Worktree + verification protocol (every workstream)

You work in an isolated git worktree of `/Users/doeringc/workspace/cairn` on your own
branch. Do not delete the worktree or switch branches.

1. Setup once: `ln -s /Users/doeringc/workspace/cairn/cairn/ui/node_modules <your-worktree>/cairn/ui/node_modules`
   (the pre-commit hook builds the UI and needs it).
2. Demo data: create `examples/demo_<feature>.py` (your own file — never edit a shared
   example) that logs enough variants of your type to exercise every card feature.
3. Local verification loop, all from your worktree:
   - `cd cairn/ui && npm run typecheck` → exit 0, and `npx vite build` → green.
   - SDK: `uv run pytest tests/unit -k <type>` → green.
   - Seed + serve on YOUR assigned port only:
     `uv run cairn init /tmp/cairn-<feature> && CAIRN_REPO=/tmp/cairn-<feature>/.cairn uv run python examples/demo_<feature>.py`
     then `uv run cairn ui --repo /tmp/cairn-<feature>/.cairn --port <your-port>` and
     verify via `curl` that the run + sequences exist and artifacts download. (Note:
     `cairn ui` ignores the CAIRN_REPO env var — always pass `--repo`. It also caches
     index.html at startup — restart it after each dist rebuild.)
   - Browser-level verification happens at merge time by a separate agent — make your demo
     self-explanatory (the merge agent follows your report's test script).
4. Commit normally (the pre-commit hook rebuilds+stages dist; NEVER `--no-verify`). Commit
   messages: imperative subject, body explaining behavior, final line
   `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
5. Keep shared-file edits minimal and appendive (one switch case, one TYPE_ORDER entry, one
   registry line) — seven branches merge after you; every extra shared-file line is a
   conflict someone else must resolve.

## 6. Scope discipline

Implement exactly your spec section. If you discover a bug outside your scope, report it in
your final message; do not fix it. If a spec decision proves unworkable, STOP and report
the conflict rather than inventing a divergent design.
