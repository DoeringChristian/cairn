# cairn ← cairn-plot v5 adoption (draft)

Status: DRAFT (2026-08-27). Companion to cairn-plot's
`docs/superpowers/specs/2026-08-27-architecture-v5-design.md` (the v5
architecture: framework-free state/view core + thin imperative/React
faces). cairn-plot's v5 work lives on its `refactor5` branch; cairn's
adoption lands on `refactor`. This document is the cairn side of the
contract: what the cards become, when the cut happens, and what cairn
deletes.

## 1. The coupling point

cairn's vendored submodule is pinned at `892126c`, ~10 commits behind
cairn-plot main and a full architecture behind `refactor5`. There is no
gradual re-point: ~14 of cairn's 22 import specifiers already reference
paths that have moved on main, and v5's M1 relocates everything. The
**coordinated cut is cairn-plot M3** ("one box, two slots, kill the
drive mode"): the submodule jumps to `refactor5` post-M3, and every
media card converts in the same cairn commit. Until then cairn stays on
`892126c` and nothing here changes behavior.

## 2. What the cards become

Cards keep what is genuinely cairn's — series selection, the step axis,
run labels, reference *choice* (which tag/run), drag/drop, download,
comparison membership, card layout/persistence — and stop owning any of
cairn-plot's vocabulary:

```tsx
<PlotScope options={{ dataSource: cairnSource }}>
  {metrics.map((m) => (
    <Pane
      kind={refFor(m) ? "compare" : "image"}
      pkey={paneKey(m)}
      content={contentFor(m, currentStep)}      // artifact URLs + metadata
      bind={{ [`card:${cardId}`]: ["image.*", "compare.*"] }}
      settings={settings.paneSettings?.[paneKey(m)]}   // restore seed
    />
  ))}
  <SettingsPanel />       {/* generated from the key table — cairn renders nothing */}
</PlotScope>
```

- **Settings**: persisted card settings become the pane dictionaries
  verbatim (`paneSettings: Record<paneKey, ViewportSettings>`), written
  from commit-phase `settings` events (skip `origin:"self"`), seeded at
  mount. The one-time blob→dictionary adapter maps today's
  `VisualCompareSettings` fields onto `image.*`/`compare.*` keys
  (documented field table; v4.2 [WIRE-3/4] carried).
- **Per-card sync** = the `card:${cardId}` named link — the
  stacked-settings-per-content-kind ruling in one line. Page-wide
  selection, rings, reference, toolbars, enlarge/stage arrive from
  cairn-plot with zero card code.
- **The four blocked features** (reduce, colorRange, channelSelect,
  infoPanel) work via `pane.set` — no seam threading.
- **3D cards** follow the same shape with `kind="mesh" | "pointcloud" |
  "boxes3d" | "volume"`; camera sync = a `["scene3d.camera"]` link
  replacing `useCameraSync`/`cameraSyncGroupId`.

## 3. What cairn deletes (≈500+ lines, measured targets)

- Per-card `useData` resolvers (`useImageData`, `useMeshData`, …) — URL
  resolution moves into the descriptor/content refs; decode/hold is
  cairn-plot's.
- The re-derived vocabulary: the encoding `<Select>` built from
  `listEncodingsByKind`, `MODE_LABELS`, `PIXEL_DIFF_TYPE_VALUES`,
  `EXTENDED_TONEMAP_PEAK_DEFAULT` seeds, engine-kernel menu assembly
  (`useEngineDiffKernels`) — replaced by the generated `<SettingsPanel>`
  or table-driven custom panels.
- `ImageViewportPane`/`*ViewportPane` prop plumbing (19 props/pane), the
  per-pane grid JSX where cairn-plot's grid suffices, view-state
  threading, `useCameraSync`.
- Deep imports: 23 paths / 127 symbols → 2 (`cairn-plot`,
  `cairn-plot/react`), enforced by ESLint `no-restricted-imports`.
- Card-kit hooks that exist only to feed the old panes
  (`use-pane-reference-meta` mimes, parts of `use-pane-resolution`)
  shrink; step/series/reference-choice hooks stay.

Kept in cairn regardless: `CardShell` chrome, `SeriesChipStrip`,
run-selection, step slider, download/export, the reference picker
(same-type filtering), card persistence machinery.

## 4. Sequencing (mirrors cairn-plot §10)

1. **Now (draft, no behavior change):** this document; optionally a
   `paneSettings` field added to card settings types so the blob→dict
   adapter can be written and unit-tested against fixture blobs before
   the cut.
2. **At cairn-plot M2:** cairn can start consuming `getState/setState`
   shapes in tests (stub kind; jsdom) to pin the adapter.
3. **At cairn-plot M3 (THE CUT):** submodule → `refactor5`; ImageCard
   first, then the four 3D cards; delete list above; browser
   verification with `--no-auth` + the recorded user re-test as the
   acceptance gate (unchanged symptom ≠ progress).
4. **After M4:** cards may drop their own multi-pane grids where
   cairn-plot's grid + stacked grids serve better; adopt `<SettingsPanel>`
   fully.

## 5. Open items owned here

- The blob→dictionary field table (write with fixtures from real stored
  cards before M3).
- Whether cards keep their own CSS grid or hand layout to cairn-plot
  grids per card type (decide per card at M3/M4; ImageCard keeps its own
  grid initially — smallest diff).
- The GPU-only-compare ruling (v5 §11 note): cairn serves plain-HTTP LAN
  today; until HTTPS serving lands, compare panes need the minimal CPU
  slide fallback cairn-plot keeps (or cairn accepts degraded compare on
  insecure origins). Coupled to the monolith HTTPS work.
