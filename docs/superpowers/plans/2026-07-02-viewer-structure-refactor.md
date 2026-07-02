# Viewer Structural Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behavior-preserving restructure of `cairn/ui/src` per the approved spec at `docs/superpowers/specs/2026-07-02-viewer-structure-design.md`: delete dead code, extract duplicated card data plumbing into `components/card-kit/`, unify the card contract, consolidate cairn-plot, and replace invisible DOM/string couplings with explicit contracts.

**Architecture:** Cards own data + settings; `lib/cairn-plot/` owns rendering + interaction; new `components/card-kit/` owns card-side plumbing (series merge, step machinery, run info, base settings, multi-pane layout). Six sequential phases, each independently shippable.

**Tech Stack:** React 18, TypeScript 5.6, Vite 5, TanStack Query 5, Recharts 2, Tailwind 3. **No unit-test framework exists** — verification is `npm run typecheck`, `npm run build`, and browser smoke checks (orchestrator runs the browser checks at phase checkpoints).

## Global Constraints

- All commands run from `/Users/doeringc/workspace/cairn/cairn/ui` unless stated otherwise; git commands from the repo root `/Users/doeringc/workspace/cairn`.
- **Behavior-preserving.** UI looks/behaves identically. The only sanctioned behavior deltas: (a) all cards adopt ScalarPlotCard's controlled-series merge semantics, (b) step-slider persistence unified, (c) polling stops for finished runs. Name these in commit messages when they apply.
- **Never change persisted localStorage key formats or stored value shapes** (`cairn:card-settings:*`, `cairn:comparisons:*`, `cairn:run-layout:*`, `cairn:collapsed-sections:*`, …). Existing user data must keep loading.
- The imperative DOM path in resize/drag/reorder is kept (60fps requirement); only its anchors change (Task 22).
- Rendering components stay self-contained (handle their own resize/zoom/pan internally).
- `cairn/ui/dist/` is rebuilt+staged by the repo's pre-commit hook when `cairn/ui/src/` files are staged — do not hand-edit dist; just commit normally and let the hook run. If the hook fails, fix the build, never `--no-verify`.
- Verification per task: `npm run typecheck` must pass. Per phase: `npm run build` must pass + orchestrator browser checkpoint.
- Do not fix unrelated problems you notice; report them in your final message instead.
- Existing shared types you will reuse (do not redefine): `SequenceMeta` (`src/api/types.ts`), `ComparisonSeriesRef` (`src/lib/comparisons.ts`), `CardSettingsKey` + `useCardSettings` + `resolveCardHeight` (`src/lib/card-settings.ts`), `seriesKey`/`seriesLabel` (`src/lib/series-utils.ts`), `qk` (`src/api/query-keys.ts`), `api` (`src/api/client.ts`).

---

# Phase 0 — Deletions & trivial fixes

### Task 1: Delete the dead ProjectPage cluster

**Files:**
- Delete: `src/pages/ProjectPage.tsx`, `src/components/RunRail.tsx`, `src/lib/workspace-visibility.ts`

**Interfaces:** none (dead code — verified: no route in `main.tsx`, zero imports outside the cluster).

