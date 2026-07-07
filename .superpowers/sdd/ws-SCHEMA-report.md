# WS-SCHEMA report — card-spec single source of truth

**Branch:** `feature/ws-schema` (worktree `.claude/worktrees/ws-schema-fresh`)
**Base check:** HEAD was `ae86a95b` ("Merge branch 'fix/samemetric-grid-ref'") ✓
**Protocol:** stop-at-branch. NOT merged to main.

## Commits (in order)
- `2164f69e` — one canonical `CARD_TYPES`; derive union/guard/renderer from it
- `f0039dda` — generate JSON Schema from TS + drift-check gate
- `ac97f706` — pydantic card-spec model + schema conformance test

(pre-commit hook rebuilt & staged `cairn/ui/dist/` on the two UI-touching commits.)

## D1 — ONE source of truth
`cairn/ui/src/lib/cards/card-spec.ts` — `CARD_TYPES` (21 members) + `CardType`,
plus schema-root types `CardSpec` / `SeriesRef` / `RunSelectorSpec` / `CardsSpec`
/ `ReportSpec` / `CardSettingsSpec`, composing existing
`ComparisonCard`/`ComparisonSeriesRef`/`RunSelector` (no redefinition). Plus a
`CardSpecSchema` umbrella root used only by the generator.

**The three former defs now derive from it (behavior-preserving):**
1. Closed union — `ComparisonCard.type` retyped `= CardType` (was a 16-member
   hand-union; widened superset). `lib/comparisons/types.ts`.
2. Runtime guard — `isComparisonCard` stays deliberately permissive
   (forward-compat: accepts any non-empty string so a new type never drops a
   comparison); doc now points at the canonical type. Unchanged behavior.
3. Renderer switch — `CardRenderer.tsx` gains a compile-time exhaustiveness
   assertion (`SeriesRendererCase | MultiRunCardType` vs `CardType`, via
   `AssertRendererCoversAllCardTypes`); zero runtime cost. Drift = build error,
   not a silent `UnknownTypeCard` fall-through. Switch cases untouched.

## D2 — JSON Schema + drift-check
- `docs/schemas/cairn-card-spec.schema.json` generated via
  `ts-json-schema-generator` (added as UI devDep `^2.9.0`).
- `npm run gen:card-schema` (scripts/gen-card-spec-schema.mjs) writes it.
- `npm run check:card-schema` (scripts/check-card-spec-schema.mjs) regenerates
  to stdout, diffs vs committed, exits 1 on drift. **Run:** `cd cairn/ui && npm
  run check:card-schema` → prints "OK". This is the TS↔schema gate.

## D3 — Pydantic model + conformance
- `cairn/sdk/card_spec.py` — hand-written pydantic v2 mirror (pydantic already
  a core dep; no new runtime dep, no datamodel-code-generator). Not wired into
  runtime (WS-PYAPI does that).
- `tests/unit/test_card_spec_conformance.py` asserts field-for-field vs the
  committed schema (vocabulary + per-model properties/required/extra-policy +
  sample round trip). Completes the anti-drift chain: TS → JSON Schema
  (`check:card-schema`) → pydantic (this test).

## Gates
- `cd cairn/ui && npm run typecheck` → **exit 0**
- `node_modules/.bin/vite build` → **exit 0** (dist byte-identical to hook's)
- `npm run check:card-schema` → **exit 0** (OK)
- `uv run --extra dev pytest tests/unit/test_card_spec_conformance.py` → **30 passed**
- Full `tests/unit`: **15 failed, 406 passed** — the 15 are pre-existing
  baseline failures in `test_cli`/`test_config`/`test_config_target`/
  `test_local_transport` (env/format drift, e.g. run_id 32≠12; files I never
  touched). New conformance test is among the 406 passed.

## STOP
Committed to `feature/ws-schema`, gates green from this worktree. Awaiting
review gate + serialized merge. Did NOT checkout/merge main.

## MERGE LOG (merge agent M-SCHEMA, 2026-07-07)

- Base at merge time: `main` = `d41d6396` (marimo example + card-embed design
  spec landed since `ae86a95b`, both disjoint from the schema files).
- `git merge feature/ws-schema --no-edit` → clean, **zero conflicts**
  (not even in `cairn/ui/dist/*` or `tsconfig.*.tsbuildinfo` — main's
  since-`ae86a95b` commits never touched those paths). Merge commit
  `eec8cd7c`.
- Applied the review's tiny clarity edit: annotated `SeriesRendererCase` in
  `cairn/ui/src/components/CardRenderer.tsx` as a HAND-MAINTAINED MIRROR of
  the switch's `case` labels (the `AssertRendererCoversAllCardTypes` check
  only validates this list against `CARD_TYPES`, not the actual switch — a
  removed/renamed `case` would not be caught; tracked as follow-up #61 for a
  `default: assertNever` hardening). Comment-only, no type/switch change.
  Commit `29f7ae80` — "Annotate SeriesRendererCase as hand-synced mirror
  (WS-SCHEMA review note)".
