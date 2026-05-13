# Cairn UI/SDK Audit — Design Shortcuts & Fixes

Comprehensive audit of design shortcuts taken during recent development, plus
pre-existing issues discovered across the codebase. Organized by severity and
whether the fix is a generalization (prevents a class of bugs) or a point fix.

---

## A. Shortcuts I Introduced (Recent Changes)

### 1. Duplicated scroll-restore hooks
**Files:** `use-scroll-restore.ts`, `use-element-scroll-restore.ts`

These two files are 95% identical — same `read()`/`write()` helpers, same
double-RAF restore pattern, same debounced scroll listener. The only difference
is `window.scrollY` vs `el.scrollTop`.

**Fix:** Merge into a single `useScrollRestore(target, key, ready)` where
`target` is `Window | HTMLElement`. The `read`/`write` helpers are already
shared constants — extract to a private `scroll-storage.ts` module.

```
Before: 2 files, ~120 lines total, identical helpers duplicated
After:  1 file, ~70 lines, single parameterized hook
```

---

### 2. TagInput `onBlur` uses `setTimeout(150ms)` hack
**File:** `TagInput.tsx:87-88`

```tsx
onBlur={() => {
  setTimeout(() => setOpen(false), 150);
}}
```

This races: if the user clicks a dropdown item, the blur fires first and
the 150ms delay *hopefully* lets the `onMouseDown` fire before the dropdown
disappears. This is fragile — on slow machines or when React batching delays
the `onMouseDown`, the dropdown vanishes before the click registers.

**Fix:** Use `relatedTarget` to check if focus moved to the dropdown, or
use a `pointerdown` handler on the document that checks if the click is
inside the wrapper ref. The existing codebase has this pattern in
`SettingsPopover.tsx:102-121` — extract a `useClickOutside(ref, onClose)` hook
and use it in TagInput too.

---

### 3. ComparisonOverviewTab: diff table doesn't handle missing params
**File:** `ComparisonOverviewTab.tsx:53-56`

```tsx
if (vals.length < compRunIds.length || vals.some((v) => v !== vals[0])) {
  differing.add(key);
}
```

A param present in only some runs is correctly flagged as "differing", but the
cell shows "—" which looks like missing data, not "this run didn't log this
param." No visual distinction between "param=null" and "param not logged."

**Fix:** Use a distinct sentinel (e.g., italic "(not set)") for params that
were never logged vs params that were logged as null/empty.

---

### 4. ComparisonOverviewTab: N+1 fetches for run details
**File:** `ComparisonOverviewTab.tsx:16-22`

```tsx
const queries = useQueries({
  queries: compRunIds.map((id) => ({
    queryKey: ["run", id],
    queryFn: () => api.run(id),
  })),
});
```

Each run triggers a separate HTTP request. With 20 runs in a comparison,
that's 20 parallel requests on tab switch. These hit the react-query cache
if the user visited the run detail page before, but for the common case
(user creates comparison from runs table without visiting each run) they're
all cache misses.

**Fix:** Add a batch endpoint `POST /api/runs/batch` that accepts a list of
IDs and returns all run details + params in one response. Or accept that
the cost is bounded by the comparison size (typically <20 runs) and the
requests are parallel — acceptable for v1.

---

### 5. ComparisonSourceTab: state doesn't update when compRunIds changes
**File:** `ComparisonSourceTab.tsx:26-27`

```tsx
const [leftId, setLeftId] = useState<string>(compRunIds[0] ?? "");
const [rightId, setRightId] = useState<string>(compRunIds[1] ?? compRunIds[0] ?? "");
```

`useState` initializer only runs once. If the user adds/removes runs from
the comparison, `leftId`/`rightId` keep pointing to the original runs even
if those runs were removed.

**Fix:** Use a `useEffect` that resets `leftId`/`rightId` when `compRunIds`
changes, or derive them from compRunIds with a fallback:
```tsx
const leftId = compRunIds.includes(rawLeftId) ? rawLeftId : (compRunIds[0] ?? "");
```

---

### 6. ComparisonSourceTab: diffLines called on every render
**File:** `ComparisonSourceTab.tsx:225`

```tsx
const parts = diffLines(left, right);
```

`diffLines` is called inside the `DiffView` render function (not memoized).
For large files, this is expensive and runs on every parent re-render.

**Fix:** Wrap in `useMemo`:
```tsx
const parts = useMemo(() => diffLines(left, right), [left, right]);
```

---

### 7. ComparisonSourceTab: no file added/removed for one-sided files
**File:** `ComparisonSourceTab.tsx:75-89`

When a file exists only in the left or right tree, the query for the missing
side is still enabled (`enabled: !!selectedFile && !!leftId`). The server
returns a 404, which react-query treats as an error, but the component
doesn't distinguish "file not found" from "network error."

