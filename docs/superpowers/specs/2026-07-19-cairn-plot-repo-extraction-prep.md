# cairn-plot repo extraction — preparation + migration

Status: user-directed (2026-07-19). UPDATE: the target repo EXISTS — an empty clone at
`../cairn-plot` (github.com/doeringchristian/cairn-plot). We migrate the plotting part
there; cairn then consumes cairn-plot as a dependency. The library is exposed BOTH as a
**Python library** (`pip install cairn-plot` → `import cairn_plot as cp`) and an
**HTML/JS library** (the per-renderer IIFE bundles + the standalone-page/report emit —
consumable without Python).

## Phasing
- **Phase 1 (now): migrate.** Populate `../cairn-plot` (layout below) from the monorepo
  state AFTER the in-flight templating + WASM-decoder work merges; standalone gates green
  in the new repo; initial import commit (clean import, no history rewrite — the monorepo
  keeps the history; runbook records the provenance SHA). Push only with user go-ahead.
  During Phase 1 the monorepo keeps its in-tree copy (dual-home; cairn-plot repo is
  canonical from the moment of migration — monorepo changes to the lib FREEZE).
- **Phase 2 (next): consume.** cairn switches to the dependency (uv source: path/git →
  later PyPI pin; app build consumes the TS lib via npm file:-dep or vendored assets),
  and the in-tree copy + shims are deleted.

## Standalone repo layout (Phase 1 target)
```
cairn-plot/
  pyproject.toml           # from packages/cairn-plot (repo root = pip-installable)
  src/cairn_plot/...       # Python package incl. _assets
  ui/                      # TS lib: src/ (lib/cairn-plot/** + plot-* entries),
                           # vite.plot-*.configs, scripts/, package.json, tsconfig
  schema/cairn-plot-spec.schema.json
  tests/                   # test_plot_*.py + node tests live beside ui/src
  examples/                # demo_cairn_plot.py, report_cairn_plot.py, demo_url_images.py
  .github/workflows/ci.yml # tsc, node tests, schema check, pytest, wheel+bare-venv, smoke
  README.md, LICENSE, CHANGELOG.md
```

## Prep workstreams

### P-A. Boundary audit (the hard prerequisite)
The extractable TS surface is `cairn/ui/src/lib/cairn-plot/**` + the standalone entry/bootstrap files (`plot-*.tsx/ts`, `vite.plot-*.config.ts`, `scripts/gen-plot-spec-schema.mjs`/`check-`/`sync-plot-assets.mjs`/`smoke-plot-gallery.mjs`) + `docs/schemas/cairn-plot-spec.schema.json`.
- **Rule: the lib must not import app code.** Audit every import in `lib/cairn-plot/**` and the plot entry files for reaches into `src/components/`, `src/lib/` (non-cairn-plot), app CSS, or app types. Each violation gets fixed (move the shared bit into the lib, or invert the dependency) or explicitly recorded as a cut-line decision.
- The APP importing the lib is fine (that's the future package dependency), but count and list those import sites — they become the app's `@cairn-plot/*` imports at cutover.
- Tailwind/token coupling: the lib's class names depend on the app's tailwind config + `--color-*` tokens. Record exactly which config/token surface the lib needs; prep = a self-contained token/preset file inside the lib that both app and standalone builds consume.

### P-B. In-tree re-homing (make the split a pure path move)
Everything cairn-plot-owned migrates UNDER `packages/cairn-plot/` while staying in this repo:
```
packages/cairn-plot/
  src/cairn_plot/...        # (already here) Python
  ui/                        # NEW home of the TS lib
    src/                     # ← cairn/ui/src/lib/cairn-plot/** + plot-* entries
    vite.*.config.ts, scripts/, package.json (name "@cairn/plot", private for now)
  schema/cairn-plot-spec.schema.json
```
The app keeps building: `cairn/ui` gets a tsconfig path alias + vite alias `@cairn-plot/* → ../../packages/cairn-plot/ui/src/*`, and its imports are mechanically rewritten. Do this ONLY after P-A is clean; it is the big mechanical change and makes the later `git filter-repo --path packages/cairn-plot --path docs/...` extraction trivial with history.

### P-C. Standalone repo scaffolding (files that ship with the split)
Inside `packages/cairn-plot/`: LICENSE (decide: same as cairn), README (exists — expand), CHANGELOG.md, `.github/workflows/ci.yml` (the standalone gates: tsc, node tests, schema check, pytest, wheel build + bare-venv quickstart, smoke:plot), CONTRIBUTING note. These are inert in the monorepo but make the extracted repo CI-green on day one.

### P-D. Extraction runbook (documented, not executed)
`docs/superpowers/specs/cairn-plot-extraction-runbook.md`: the exact `git filter-repo` invocation (path list incl. historical renames for history preservation), the post-split checklist (CI secrets, PyPI/npm names, version tagging), and the cairn-side consumption switch (uv source → PyPI pin; vendored IIFEs → package assets).

## Sequencing
P-A first (audit + violation fixes). P-C and P-D parallel to it (inert files). P-B last, as its own reviewed change (largest diff, mechanical).

## Gates
- P-A: an import-lint (node script or eslint rule) asserting no lib→app imports, wired next to the existing bundle guards; zero violations.
- P-B: app build + plot-inline build + smoke:plot + full pytest all green after the move; `git log --follow` shows history through the move.
- P-C: the standalone ci.yml runs green when executed against `packages/cairn-plot` in this repo (workflow_dispatch or path-filtered).