- [ ] **Step 1: Re-verify deadness** — `grep -rn "ProjectPage\|RunRail\|workspace-visibility" src/ --include='*.ts*' | grep -v 'pages/ProjectPage\|components/RunRail\|lib/workspace-visibility'` must return nothing.
- [ ] **Step 2: Delete the three files.**
- [ ] **Step 3: Verify** — `npm run typecheck` passes.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "Delete dead ProjectPage cluster (unrouted since grid refactor)"`

### Task 2: Fix StepSlider rules-of-hooks violation

**Files:**
- Modify: `src/components/StepSlider.tsx` (early `return null` at ~line 57 precedes a `useMemo` at ~line 62)

- [ ] **Step 1:** Move all hook calls above the `points.length < 2 → return null` early return, so hook order is render-invariant. Do not change rendering output.
- [ ] **Step 2:** `npm run typecheck` passes.
- [ ] **Step 3: Commit** — `"Fix StepSlider conditional hook call"`

### Task 3: Dead-code batch — card components

**Files:**
- Modify: `src/components/ScalarPlotCard.tsx`, `ImageGalleryCard.tsx`, `FigureInteractiveCard.tsx`, `AudioPlayerCard.tsx`, `VideoPlayerCard.tsx`, `ParallelCoordsCard.tsx`, `ScatterPlotCard.tsx`, `CardHeader.tsx`, `CardGrid.tsx`, `CardRenderer.tsx`

Delete only what is verifiably unused (grep before each deletion):

- [ ] **Step 1:** Remove the `extraContexts` prop end-to-end: it is declared/threaded in ScalarPlotCard (:124,134,145-149,163-166,219-222 and its `extraContextsKey` memo) and the equivalent blocks in ImageGallery/Figure/Audio/Video cards, but **no caller in src/ ever passes it** (verify: `grep -rn "extraContexts" src/ | grep -v "Card.tsx"` → nothing). Remove prop, destructure, key-memo, and merge references.
- [ ] **Step 2:** Remove unused locals per file (verify each with grep first): `defaultsEqual` (ScalarPlotCard.tsx:107), unused `resetSettings` third-tuple destructures (6 cards — keep the two-element destructure), `settingsRef` assigned-never-read (AudioPlayerCard.tsx:~246, VideoPlayerCard.tsx:~206), unused imports (`SERIES_COLORS`, `XAxisMode`, `useCallback` in Audio/Video), `runs?: Run[]` prop in ParallelCoordsCard/ScatterPlotCard (callers pass it — remove from callers too: ComparePage), CardHeader deprecated `children` slot (CardHeader.tsx:16, no consumer), CardGrid leftover empty section-comment blocks (CardGrid.tsx:204-210).
- [ ] **Step 3:** `npm run typecheck` && `npm run build` pass.
- [ ] **Step 4: Commit** — `"Remove dead props and locals from card components"`

### Task 4: Dead-code batch — cairn-plot + colors

**Files:**
- Modify: `src/lib/cairn-plot/image/webgl-diff.ts`, `src/lib/cairn-plot/transforms/domain.ts`, `src/lib/cairn-plot/types.ts`, `src/lib/cairn-plot/index.ts`, `src/lib/cairn-plot/renderers/ImagePane.tsx`, `src/lib/colors.ts`

- [ ] **Step 1:** Delete `webglComputeDiff` (webgl-diff.ts:210-286, zero callers) and its barrel export. Keep `webglRenderDiffToCanvas`.
- [ ] **Step 2:** Delete `computeDataExtent` (domain.ts, zero callers) and its export.
- [ ] **Step 3:** In types.ts delete unused exported types `HoverEvent`, `ClickEvent`, `ImageViewportState`. **Keep `CompareMode`** (used by Task 18).
- [ ] **Step 4:** In `src/lib/colors.ts` delete the local `viridis` copy and re-export from the library instead: `export { viridis } from "./cairn-plot";` (verify the barrel exports it; nothing imports colors.ts's own copy).
- [ ] **Step 5:** Remove vestigial `data-cairn-zoom-pane` / `data-cairn-img-wrapper` attributes (ImagePane.tsx:450,464 — zero consumers).
- [ ] **Step 6:** `npm run typecheck` && `npm run build`; commit `"Prune dead code from cairn-plot and colors"`

> **Phase 0 checkpoint (orchestrator):** browser smoke — runs table, run detail metrics tab, image card, compare page all render; step slider works on a media card with 1 point and >1 points.

---

# Phase 1 — Data-layer hygiene

### Task 5: Query-key registry compliance + tag-invalidation fix

**Files:**
- Modify: `src/api/query-keys.ts`, `src/api/hooks.ts`, `src/pages/RunsTablePage.tsx`, `src/components/BulkTagEditor.tsx`

**Interfaces:**
- Produces: `qk.runsInfinite(projectId: string)` → `["runs-infinite", projectId] as const` (match the exact existing literal array shape used at hooks.ts:31 — read it first and mirror it).

- [ ] **Step 1:** Add `runsInfinite` to `query-keys.ts` mirroring the existing literal's exact shape.
- [ ] **Step 2:** Replace every `"runs-infinite"` literal (hooks.ts:31,121; RunsTablePage.tsx:142,153,160,166,172,193,214; BulkTagEditor.tsx:66,84) with the builder.
- [ ] **Step 3:** RunsTablePage's inline tag add/remove (:138-154) currently calls `api.setTags` + invalidates only runs-infinite → stale run-detail tags. Replace with the existing `useSetTags` hook (hooks.ts:114-121) which also invalidates `qk.run(runId)` and `["runs"]`.
- [ ] **Step 4:** `npm run typecheck`; commit `"Route runs-infinite query key through qk registry; fix tag invalidation breadth"`

### Task 6: Bulk mutations move into api/hooks.ts

**Files:**
- Modify: `src/api/hooks.ts`, `src/pages/RunsTablePage.tsx` (:156-215 — bulk delete / archive / unarchive / export as `Promise.all(api.*)` + manual invalidation)

**Interfaces:**
- Produces (in hooks.ts): `useBulkRunMutation()` → `{ bulkDelete(runIds: string[]): Promise<void>, bulkArchive(runIds: string[], archived: boolean): Promise<void> }`, each performing the same `Promise.all` the page does today, then invalidating `qk.runsInfinite(projectId)`, `["runs"]`, and `qk.run(rid)` for each affected run. Read RunsTablePage.tsx:156-215 first and preserve its exact api calls and post-conditions (including the export path, which downloads files — that one may stay in the page if it has no cache effect; move only mutations that invalidate).

- [ ] **Step 1:** Implement the hook in hooks.ts (mirror current behavior; broaden invalidation as described).
- [ ] **Step 2:** Replace the page's inline implementations; delete its manual `queryClient.invalidateQueries` calls.
- [ ] **Step 3:** `npm run typecheck`; commit `"Move bulk run mutations into api/hooks"`

### Task 7: Status-gated polling

**Files:**
- Modify: `src/api/hooks.ts` (`useSequences` :~61, `useSequence` :~73, `useLogs` :~91)

Sequences/logs currently poll unconditionally (2s/3s) forever. `useRun` (hooks.ts:18-24) already gates on `data.run.status`. Apply the same pattern:

- [ ] **Step 1:** In each of the three hooks, add an internal `useQuery({ queryKey: qk.run(runId), queryFn: () => api.run(runId), staleTime: 5_000 })` (cheap — deduped with the run queries cards/pages already make) and derive `const live = runQ.data ? runQ.data.run.status === "running" : true;` (unknown status ⇒ keep polling, preserves behavior while run loads). Read `useRun`'s exact status check first and reuse its predicate — if it checks more states than `"running"` (e.g. `"queued"`), match it.
- [ ] **Step 2:** Set `refetchInterval: live ? <current value> : false` in each hook.
- [ ] **Step 3:** `npm run typecheck`; commit `"Stop polling sequences/logs for finished runs"` (sanctioned behavior delta c).

### Task 8: Shared multi-run fetch hooks; migrate page-level call sites

**Files:**
- Modify: `src/api/hooks.ts`, `src/pages/ComparisonOverviewTab.tsx` (:17,40-61), `src/pages/ComparisonSourceTab.tsx` (:33,41,84,92), `src/pages/RunSourceTab.tsx` (:15)

**Interfaces:**
- Produces (hooks.ts):
  - `useRunsDetails(runIds: string[])` → `UseQueryResult<RunDetail>[]` via `useQueries` over `qk.run(rid)` / `api.run(rid)`, `staleTime: 5_000`.
  - `useSequencesForRuns(specs: Array<{ runId: string; name: string; contextHash: string; maxPoints?: number }>)` → `useQueries` over `qk.sequence(...)` / `api.sequence(...)` with the Task-7 status-gated `refetchInterval` (gate per spec's runId; a single internal runs-details lookup for the distinct runIds is fine).

- [ ] **Step 1:** Implement both hooks (read the exact option shapes at ComparisonOverviewTab.tsx:17 and ScalarPlotCard.tsx:276-289 to match `queryKey`/`queryFn`/options faithfully).
- [ ] **Step 2:** Migrate the three pages' hand-rolled `useQueries` to these hooks. **Do not migrate card components in this task** — Phase 2 does that.
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; commit `"Add shared multi-run fetch hooks; adopt in comparison/source tabs"`

> **Phase 1 checkpoint (orchestrator):** browser — tag edit from runs table appears on run detail without reload; finished runs generate no recurring /api/sequence requests (network tab); comparison overview/source tabs render.

---

# Phase 2 — card-kit extraction

New directory `src/components/card-kit/` with barrel `index.ts`. All hooks live here (card-side plumbing — distinct from `lib/cairn-plot` rendering).

### Task 9: BaseCardSettings

**Files:**
- Create: `src/components/card-kit/base-settings.ts`, `src/components/card-kit/index.ts`
- Modify: the 11 card settings interfaces (Scalar :55-81, Image, Figure, Audio, Video, Plugin, Parallel, Scatter, Histogram :~28-37, Text, Artifact) + `src/components/CardShell.tsx:8-16` (structural re-typing)

**Interfaces:**
- Produces:

```ts
// base-settings.ts
export interface BaseCardSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  height?: number;          // legacy — resolveCardHeight fallback
  height1?: number;         // legacy
  height2?: number;         // legacy
  heights?: Record<number, number>;
  colSpan?: number;
}
```

- [ ] **Step 1:** Create the interface exactly as above (it is the intersection of what the 11 interfaces re-declare — read 2-3 of them first to confirm no extra shared field like `sliderStep`; if `sliderStep`/`xAxis` appear in ≥5, still leave them per-card for now — Task 12 handles slider state).
- [ ] **Step 2:** Each card settings interface becomes `interface XSettings extends BaseCardSettings { ...card-specific fields }`, deleting the duplicated field declarations. No runtime change.
- [ ] **Step 3:** Change CardShell's structural settings type to accept `BaseCardSettings`.
- [ ] **Step 4:** `npm run typecheck`; commit `"Extract BaseCardSettings shared by all card settings interfaces"`

### Task 10: useCardSeries — canonical series merge (reference adoption: ScalarPlotCard)

**Files:**
- Create: `src/components/card-kit/use-card-series.ts`
- Modify: `src/components/ScalarPlotCard.tsx` (delete :145-243 equivalents post-Task-3), `src/components/card-kit/index.ts`

**Interfaces:**
- Produces:

```ts
// use-card-series.ts
import type { SequenceMeta } from "../../api/types";
import type { ComparisonSeriesRef } from "../../lib/comparisons";
import type { CardSettingsKey } from "../../lib/card-settings";