**Fix:** Check the merged file status before fetching. If status is "added",
don't fetch the left side. If "removed", don't fetch the right side.

---

### 8. Infinite scroll: observer ref pattern is complex
**File:** `RunsTablePage.tsx:106-132`

Three refs (`hasNextRef`, `fetchingRef`, `fetchNextRef`) manually synced
from the query object on every render, plus a callback ref for the sentinel
element. This works but is hard to read and maintain.

**Fix:** Extract a `useInfiniteScroll(query)` hook that returns the sentinel
ref. Encapsulates all the ref plumbing:
```tsx
const sentinelRef = useInfiniteScroll(q);
// ...
<div ref={sentinelRef} />
```

---

### 9. Runs invalidation uses prefix matching across query types
**File:** `RunsTablePage.tsx:139,150,157,163,169`

```tsx
qc.invalidateQueries({ queryKey: ["runs"] });
```

This invalidates both `["runs", ...]` (useRuns) and `["runs-infinite", ...]`
(useInfiniteRuns) because react-query matches by prefix. While this works,
it's accidental — if someone renames the key, it silently breaks.

**Fix:** Invalidate explicitly:
```tsx
qc.invalidateQueries({ queryKey: ["runs-infinite"] });
```
Or define query key factories in a central module.

---

### 10. Syntax highlight: `.js`/`.jsx` mapped to "typescript"
**File:** `syntax-highlight.ts:34-36`

```tsx
js: "typescript",
jsx: "typescript",
```

JavaScript files are highlighted as TypeScript. This mostly works because TS
is a superset, but type annotations in JS (e.g., JSDoc) may highlight
incorrectly, and some valid JS patterns aren't valid TS.

**Fix:** Map to `"javascript"` and `"tsx"` respectively.

---

## B. Pre-Existing Shortcuts Worth Fixing

### 11. SERIES_COLORS defined in 5 files
**Files:** `AudioPlayerCard.tsx:60-67`, `VideoPlayerCard.tsx:65-72`,
`ScalarPlotCard.tsx:119-126`, `FigureInteractiveCard.tsx:57-64`,
`ImageGalleryCard.tsx:98-102`

Same 6-color palette copy-pasted. Adding a color or changing the palette
requires editing 5 files.

**Fix:** Extract to `lib/colors.ts`:
```tsx
export const SERIES_COLORS = ["#2563eb", "#dc2626", ...];
```

---

### 12. Modal boilerplate repeated 4 times
**Files:** `AddCardModal.tsx`, `CardDetailModal.tsx`,
`SmartComparisonWizard.tsx`, various settings popovers

Each implements:
- Escape key listener
- Body scroll lock (`document.body.style.overflow = "hidden"`)
- Click-outside-to-close

**Fix:** Extract `useModalBehavior(open, onClose)` hook that handles all
three concerns. Use it in all modals.

---

### 13. "Add to Comparison" popover duplicated across 4+ card types
**Files:** `AudioPlayerCard`, `HistogramCard`, `TextViewerCard`,
`VideoPlayerCard`

Each card implements ~40 lines of identical state + UI for the "add to
comparison" button, confirmation timer, and popover.

**Fix:** Extract `<AddToComparisonButton metric={...} runId={...} />` component.

---

### 14. `seriesKey()` and `seriesLabel()` defined 4 times
**Files:** `AudioPlayerCard.tsx:78-97`, `VideoPlayerCard.tsx:86-105`,
`ScalarPlotCard.tsx:128-155`, `FigureInteractiveCard.tsx:136-155`

Identical utility functions.

**Fix:** Extract to `lib/series-utils.ts`.

---

### 15. `viridis()` color function defined twice
**Files:** `ParallelCoordsCard.tsx:44-51`, `ScatterPlotCard.tsx`

**Fix:** Extract to `lib/colors.ts`.

---

### 16. TextViewerCard: fetch side-effect in useMemo
**File:** `TextViewerCard.tsx:66-75`

```tsx
useMemo(() => {
  fetch(api.artifactUrl(current.artifact_hash))
    .then(res => res.text())
    .then(setContent)
}, [current?.artifact_hash]);
```

`useMemo` is for pure computations, not side effects. React may call
this multiple times in strict mode or concurrent features.

**Fix:** Move to `useEffect` or use `useQuery`.

---

### 17. localStorage quota failures are silent everywhere
**Files:** `card-settings.ts`, `comparisons.ts`, `run-layout.ts`,
`workspace-visibility.ts`

All wrap `localStorage.setItem()` in try/catch and silently ignore.
The user has no idea their settings aren't being saved.

