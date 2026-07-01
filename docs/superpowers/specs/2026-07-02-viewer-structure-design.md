# Viewer Structural Refactor — Design

**Date:** 2026-07-02
**Scope:** `cairn/ui/src` (~21.5k lines). Behavior-preserving restructure of the viewer.
**Approved:** all six phases, executed sequentially, each phase verified (build + browser) before the next.

## Background

The UI grew through in-the-moment decisions. A recent extraction moved rendering into
`lib/cairn-plot/` (cards own data + settings; library owns rendering + interaction), but three
layers never got the same treatment. A four-way audit (cards, cairn-plot, pages/data layer,
cross-cutting contracts) produced the findings below; all file:line references were verified
against HEAD at audit time.

### Diagnosis

1. **Card data plumbing copy-pasted, not extracted** (~1,200 duplicated lines in
   `components/*Card.tsx`):
   - Controlled-vs-persisted series merge duplicated 5–6× *with accidental drift*
     (ScalarPlotCard.tsx:145-243, ImageGalleryCard.tsx:518-582, FigureInteractiveCard.tsx:370-432,
     AudioPlayerCard.tsx:183-244, VideoPlayerCard.tsx:143-204). Scalar keeps persisted extras in
     controlled mode; the others drop them; PluginCard declares `controlledSeries` and ignores it.
   - Global-step machinery (multiQueries → step union → idx/currentStep → slider handler)
     duplicated 5× (FigureInteractiveCard.tsx:450-491, AudioPlayerCard.tsx:262-305,
     VideoPlayerCard.tsx:222-250, PluginCard.tsx:344-369, ImageGalleryCard.tsx:599-624), plus
     per-pane closest-step-≤ search re-implemented in FigurePane/AudioPane/VideoPane/PluginPane.
   - Run-meta queries + `runInfoMap` + RunSelectionPanel wiring duplicated 7×, and the selection
     panel is rendered twice per card (body + modal).
   - Multi-pane layout (modal→SplitPane / card→grid + run-label badge) duplicated 4×
     (Figure/Audio/Video/Plugin).
   - Base settings fields (`title/collapsed/height/height1/height2/colSpan/sliderStep/xAxis/...`)
     re-declared in all 11 card settings interfaces; no shared base type.

2. **Two card contracts.** Nine cards take `{runId, metric, extraSeries?, controlledSeries?,
   settingsKeyOverride?, onRemove?}`; ParallelCoordsCard/ScatterPlotCard take
   `{runIds, runs?, settingsKey}` (ParallelCoordsCard.tsx:51-56). CardRenderer cannot render them,
   ComparePage special-cases them (ComparePage.tsx:928-948), and AddCardModal fabricates fake
   `object_type: "parallel"/"scatter"` entries (AddCardModal.tsx:121-134). ImageGalleryCard
   bypasses CardShell entirely (ImageGalleryCard.tsx:1072-1090) and contains OverlayComparePane
   (:281-509), a ~230-line fork of the library's ImagePane.

3. **Invisible couplings.**
   - Settings auto-open: `document.querySelectorAll(".grid.grid-cols-1")` → last grid, last child →
     find button whose `textContent.includes("⚙")` → `.click()` after `setTimeout(400)`
     (ComparePage.tsx:155-176).
   - Resize/reorder anchors on Tailwind presentation classes `.card`/`.grid`
     (CardResizeHandle.tsx:58-107, ReorderableCardGrid.tsx:29); sibling row sync matches by
     `rowTop` pixel proximity <2px via `cairn:heightChange`/`cairn:colSpanChange` DOM events.
   - `lib/comparisons.ts` (556 lines) is a second persistence layer: localStorage as working copy,
     fire-and-forget server sync swallowing all failures (:468-486), custom EventTarget pubsub,
     dual `id`/`serverId` merge; it re-hardcodes the card-settings storage key format (:533-535).
   - Module-global run-label cache seeded by whichever page mounts first (run-label.ts:16-19;
     seeding via `useMemo` side effect at ComparePage.tsx:55-57, RunsTablePage.tsx:218).
   - localStorage: `version` field written but never checked (card-settings.ts:23-31); several key
     schemes duplicated across files; no GC.