export interface SeriesRef { runId?: string; name: string; context_hash: string }

export interface CardSeriesResult {
  /** Series to render, canonical order (sorted by seriesKey). */
  effectiveMetrics: SeriesRef[];
  /** Defaults object fragment: `{ metrics: SeriesRef[] }` merged into card defaults. */
  defaultMetrics: SeriesRef[];
  /** Stable identity key for memo deps (sorted, joined). */
  seriesIdentityKey: string;
  /** Distinct run ids across effectiveMetrics (always includes runId). */
  allRunIds: string[];
  multipleRuns: boolean;
  /** Resolved settings key ({runId, metricName, contextHash} or the override). */
  settingsKey: CardSettingsKey;
}

export function useCardSeries(args: {
  runId: string;
  metric: SequenceMeta;
  extraSeries?: ComparisonSeriesRef[];
  controlledSeries?: boolean;
  settingsKeyOverride?: CardSettingsKey;
  /** The card's persisted settings.metrics (pass settings.metrics). */
  persistedMetrics: SeriesRef[];
}): CardSeriesResult;
```

**Canonical semantics (Scalar's — spec-sanctioned unification):** defaults = dedupe(seed ∪ extraSeries) sorted by `seriesKey`; effective (controlled) = props series first, then persisted metrics whose **name** is not among prop series names, deduped by `seriesKey`; effective (uncontrolled) = persistedMetrics as-is. Identity via the sorted-join string keys exactly as ScalarPlotCard.tsx:150-154 does (keep the `JSON.stringify` dep trick inside the hook where eslint-disable is centralized once).

- [ ] **Step 1:** Implement the hook by **moving** ScalarPlotCard.tsx's logic (post-Task-3 line numbers will have shifted — locate by content: `extraSeriesKey` memo, `defaults` memo, `settingsKey` memo, `effectiveMetrics` memo, `uniqueRunIds` memo).
- [ ] **Step 2:** ScalarPlotCard adopts it; the card keeps its metric-sorting `updateSettings` wrapper. Confirm rendered output identical (typecheck + visual).
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; commit `"Extract useCardSeries; adopt in ScalarPlotCard"`

### Task 11: Adopt useCardSeries in the other five series cards

**Files:**
- Modify: `src/components/ImageGalleryCard.tsx` (:518-582 region), `FigureInteractiveCard.tsx` (:370-432), `AudioPlayerCard.tsx` (:183-244), `VideoPlayerCard.tsx` (:143-204), `PluginCard.tsx` (declares `controlledSeries` at :28 but ignores it — after adoption it honors it; sanctioned unification)

**Interfaces:**
- Consumes: `useCardSeries` from Task 10 (signature above).

- [ ] **Step 1:** Per card: replace the local defaults/effectiveMetrics/extraSeriesKey/settingsKey blocks with the hook. Where a card's old merge dropped persisted extras in controlled mode, the hook now keeps them — this is the sanctioned unification (a); note it in the commit message.
- [ ] **Step 2:** `npm run typecheck` && `npm run build`; commit `"Adopt useCardSeries in image/figure/audio/video/plugin cards (unifies controlled-series semantics)"`

### Task 12: Step machinery — resolveAtStep + useStepSlider

**Files:**
- Create: `src/components/card-kit/resolve-at-step.ts`, `src/components/card-kit/use-step-slider.ts`
- Modify: `FigureInteractiveCard.tsx` (:450-491 + FigurePane :238-258), `AudioPlayerCard.tsx` (:262-305 + AudioPane :118-136), `VideoPlayerCard.tsx` (:222-250 + VideoPane :89-104), `PluginCard.tsx` (:344-369 + PluginPane :160-177), `ImageGalleryCard.tsx` (:599-624 variant)

**Interfaces:**
- Produces:

```ts
// resolve-at-step.ts — pure
export interface SteppedPoint { step: number; [k: string]: unknown }
/** Largest point with point.step <= step; null when none. */
export function resolveAtStep<T extends SteppedPoint>(points: T[], step: number): T | null;

