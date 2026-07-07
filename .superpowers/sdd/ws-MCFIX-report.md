# WS-MCFIX — `cairn.plot.media_compare(mode="diff")` renders as `side` in `/embed/card`

Base: `d5270aff` (confirmed at start, worktree already on branch `fix/media-compare-embed`).

## RC1 — Python doesn't designate a reference (`cairn/plot.py`)

`media_compare(a, b, mode=...)` emitted `series=[a, b]` + `settings.mode` but never
`settings.baselineIndex`. The renderer's reference-resolution hook
(`use-media-reference.ts`'s `useMediaReference`, wired in `VisualContentCard.tsx` at
`seriesBaselineIndex: settings.baselineIndex`) only resolves a per-pane reference hash
when `baselineIndex != null` (or an external baseline is set). Confirmed in
`VisualContentCard.tsx`: `hasBaseline = baselineIdx != null || extBase != null`, and the
`paneRefHashArr` comment explicitly documents that a null reference forces every mode
(diff/split/blend) down to unmodified per-pane rendering — i.e. visually `side` — even
though `settings.mode` itself still says `"diff"`. This is the bug: the compositor never
even reaches its diff/split/blend pixel logic.

Fix: `media_compare` now always passes `settings={"baselineIndex": 0}` into
`_card_element`, designating index 0 (`a`, the first argument) as the reference —
confirmed semantics from `use-media-reference.ts`: `seriesBaselineIndex` is a plain index
into the card's own `series` list ("source: series-same-step — index into the card's own
series list"). `b` (series index 1) is what gets diffed/split/blended against it. Set
unconditionally (not gated on `mode != "side"`) since `"side"` never reads the reference
(verified — its raw per-pane rendering is baseline-independent) and setting it
unconditionally lets a later in-card mode switch (diff/split/blend) work immediately
without a reload. `CardSettingsSpec` (`cairn/sdk/card_spec.py`) is `extra="allow"`, so the
new key round-trips through schema validation with no model change needed.

## RC2 — `/embed/card` ignores `spec.settings` on fresh load (`cairn/ui/src/embed-main.tsx`)

`EmbedApp` fetched `{sid, spec}` from `/api/embed/specs/:sid` and rendered
`<EmbeddedCard card={spec} />`, but `spec.settings` (now carrying `mode`/`baselineIndex`)
was read into a `ComparisonCard`-typed variable (`{id, type, series}` — no `settings`
field) and never touched again. The card's actual settings come from
`useCardSettings` (`lib/card-settings.ts`), which reads `localStorage` synchronously in a
`useRef` initializer on first render — with nothing ever written there, the card mounted
with its hardcoded defaults (`mode: "normal"`).