**Fix:** Add a global `onStorageError` callback or toast notification
that fires once per session when storage fails.

---

### 18. `run-label.ts`: setRunMetadata replaces entire cache
**File:** `run-label.ts:44-47`

```tsx
const next = new Map<string, Run>();
for (const r of runs) next.set(r.id, r);
runMetadataCache = next;
```

With infinite scroll, the first page calls `setRunMetadata(runs)` with 100
runs. When page 2 loads, `setRunMetadata` is called with 200 runs. But if
another component (e.g., ComparePage) called `setRunMetadata` with different
runs in between, those are lost.

**Fix:** Change `setRunMetadata` to merge instead of replace:
```tsx
for (const r of runs) runMetadataCache.set(r.id, r);
```
(The `addRunMetadata` function at line 50 already does this but isn't used
by the main call site.)

---

### 19. No API response validation
**File:** `api/client.ts:10`

```tsx
return (await res.json()) as T;
```

Blind cast. If the server shape changes, the UI gets wrong data at runtime
with no error. This is a class of bug that's hard to debug.

**Fix:** For critical types (Run, Param, etc.), add a lightweight runtime
validator. Even just checking the presence of `id` and `status` fields
catches most shape mismatches.

---

### 20. CORS allows all origins
**File:** `app.py:129`

```python
allow_origins=["*"]
```

Any website can make requests to Cairn and read/modify all data.

**Fix:** Default to `localhost` origins only. Add `--cors-origin` flag for
explicit configuration.

---

## C. Generalization Opportunities (Prevents Future Bugs)

### G1. Centralized localStorage key registry
Create `lib/storage-keys.ts`:
```tsx
export const KEYS = {
  comparisons: (pid: string) => `cairn:comparisons:${pid}`,
  cardSettings: (rid: string, m: string, c: string) => `cairn:card-settings:${rid}:${m}:${c}`,
  scroll: (key: string) => `cairn:scroll:${key}`,
  // ...
} as const;
```
Prevents key collisions and makes it easy to audit what's stored.

### G2. Generic `usePersistedState<T>(key, initial, validator)` hook
Combines localStorage read/write, cross-tab sync via StorageEvent, and
validation. Replaces the bespoke patterns in comparisons.ts, card-settings.ts,
workspace-visibility.ts, render-mode.ts, stream-mode.ts.

### G3. `useClickOutside(ref, onClose)` hook
Replaces the duplicated pointerdown + keydown listeners in SettingsPopover,
MetricChips, TagPicker, and TagInput's setTimeout hack.

### G4. `useModalBehavior(open, onClose)` hook
Combines: escape key, body scroll lock, focus trap. Replaces boilerplate
in 4+ modal components.

### G5. Query key factories
```tsx
export const queryKeys = {
  runs: (params: RunsParams) => ["runs", params] as const,
  runsInfinite: (params: RunsParams) => ["runs-infinite", params] as const,
  run: (id: string) => ["run", id] as const,
  // ...
};
```
Prevents key typos and makes invalidation explicit.

---

## D. Changes Made During This Session (For Reference)

| Commit | What Changed |
|--------|-------------|
| e16bc62b | `cairn diff` CLI command + test |
| e3251c34 | TagInput component, useProjectTags hook, integrated into 3 tag input sites |
| f39c2bd2 | Comparison tabs (Overview/Metrics/Source), sidebar scroll restore, syntax-highlight extraction |
| da1a49e1 | useInfiniteRuns hook, offset param in API client |
| b1944d76 | Rebuilt dist, stress test script |
| (uncommitted) | Run dedup, stable sort, ID-based selection, onChange checkboxes, callback ref sentinel |

---

## E. Priority Order for Fixes

**Immediate (breaks functionality):**
1. ComparisonSourceTab leftId/rightId not resetting on run changes (#5)
2. DiffView not memoized — slow for large files (#6)
3. setRunMetadata replaces instead of merges (#18)

**High (prevents classes of bugs):**
4. Merge scroll-restore hooks (#1)
5. Extract useClickOutside — fixes TagInput blur hack (#2, G3)
6. Extract useInfiniteScroll — simplifies RunsTablePage (#8)
7. Centralize SERIES_COLORS (#11)
8. Fix TextViewerCard useMemo side effect (#16)

**Medium (consistency / maintainability):**
9. Extract "Add to Comparison" component (#13)
10. Extract seriesKey/seriesLabel utils (#14)
11. Extract useModalBehavior (#12, G4)
12. Fix JS→typescript highlighting (#10)
13. Query key factories (G5)

**Low (nice to have):**
14. API response validation (#19)
15. Storage key registry (G1)
16. localStorage error notification (#17)
17. Batch run detail endpoint (#4)
18. CORS restriction (#20)