// use-step-slider.ts
export interface StepSliderState {
  /** Sorted union of steps across all series' points. */
  globalSteps: number[];
  /** Clamped current index into globalSteps. */
  safeIdx: number;
  currentStep: number | undefined;
  /** Slider onChange handler: persists index via updateSettings({ sliderStep }). */
  onSliderChange: (idx: number) => void;
}
export function useStepSlider(args: {
  /** points per series, from the card's sequence queries */
  seriesPoints: Array<Array<{ step: number }>>;
  persistedIdx: number | undefined;          // settings.sliderStep
  updateSettings: (patch: { sliderStep?: number }) => void;
}): StepSliderState;
```

- [ ] **Step 1:** Implement both by moving FigureInteractiveCard's version (the most complete — read :450-491 first); keep persistence semantics identical (persisted value is the slider *index*, key `sliderStep` — do not rename, stored data must load).
- [ ] **Step 2:** Adopt in the five cards; panes replace their local closest-step-≤ searches with `resolveAtStep`.
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; commit `"Extract step-slider machinery into card-kit"`

### Task 13: useRunInfo + CardShell settings/selection slots

**Files:**
- Create: `src/components/card-kit/use-run-info.ts`
- Modify: `src/components/CardShell.tsx`, then adopt in `ScalarPlotCard`, `ImageGalleryCard` (skip shell part — still off-shell until Task 16; adopt only useRunInfo), `FigureInteractiveCard`, `AudioPlayerCard`, `VideoPlayerCard`, `ParallelCoordsCard`, `ScatterPlotCard`

**Interfaces:**
- Produces:

```ts
// use-run-info.ts
export interface RunInfo { id: string; label: string; color?: string; status?: string; createdAtMs?: number }
export function useRunInfo(runIds: string[]): {
  runInfoMap: Map<string, RunInfo>;
  runCreatedAtByRunId: Map<string, number>;
}
```

(Move ScalarPlotCard's run-meta block — `useQueries` over `qk.run` + `runCreatedAtByRunId` — and the `runInfoMap` construction other cards build; read AudioPlayerCard.tsx:329-347 + ScalarPlotCard run-meta section first and produce the superset both need.)

- CardShell gains two optional props: `settingsPanel?: ReactNode` and `selectionPanel?: ReactNode`. CardShell renders the CardDetailModal wiring (open state, settings side panel, selectionPanel below content) that each card currently duplicates — read CardShell.tsx and ScalarPlotCard's modal usage (:759-787) first; move the duplicated JSX, not reinvent it. The double-render of RunSelectionPanel (body + modal) is preserved as-is (same element passed to both places by CardShell).

- [ ] **Step 1:** Implement `useRunInfo`; adopt in the 7 cards (delete their local run-meta blocks).
- [ ] **Step 2:** Add CardShell slots; migrate the 6 on-shell cards' modal/selection boilerplate into them (ImageGalleryCard keeps its own until Task 16).
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; commit `"Extract useRunInfo and CardShell settings/selection slots"`

### Task 14: MultiPaneGrid

**Files:**
- Create: `src/components/card-kit/MultiPaneGrid.tsx`
- Modify: `FigureInteractiveCard.tsx` (:706-751), `AudioPlayerCard.tsx` (:403-441), `VideoPlayerCard.tsx` (:353-391), `PluginCard.tsx` (:441-453)

**Interfaces:**
- Produces:

```tsx
export function MultiPaneGrid(props: {
  paneKeys: string[];                       // one per series
  labels: Map<string, string>;              // run label badge per pane key
  inModal: boolean;                         // modal → SplitPane; card → grid repeat(min(n,2),1fr)
  renderPane: (key: string, index: number) => ReactNode;
}): JSX.Element;
```

- [ ] **Step 1:** Move the layout JSX from FigureInteractiveCard (richest version, read :706-751 first): modal path uses the existing `SplitPane` component, card path the `grid repeat(min(n,2),1fr)` + absolute run-label badge.
- [ ] **Step 2:** Adopt in the four cards.
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; commit `"Extract MultiPaneGrid for figure/audio/video/plugin cards"`

> **Phase 2 checkpoint (orchestrator):** full browser sweep — scalar zoom/pan/series chips; comparison cards with controlled series (add/remove series persists); step sliders on figure/audio/video; multi-pane modal split view; settings modals open from all cards. `git diff --stat` sanity: components/*Card.tsx should shrink by roughly 1,000+ lines total.

---

# Phase 3 — one card contract

### Task 15: CardRenderer renders all 11 cards; AddCardModal stops faking types

**Files:**
- Modify: `src/components/CardRenderer.tsx`, `src/components/AddCardModal.tsx` (:121-134), `src/pages/ComparePage.tsx` (:928-948 special-cases), `src/components/ParallelCoordsCard.tsx` (:51-56), `src/components/ScatterPlotCard.tsx`

**Interfaces:**
- Produces (CardRenderer.tsx):

```ts
export type CardDescriptor =
  | { kind: "series"; runId: string; metric: SequenceMeta;
      extraSeries?: ComparisonSeriesRef[]; controlledSeries?: boolean;
      settingsKeyOverride?: CardSettingsKey; onRemove?: () => void }
  | { kind: "multi-run"; cardType: "parallel" | "scatter"; runIds: string[];
      settingsKey: string;                      // preserve today's exact string format!
      onRemove?: () => void };