4. **Concrete defects.**
   - StepSlider rules-of-hooks violation: early `return null` at StepSlider.tsx:57 precedes a
     `useMemo` — latent crash when point count crosses 1→2 on a live run.
   - `"runs-infinite"` query-key literal in 10 places (hooks.ts:31,121, RunsTablePage.tsx ×7,
     BulkTagEditor.tsx ×2) violating query-keys.ts's own contract; RunsTablePage tag mutation
     invalidates only `["runs-infinite"]` → stale tags on run-detail page.
   - `useSequences`/`useSequence` poll at 2s and `useLogs` at 3s unconditionally, even for
     finished runs (hooks.ts:61,73,91), multiplied by per-card `useQueries` fan-out.
   - **Dead code:** `pages/ProjectPage.tsx` (481) + `components/RunRail.tsx` (101) +
     `lib/workspace-visibility.ts` (84) — not routed, imported nowhere (verified). Also
     `webglComputeDiff` (webgl-diff.ts:210-286), `computeDataExtent` (domain.ts:7), duplicate
     `viridis` in colors.ts, unused exported types (`HoverEvent`, `ClickEvent`,
     `ImageViewportState`, `CompareMode`), `extraContexts` prop threaded through 4 cards but never
     passed, `resetSettings` unused in 6 cards, misc unused imports/vars.

5. **cairn-plot API inconsistencies.** Boundary direction is clean (no imports from api/ or
   components/), but: three prop dialects across renderers — `onViewportChange` has two
   incompatible shapes (ScalarPlot full-replace `Viewport` vs ImagePane patch `{zoom?, pan?}`);
   needed types unexported, forcing cards to re-declare them (ScalarPlotCard.tsx:48-53,
   ImageGalleryCard.tsx:58-59); ScalarPlot.tsx (831 lines) does ≥6 jobs with hardcoded geometry
   margins (`46/20/50/28` at :218-221,:290-293) that must stay in sync with Recharts instead of
   trusting its own `plotOffsetRef`; ScalarPlot hardcodes light-theme hexes while other renderers
   use theme tokens; two ad-hoc image caches with copy-pasted eviction; palette defined on both
   sides of the boundary (colors.ts `SERIES_COLORS` ≡ ScatterPlot `DEFAULT_COLORS`).

## Constraints

- **Behavior-preserving.** The UI looks and behaves identically after each phase. Deliberate
  unifications (all cards adopting Scalar's series-merge semantics; step-slider persistence
  unified) are the only intended behavior deltas and must be called out in commit messages.
- **Rendering components stay self-contained** (resize/zoom/pan handled internally — durable
  project rule).
- **`cairn/ui/dist/` is always committed**; the pre-commit hook rebuilds it when `cairn/ui/src/`
  changes are staged.
- The imperative DOM path for resize/drag is *kept* (60fps without re-render is a valid reason);
  only its anchors change from presentation classes to dedicated `data-cairn-*` attributes.
- **Deferred (out of scope):** making the server canonical for comparisons persistence — a real
  behavior change with migration questions. Phase 5 only decomposes `comparisons.ts`.

## Design — target structure

### New shared card-plumbing modules (Phase 2)

```
components/card-kit/            # card-side plumbing (not rendering — that's cairn-plot)
  use-card-series.ts            # canonical controlled/persisted/extra series merge
                                # → { effectiveMetrics, defaults, allRunIds, multipleRuns, dropProps }
  use-step-slider.ts            # step union + index state + slider handler
                                # → { stepPoints, safeIdx, currentStep, onSliderChange }
  resolve-at-step.ts            # closest-step-≤ lookup shared by cards and panes
  use-run-info.ts               # run queries + runInfoMap for selection panels
  MultiPaneGrid.tsx             # modal→SplitPane / card→grid + label badge, pane render prop
  base-settings.ts              # BaseCardSettings interface; card settings extend it
```

`useCardSeries` adopts **ScalarPlotCard's semantics** as canonical (sorts metrics, keeps persisted
extras in controlled mode). CardShell gains `settingsPanel` / `selectionPanel` slots so the
CardDetailModal + RunSelectionPanel boilerplate collapses out of all 11 call sites.

### One card contract (Phase 3)

All cards take a single discriminated Props shape rendered by CardRenderer:

```ts
interface CardProps {
  source:
    | { kind: "series"; runId: string; metric: MetricRef; extraSeries?: SeriesRef[];
        controlledSeries?: SeriesRef[] }
    | { kind: "multi-run"; runIds: string[] };
  settingsKey: string;          // always explicit; today's settingsKeyOverride/settingsKey merge
  onRemove?: () => void;
}
```

Concretely: ParallelCoords/Scatter register in CardRenderer's switch under real object types;
AddCardModal stops fabricating pseudo `object_type`s; ComparePage's special cases go away.
ImageGalleryCard is ported onto CardShell (single shell implementation).

### cairn-plot consolidation (Phase 4)

