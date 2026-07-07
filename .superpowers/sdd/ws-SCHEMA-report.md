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