export default function CardRenderer(props: CardDescriptor): JSX.Element;
```

Migration rules: read ParallelCoordsCard.tsx:51-56 and every current `settingsKey` string construction (ComparePage :928-948) first — the strings written to localStorage must remain byte-identical. Keep a thin back-compat: existing call sites (CardGrid, ComparePage series cards) construct `{kind:"series", ...}` explicitly. AddCardModal's result type becomes a `CardDescriptor`-shaped choice instead of fake `object_type: "parallel"|"scatter"` SequenceMeta entries (:121-134); ComparePage maps modal results to descriptors and renders **everything** through CardRenderer, deleting its parallel/scatter special-case branches.

- [ ] **Step 1:** Introduce `CardDescriptor` + new CardRenderer switch (`kind` first, then `object_type`).
- [ ] **Step 2:** Update CardGrid + ComparePage call sites; delete ComparePage special cases; fix AddCardModal.
- [ ] **Step 3:** Manually verify in the running app (orchestrator will re-verify): existing persisted parallel/scatter card settings still load (settingsKey unchanged).
- [ ] **Step 4:** `npm run typecheck` && `npm run build`; commit `"Unify card contract: CardRenderer renders all card types incl. parallel/scatter"`

### Task 16: ImageGalleryCard onto CardShell

**Files:**
- Modify: `src/components/ImageGalleryCard.tsx` (shell bypass at :1072-1090 and :1463-1469 pre-shift), `src/components/CardShell.tsx` (only if a genuinely missing capability surfaces)

- [ ] **Step 1:** Read CardShell.tsx fully and the gallery's hand-rolled shell (outer div, drop-highlight class string, CardHeader + CardResizeHandle wiring). List capability gaps (e.g. custom header actions the shell lacks). Extend CardShell with the *minimal* generic prop(s) needed (e.g. `headerExtra?: ReactNode`) — no gallery-specific code in the shell.
- [ ] **Step 2:** Replace the hand-rolled shell with CardShell + Task-13 slots.
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; verify visually: resize handle, collapse, drag-reorder, settings modal on an image card.
- [ ] **Step 4: Commit** — `"Port ImageGalleryCard onto CardShell"`

> **Phase 3 checkpoint (orchestrator):** compare page: add parallel-coords, scatter, and a scalar card via AddCardModal; reload → settings persist; image card shell behaviors (resize/reorder/collapse) intact.

---

# Phase 4 — cairn-plot consolidation

### Task 17: use-image-viewport hook

**Files:**
- Create: `src/lib/cairn-plot/hooks/use-image-viewport.ts`
- Modify: `src/lib/cairn-plot/renderers/ImagePane.tsx` (:115-223 — inline modifier-key effect, wheel zoom-to-cursor, pointer-pan state machine), `src/lib/cairn-plot/hooks/index.ts`

**Interfaces:**
- Produces:

```ts
export function useImageViewport(args: {
  zoom: number;
  pan: { x: number; y: number };
  onViewportChange?: (v: { zoom: number; pan: { x: number; y: number } }) => void; // full-replace
  minZoom?: number;  // default 0.25
  maxZoom?: number;  // default 16
}): {
  containerProps: {
    onWheel: (e: React.WheelEvent) => void;
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    style: React.CSSProperties;  // cursor
  };
  modifierActive: boolean;       // from useModifierKey
}
```

- [ ] **Step 1:** Move ImagePane's inline logic into the hook; internally use the existing `useModifierKey` (hooks/use-modifier-key.ts) instead of the re-implemented effect. Note the full-replace callback shape — ImagePane's current patch-style `onViewportChange({zoom?, pan?})` call sites inside the pane adapt to full-replace *internally*; the pane's public prop stays patch-style until Task 20.
- [ ] **Step 2:** ImagePane adopts the hook; behavior identical (zoom-to-cursor math moved verbatim).
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; commit `"Extract useImageViewport; ImagePane adopts useModifierKey"`

### Task 18: CompareImagePane into the library

**Files:**
- Create: `src/lib/cairn-plot/renderers/CompareImagePane.tsx`
- Modify: `src/components/ImageGalleryCard.tsx` (OverlayComparePane ~:281-509 pre-shift — locate by name), `src/lib/cairn-plot/renderers/index.ts`, `src/lib/cairn-plot/index.ts`

**Interfaces:**
- Produces:

```tsx
import type { CompareMode } from "../types";  // "side-by-side" | "split" | "blend" — reuse, don't redefine
export interface CompareImagePaneProps {
  imageUrl: string | null;
  baselineUrl: string | null;
  mode: Exclude<CompareMode, "side-by-side">;   // split | blend
  splitPosition: number;                         // 0..1
  blendAlpha: number;                            // 0..1
  onSplitPositionChange?: (p: number) => void;
  zoom: number; pan: { x: number; y: number };
  onViewportChange?: (v: { zoom: number; pan: { x: number; y: number } }) => void;
  processing?: /* same shape ImagePane takes — import its type */;
  label?: string; isDraggable?: boolean; onDragStart?: (e: React.DragEvent) => void;
}
```

- [ ] **Step 1:** Move OverlayComparePane wholesale into the library, replacing its duplicated zoom/pan/modifier/gamma-filter blocks with `useImageViewport` + the shared gamma-filter helper from ImagePane (extract that filter into a small shared module in renderers/ if needed). The novel logic (stacked `<img>` + clipPath split, blend opacity, split-handle drag) moves as-is.
- [ ] **Step 2:** ImageGalleryCard imports `CompareImagePane` from the barrel; delete OverlayComparePane (~230 lines).
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; verify split + blend modes and label-chip drag in the browser.
- [ ] **Step 4: Commit** — `"Move overlay compare pane into cairn-plot as CompareImagePane"`

### Task 19: ScalarPlot split + measured geometry

**Files:**
- Create: `src/lib/cairn-plot/renderers/scalar/scalar-legend.tsx`, `.../scalar/scalar-tooltip.tsx`, `.../scalar/use-plot-gestures.ts`
- Modify: `src/lib/cairn-plot/renderers/ScalarPlot.tsx` (831 lines → Recharts bridge + domain resolution), `renderers/index.ts`

- [ ] **Step 1:** Move `CustomLegend` (:691-756) → `scalar-legend.tsx`, `CustomTooltip` (:768-831) → `scalar-tooltip.tsx` (exported for ScalarPlot only, not the public barrel).
- [ ] **Step 2:** Move the wheel-zoom / pan / box-select pointer state machine into `use-plot-gestures.ts` with signature `usePlotGestures(args: { svgRef; plotRect: () => DOMRect | null; viewport; onViewportChange; xScale; yScale })` — read the existing handlers first and keep the ref-based (no-re-render-per-frame) pattern.
- [ ] **Step 3:** Geometry: the `Customized` component already captures Recharts' plot rect into `plotOffsetRef` (:611-630). Make the wheel handler and pointer-down use it and **delete the hardcoded margin blocks** (`46/20/50/28` at :218-221 and :290-293). Guard: if `plotOffsetRef` is unset (first render), bail out of the gesture rather than guessing.
- [ ] **Step 4:** `npm run typecheck` && `npm run build`; browser: wheel zoom centers on cursor, box-select zooms to the drawn rect (this is the regression-prone step — check with a promoted right axis too, where the old margins were most wrong).
- [ ] **Step 5: Commit** — `"Split ScalarPlot; gestures use measured plot rect instead of hardcoded margins"`

### Task 20: cairn-plot API/palette/theme unification

**Files:**
- Modify: `src/lib/cairn-plot/types.ts`, `index.ts`, `renderers/ImagePane.tsx`, `renderers/ScalarPlot.tsx`, `image/cache.ts`, `image/diff.ts`, `src/lib/colors.ts`, `src/components/ScalarPlotCard.tsx` (:48-53 re-declarations), `src/components/ImageGalleryCard.tsx` (:58-59 re-declarations), `src/lib/cairn-plot/renderers/ScatterPlot.tsx` (:9-16 DEFAULT_COLORS)

- [ ] **Step 1:** `onViewportChange` unification: ImagePane's public prop becomes full-replace `{ zoom, pan }` (matching ScalarPlot's full-replace `Viewport` convention); update ImageGalleryCard call sites. Delete the patch-style shape.
- [ ] **Step 2:** Export from the barrel: `PromotedSeriesConfig` (move from ScalarPlot.tsx:29-32 into types.ts), `AxisScale`, `Interpolation`, `Colormap`. Delete the local re-declarations in ScalarPlotCard.tsx:48-53 and ImageGalleryCard.tsx:58-59; also unify duplicate `ImageProcessing`/`ImageProcessingProps` (types.ts:66 vs ImagePane.tsx:17) into one exported type.
- [ ] **Step 3:** Palette: single `SERIES_COLORS` exported from cairn-plot (colormaps/ or types); `lib/colors.ts` re-exports it; ScatterPlot's `DEFAULT_COLORS` uses it.
- [ ] **Step 4:** ScalarPlot theme: replace hardcoded hexes (`#d0d7de` :498, `#656d76` :505, `#f6f8fa` :550) with `currentColor`/CSS-variable-driven values consistent with how ScatterPlot/ParallelCoords use theme tokens — read those two first and copy their approach.
- [ ] **Step 5:** Merge `imageDataLoadCache` (diff.ts:67-68) into `image/cache.ts` (one FIFO module, two entry types or one generic).
- [ ] **Step 6:** Trim `index.ts` barrel to the surface consumed outside the library (grep each export; internals like `buildLUT`, `COLORMAP_STOPS`, `mergeToRows` become internal imports).
- [ ] **Step 7:** `npm run typecheck` && `npm run build`; commit `"Unify cairn-plot API surface, palette, theming; merge image caches"`