- `hooks/use-image-viewport.ts`: modifier-key + wheel-zoom-to-cursor + pointer-pan extracted from
  ImagePane; ImagePane and the new compare pane both use it (and `useModifierKey`).
- OverlayComparePane moves into the library as `renderers/CompareImagePane.tsx` (split/blend of
  two images), using the existing `CompareMode` type. ImageGalleryCard imports it.
- ScalarPlot.tsx splits: `ScalarPlot.tsx` (Recharts bridge + domain resolution),
  `scalar-legend.tsx`, `scalar-tooltip.tsx`, `use-plot-gestures.ts` (wheel/pan/box-select state
  machine). All geometry reads go through the measured plot rect (`plotOffsetRef`), replacing the
  hardcoded margins.
- API unification: `onViewportChange` takes the full-replace shape everywhere; ImagePane's
  patch-style callback is renamed/adapted. Export `PromotedSeriesConfig`, `AxisScale`,
  `Interpolation`, `Colormap` from the barrel; delete cards' local re-declarations. One palette
  exported by the library; `lib/colors.ts` re-exports it. ScalarPlot uses theme tokens. Merge the
  two image caches into `image/cache.ts`. Trim the barrel to the consumed surface.

### Explicit contracts (Phase 5)

- Settings auto-open: `CardRenderer`/card grid accepts `autoFocusCardId`; CardHeader opens its own
  settings via prop. Delete both DOM-query hacks.
- `data-cairn-card` / `data-cairn-grid` attributes replace `.card`/`.grid` structural selectors in
  CardResizeHandle, ReorderableCardGrid, ComparePage scroll logic. Row identity for sibling resize
  sync via data attribute rather than rowTop pixel matching where feasible; DOM event bus stays.
- `lib/storage.ts`: key registry (all `cairn:*` keys defined in one place), shared
  `loadJson/saveJson` with try/catch, version checking, and per-run GC helper. card-settings,
  collapsed-sections, run-layout, comparisons migrate onto it. `comparisons.ts` imports the
  card-settings key builder instead of re-interpolating it.
- `comparisons.ts` → `lib/comparisons/` package: `store.ts` (CRUD via one
  `updateComparison(projectId, id, fn)` helper), `templates.ts`, `sync.ts`, `events.ts`.
  `compareRunId(cmpId)` helper owns the `compare:` pseudo-runId namespace (3 files currently
  hand-format it).
- Run-label cache seeded centrally (subscription in the api layer where runs land), not by page
  `useMemo` side effects.
- Plugin iframe postMessage protocol gains a `protocolVersion` field (additive, backward
  compatible).

## Phases (execution order)

Each phase = one or more commits, `npx vite build` green, browser smoke-check against example
data, then proceed. Every phase leaves the codebase strictly better; stopping after any phase is
safe.

| Phase | Content | Risk |
|---|---|---|
| 0 | Delete dead ProjectPage cluster; dead-code batch in cards + cairn-plot; StepSlider hooks fix | trivial |
| 1 | `qk.runsInfinite()` + invalidation fixes; bulk mutations → api/hooks.ts; status-gated polling; `useSequencesForRuns`/`useRunsDetails` | low |
| 2 | card-kit extraction (series/step/run-info/base-settings/MultiPaneGrid); CardShell slots | medium — behavior unification is deliberate |
| 3 | Single CardProps contract; Parallel/Scatter into CardRenderer; ImageGalleryCard onto CardShell | medium |
| 4 | CompareImagePane into library; ScalarPlot split + measured geometry; API/palette/theme unification; cache merge | medium-high (interaction regressions) |
| 5 | Auto-open via props; data-cairn-* anchors; storage.ts registry; comparisons/ decomposition; run-label seeding; plugin protocol version | medium |

## Verification protocol (per phase)

1. `cd cairn/ui && npx vite build` — must pass (pre-commit hook enforces + stages dist).
2. `npx tsc --noEmit` if configured, else build output serves as type check.
3. Browser (Chrome MCP) against a seeded example repo (`examples/demo_training.py` +
   `examples/demo_image_comparison.py` into a temp `.cairn`, served by `cairn ui`):
   - runs table loads, filters/sort work, tags editable;
   - run detail → metrics tab: scalar cards render, zoom/pan/box-select, series chips drag,
     resize handle (height + colSpan), step slider on media cards;
   - image gallery: diff modes, split/blend overlay, zoom/pan, false color;
   - compare page: create comparison, cards render incl. parallel-coords + scatter, add-card
     modal, settings auto-open on newly added card;
   - no console errors.
4. Phase-specific checks called out in the implementation plan.