Fix:
- `EmbedSpecResponse.spec` is now typed `CardSpec` (`lib/cards/card-spec.ts` —
  `ComparisonCard & { settings?: CardSettingsSpec }`), the existing schema-generation type
  for exactly this shape (already used by the ```cairn dialect / reports), instead of the
  narrower `ComparisonCard`.
- `EmbeddedCard`'s `cardWithId` `useMemo` (previously just id-defaulting) now also calls
  `saveCardSettings(cardSettingsKeyForScope(EMBED_SCOPE, withId), { version: 1, ...card.settings })`
  when `card.settings` is present. `EMBED_SCOPE = "embed"` is the embed's own synthetic
  scope (already existed, used to build `settingsKeyOverride`/`settingsKey` below) — this
  can never collide with or leak into a real comparison's (`compare:<id>`) or report's
  (`report:<id>`) localStorage scope.
- **Why a `useMemo` and not a `useEffect`**: `useCardSettings` reads `localStorage`
  synchronously in a `useRef` initializer during the CHILD (`CardRenderer`)'s first
  render — before any effect fires. Seeding in a `useEffect` in the parent would run
  strictly after the child already mounted with defaults (React commits effects
  child-first, after the whole tree renders), so it would always be one render too late
  (verified against the precedent, `restoreReportCardSettings` in
  `lib/reports/payload.ts`, which achieves "before-first-render" the different way: by
  gating the child's render behind a `blocks` state that only populates after the
  settings write). A synchronous `useMemo` in `EmbeddedCard`'s own render body runs
  before React ever renders `<CardRenderer>` (React resolves a component tree parent-
  first, depth-first, synchronously within one render pass), so the localStorage write is
  guaranteed to land before `CardRenderer`/`useCardSettings` first reads it — no
  extra "hydrated" gating state needed.

## Test added

`tests/unit/test_plot_elements.py::test_media_compare_sets_two_series_and_mode` now also
asserts `spec.settings.model_dump(exclude_none=True).get("baselineIndex") == 0` (schema-
validated via `_validate_card_spec` / `cairn/sdk/card_spec.py`'s `CardSpec`/
`CardSettingsSpec`).

## Browser verification (port 4412, `--no-auth`, `examples/demo_image_comparison.py` seed
data — `baseline` vs `gaussian-noise-high` runs' `output` tag)

Built 4 embed specs via `cplot.media_compare(base["output"], noisy["output"], mode=...)`
+ POST `/api/embed/specs`, opened each `/embed/card?sid=...`:

- **`diff`**: right pane renders a genuine per-pixel diff (near-black background with
  faint noise-magnitude speckle, shapes barely visible) — visibly distinct from the raw
  noisy image (side-by-side confirmed separately: same run's raw `output` is fully
  colored/grainy, not black). Console logged `[cairn] WebGL 2 diff initialized`,
  confirming the diff shader pipeline actually ran (not the pre-fix no-op).
- **`split`**: draggable clip divider, left of the line = REF (clean baseline), right =
  the pane's own (noisy) content. Distinct from diff and side.
- **`blend`**: alpha-blended composite (viewport visibly desaturated/dimmed, no clip line,
  no per-pixel diff coloring) — distinct from split and diff.
- **`side`**: two full, unmodified panes (baseline: clean; gaussian-noise-high: raw
  grainy). Confirmed unaffected by unconditionally setting `baselineIndex=0` — matches
  the same rendering as a `side` spec built WITHOUT `baselineIndex` (side is reference-
  independent), except the with-baseline version additionally shows REF panes (existing
  `VisualContentCard` behavior once a reference exists — pre-existing app behavior,
  unrelated to this fix, out of scope).
- Without `baselineIndex` (`settings={"mode":"side"}` only, pre-RC1-fix shape): the whole
  compare-mode toolbar (normal/side/split/blend/diff pills) doesn't render at all — this
  is the `isMulti && hasBaseline` gate — confirming the pre-fix bug was actually broader
  than "diff renders as side": no baseline meant no compare controls at all.
- Console clean (no errors) on all four loads.

## Gates

- `cd cairn/ui && npm run typecheck` — exit 0.
- `node_modules/.bin/vite build` — green; both `dist/index.html` and `dist/embed.html`
  emitted.
- `uv run --extra dev pytest tests/unit` — `tests/unit/test_plot_elements.py` all 30
  passed (including the updated `baselineIndex` assertion). Full suite: 15 pre-existing
  failures unrelated to this change (`test_cli.py`, `test_config.py`,
  `test_config_target.py`, `test_local_transport.py` — a `config.resolve_target()`
  kwarg-signature mismatch predating this branch, confirmed by inspecting the failures
  directly: `TypeError: resolve_target() got an unexpected keyword argument 'server'`),
  488 passed, 2 skipped — matches the expected "~15 baseline unchanged".

## MERGE LOG (merge agent M-62, 2026-07-07)

- Merged `fix/media-compare-embed` (3 commits, ending `4ad5c3c6`) into `main` via
  `git merge` — **fast-forward**, `d5270aff` → `4ad5c3c6`. No conflicts (a stray
  uncommitted `cairn/ui/tsconfig.app.tsbuildinfo` diff on `main` was stashed before the
  merge and dropped after — it was regenerated identically by the rebuild, so nothing
  to recommit).
- Gates re-verified on `main` post-merge:
  - `npm run typecheck` — exit 0, no errors.
  - `node_modules/.bin/vite build` — green; `dist/index.html` and `dist/embed.html`
    both emitted; rebuilt `dist/` byte-for-byte matches the committed tree (`git status`
    clean after build) — no recommit needed.
  - `uv run --extra dev pytest tests/unit` — 487 passed, 3 skipped, 15 failed; the 15
    failures are exactly the known pre-existing baseline (`test_cli.py`, `test_config.py`,
    `test_config_target.py`, `test_local_transport.py::test_create_run_writes_to_duckdb`),
    zero failures in `test_plot_elements.py` (the `baselineIndex` assertion included).
- Server restarted on `:4301` with `--no-auth` after the (no-op) dist rebuild; health
  check `200` on `/`.
- Browser verification (Chrome MCP) against the existing `image-comparison-demo`
  project's `baseline` and `red-tint` runs (no new runs needed to seed — both already
  present) — built four `cairn.plot.media_compare(run_a["output"], run_b["output"],
  mode=...)` cards, POSTed each spec to `/api/embed/specs`, opened
  `/embed/card?sid=...` for each:
  - **diff**: right pane renders a uniform dark-red pixel-diff heatmap (consistent with
    the constant red-channel offset the `red-tint` variant applies) — NOT the raw
    unmodified `red-tint` image (which would show grid lines/shapes). Compare toolbar
    (normal/side/split/blend/diff + "Absolute Error" dropdown) present. Console shows
    `[cairn] WebGL 2 diff initialized`, corroborating a real GPU-computed diff.
  - **split**: draggable clip — left half REF (baseline, unmodified), right half the
    `red-tint` variant, visibly distinct (reddish/pink tint) at the split line.
  - **blend**: DOM-inspected — the `red-tint` pane stacks two distinct `<img>` sources
    (`red-tint` + baseline `REF`) each at `opacity: 0.5`, a genuine alpha composite (the
    `baseline`-vs-itself pane correctly self-blends to an unchanged image).
  - **side**: four panes (REF/baseline/REF/red-tint) — the `red-tint` pane visibly
    tinted vs. the other three, all correctly distinct.
  - Console clean across all four loads — no errors, only the WebGL-diff info log.
- Cleanup: removed the `.claude/worktrees/fix-mediacompare` worktree (unlinked the
  `node_modules` symlink and deleted the stale `tsconfig.app.tsbuildinfo` first, then
  `git worktree remove --force`; the only worktree-local diff was that same tsbuildinfo
  deletion). Kept branch `fix/media-compare-embed` per instructions — no auto-branch
  existed for this task to delete. `:4301` left running with `--no-auth`.
- Nothing unverified — no browser/CDP flake this round; all four compare modes visually
  and structurally confirmed distinct and correct.