> **Phase 4 checkpoint (orchestrator):** deep image + scalar interaction sweep — diff modes with false color + colorbar, split/blend, zoom/pan in both pane types, scalar zoom/box-select/promoted axes, dark/light theme toggle if available.

---

# Phase 5 — explicit contracts

### Task 21: Settings auto-open via React

**Files:**
- Modify: `src/pages/ComparePage.tsx` (:155-176 DOM hack), `src/components/CardHeader.tsx`, `src/components/CardShell.tsx`, `src/components/CardRenderer.tsx`

**Interfaces:**
- Produces: `CardDescriptor` gains optional `autoOpenSettings?: boolean` (series+multi-run variants); CardShell effect: when true on mount, open the settings modal once and scroll the card into view (`cardRef.scrollIntoView({behavior:"smooth", block:"center"})`).

- [ ] **Step 1:** Implement prop-drilled auto-open (CardRenderer → card → CardShell); ComparePage sets it for the just-added card id and clears its "new card" state after mount.
- [ ] **Step 2:** Delete the `.grid.grid-cols-1` + `⚙` textContent + `setTimeout(400)` block.
- [ ] **Step 3:** `npm run typecheck`; browser: adding a card scrolls to it and opens settings; commit `"Replace DOM-query settings auto-open with autoOpenSettings prop"`