- `npm install` was required post-merge: `feature/ws-schema` added
  `ts-json-schema-generator` to `package.json` devDependencies but this
  checkout's `node_modules` predated the merge. After `npm install`,
  `package-lock.json` had no diff (branch's lockfile was already correct).

### Gates (all green)
- `npm run typecheck` → exit 0.
- `vite build` → exit 0; `git status` showed **no dist diff** after the
  clarity-edit commit's hook-triggered rebuild — confirms dist stayed
  byte-identical (behavior-preserving), matching the branch reviewer's
  finding.
- `npm run check:card-schema` → `OK — committed schema matches the TS
  source.`
- `pytest tests/unit/test_card_spec_conformance.py` → **30 passed**.
- `pytest tests/unit` (full) → **15 failed, 435 passed, 3 skipped**. The 15
  failures are exactly the pre-existing baseline (`test_cli`, `test_config`,
  `test_config_target`, `test_local_transport`) — no new failures, and the
  conformance test is among the passes.

### Browser smoke
Server restarted post-rebuild (`--no-auth`, port 4301), health OK. Verified
in-browser (screenshots, console clean) before the browser session dropped
mid-task (see note below):
- **scalar** — `vc6-crosstype-demo/run-mixed` SYSTEM section (11
  `system.cpu.*`/`system.memory.*` line-chart cards) and `table-demo`
  `accuracy` chart. Renders identically to pre-merge (line charts,
  tooltips).
- **image** — `vc6-crosstype-demo/run-mixed` MEDIA `frame` card (checkered
  transparent background, shapes). Renders correctly.
- **mesh** — same run's CHARTS `shape` card (3D mesh viewer, "1,140
  faces"). Renders correctly.
- **table** — `table-demo/run-b` `predictions` (1000-row paginated table)
  and `summary` (4-row) cards. Renders correctly, filter/pagination present.
- **html** — ran `examples/demo_html_markdown.py` fresh against :4301 to
  seed data (no pre-existing html/markdown demo project existed); the
  `reports.summary` and `reports.sandbox_probe` HTML cards render inside
  the sandboxed iframe; the sandbox-escape probe correctly shows "blocked"
  for `parent.location`/`localStorage`, confirming the sandbox still holds
  post-merge.
- **markdown** — same seeded run's `notes.training` card renders headings,
  bold, a bullet list, and a struck-through item correctly via
  react-markdown/remark-gfm.
- **multi-run bar** — created a throwaway comparison (`summary-cards-demo`,
  4 runs: big-batch/sgd-momentum/tuned-lr/baseline), added a Bar Chart card
  via "+ Add card" → Bar Chart → `final.accuracy`, confirmed all 4 runs
  render as grouped horizontal bars with correct values (0.91/0.88/0.82/
  0.76). Did not touch or delete any pre-existing comparison.
- Console clean (no errors) on every page checked, both on first load and
  after a hard refresh.

**Not completed — environment issue, not a merge defect:** the "genuinely-
unknown persisted type still falls to `UnknownTypeCard`" check and a final
console sweep were not done. Partway through the smoke test the Chrome
extension's MCP tab group silently landed on a different tab group whose
`localhost:4301` was unreachable (`Frame with ID 0 is showing error page`)
even though `curl http://localhost:4301/...` from this shell kept returning
200 throughout — i.e. the server never went down. `list_connected_browsers`
showed **two** connected Chrome instances (`Browser 1`, macOS, local; and
`Browser 2`, Linux, remote); the session appears to have been talking to
the non-local one when the failures started, and reselecting requires an
explicit user confirmation this agent cannot issue in the background. All
gates above (typecheck/build/schema-drift/pytest) are unaffected — this is
purely a manual-verification gap. Recommend a follow-up manual check of the
unknown-type fallback before considering the UI review 100% closed.

### Cleanup
- Worktree `.claude/worktrees/ws-schema-fresh` removed (cleared
  `node_modules` and `tsconfig.*.tsbuildinfo` first, then `git worktree
  remove --force` — force was needed only because deleting those tracked
  build artifacts locally showed as "modified"; no source edits were
  discarded). `feature/ws-schema` branch kept per instructions. No
  worktree-scoped auto-branch existed to delete (the worktree tracked
  `feature/ws-schema` directly).
- `.claude/worktrees/agent-a5e83944b37269550` (WS-EMBED, active elsewhere)
  left untouched.
- Server left running on :4301 with `--no-auth`.