### Task 22: data-cairn-* structural anchors

**Files:**
- Modify: `src/components/CardShell.tsx` (emit `data-cairn-card` on the card root), `src/components/ReorderableCardGrid.tsx` (emit `data-cairn-grid` on the grid element; consume at :29), `src/components/CardResizeHandle.tsx` (:58-61,:66,:90,:104-107,:119 — replace `.closest(".card")`/`.closest(".grid")`/`.querySelectorAll(".card")` with the data-attribute selectors), `src/components/DraggableCard.tsx` (keep `.cairn-draggable-card` CSS contract as-is — it's documented and CSS-load-bearing)

- [ ] **Step 1:** Add the two data attributes at their single production sites.
- [ ] **Step 2:** Swap every structural selector: `[data-cairn-card]`, `[data-cairn-grid]` (keep the `display:contents` walk logic; it's about DOM shape, not classes). The `cairn:heightChange` rowTop-proximity sibling match stays (documented tradeoff) — but move the magic `<2` px literal into a named constant `ROW_TOP_EPSILON_PX`.
- [ ] **Step 3:** `npm run typecheck` && `npm run build`; browser: resize (height + colSpan snap + sibling row sync) and drag-reorder still work; commit `"Anchor resize/reorder on data-cairn-* attributes instead of presentation classes"`

### Task 23: storage.ts registry

**Files:**
- Create: `src/lib/storage.ts`
- Modify: `src/lib/card-settings.ts`, `src/lib/run-layout.ts`, `src/components/CardGrid.tsx` (:31 collapsed-sections key), `src/pages/ComparePage.tsx` (:686 duplicate collapsed-sections rebuild)

**Interfaces:**
- Produces:

```ts
// storage.ts — single home for every cairn:* web-storage key
export const storageKeys = {
  cardSettings: (runId: string, metricName: string, contextHash: string) =>
    `cairn:card-settings:${runId}:${metricName}:${contextHash}`,        // byte-identical to today
  runLayout: (runId: string) => `cairn:run-layout:${runId}`,
  collapsedSections: (scope: string) => `cairn:collapsed-sections:${scope}`,
  comparisons: (projectId: string) => `cairn:comparisons:${projectId}`,
  comparisonTemplates: (projectId: string) => `cairn:comparison-templates:${projectId}`,
  streamMode: "cairn:stream-mode",
  renderMode: "cairn:render-mode",
  scroll: (key: string) => `cairn:scroll:${key}`,               // sessionStorage
  lastComparison: (projectId: string) => `cairn:last-comparison:${projectId}`, // sessionStorage
} as const;

export function loadJson<T>(storage: Storage, key: string): T | null;   // try/catch JSON.parse
export function saveJson(storage: Storage, key: string, value: unknown): void; // try/catch
/** Remove per-run keys (card-settings/run-layout/collapsed-sections) for runs not in keepRunIds. */
export function gcRunScopedKeys(keepRunIds: Set<string>): void;
```

- [ ] **Step 1:** Implement; migrate `card-settings.ts`, `run-layout.ts`, CardGrid, ComparePage to the registry + `loadJson/saveJson` (formats unchanged — assert by comparing old/new key strings in a scratch check before committing). While in card-settings.ts, make `loadCardSettings` actually check the stored `version` field (mismatch or missing ⇒ return null, falling back to defaults — every historical write included `version: 1`, so this is a no-op for real data). `comparisons.ts` migrates in Task 24. Do **not** wire `gcRunScopedKeys` to any UI action yet — export it, call it from RunsTablePage's existing bulk-delete success path (runs being deleted = safe GC trigger).
- [ ] **Step 2:** `npm run typecheck` && `npm run build`; commit `"Centralize web-storage keys in lib/storage; GC card keys on run delete"`

### Task 24: comparisons decomposition

**Files:**
- Create: `src/lib/comparisons/` package — `index.ts` (re-exports the exact current public surface of `lib/comparisons.ts` so **no importer changes**), `types.ts` (:13-89 types+guards), `store.ts` (:91-277 CRUD), `templates.ts` (:338-440), `sync.ts` (:442-556), `events.ts` (:285-336 EventTarget pubsub)
- Delete: `src/lib/comparisons.ts` (after moving)

- [ ] **Step 1:** Mechanical split along the section boundaries above; `index.ts` preserves every current export name (grep importers first: 12 files — none may need edits beyond nothing at all, since the path `../lib/comparisons` resolves to the package index).
- [ ] **Step 2:** In `store.ts`, add `updateComparison(projectId: string, id: string, fn: (c: Comparison) => Comparison): Comparison | null` (load → map → save → sync) and rewrite the eight near-identical mutators (:145-277 — `renameComparison` … `removeCardFromComparison`) on top of it (~130 lines → ~40).
- [ ] **Step 3:** Add `compareRunId(comparisonId: string): string` returning today's exact `compare:${comparisonId}` string in `types.ts`; replace the hand-formatted occurrences (comparisons sync :452,:528; ComparePage :798,:931,:945,:984; RunsTablePage :448 — line numbers pre-shift, locate by the `compare:` template literal).
- [ ] **Step 4:** `sync.ts` imports `storageKeys.cardSettings` from Task 23 instead of re-interpolating the key format (:533-535).
- [ ] **Step 5:** `npm run typecheck` && `npm run build`; browser: create/rename/delete comparison, add card to comparison, reload persists; commit `"Decompose lib/comparisons into store/templates/sync/events"`

### Task 25: Central run-label cache seeding

**Files:**
- Modify: `src/lib/run-label.ts`, `src/api/hooks.ts`, `src/pages/ComparePage.tsx` (:55-57), `src/pages/RunsTablePage.tsx` (:218)

- [ ] **Step 1:** Read run-label.ts:12-51 (module cache + `setRunMetadata` + version subscription). Add seeding at the data layer: in `api/hooks.ts`, wherever run lists land (`useRuns` / the runs-infinite hook / `useRun`), call `setRunMetadata(...)` in the query `select` or a `useEffect` on data — one central location replacing the per-page `useMemo` side effects.
- [ ] **Step 2:** Delete the page-level seeding memos (ComparePage :55-57, RunsTablePage :218).
- [ ] **Step 3:** `npm run typecheck`; browser: run labels resolve on a *directly loaded* compare page (deep link, no prior runs-table visit); commit `"Seed run-label cache centrally from the api layer"`

### Task 26: Plugin protocol version

**Files:**
- Modify: `src/components/PluginCard.tsx` (:101-103,139,234 — `cairn:render`/`cairn:resize` postMessage protocol)

- [ ] **Step 1:** Add `protocolVersion: 1` to every message the host sends, and a comment block above the inline iframe JS declaring the protocol (message names, fields, version) as the canonical doc. Additive only — existing plugins ignore unknown fields.
- [ ] **Step 2:** `npm run typecheck` && `npm run build`; browser: `examples/demo_plugins.py` plugin card renders; commit `"Version the plugin iframe postMessage protocol"`

> **Phase 5 / final checkpoint (orchestrator):** full regression sweep per the spec's verification protocol + `npm run build` + final commit of any dist drift.
