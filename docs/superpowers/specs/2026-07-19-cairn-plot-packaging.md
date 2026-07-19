# cairn-plot packaging — separate pip package, same repo (P2)

Status: DRAFT for user review. Decision base: user confirmed "separate cairn-plot pip package, but keep it part of the same repo" (2026-07-19).

## Goal

`pip install cairn-plot` in a clean venv → `import cairn_plot as cp` → 5-line script → offline HTML report renders — with **no** cairn server/app/tracking installed. `cairn-track` (the existing package) depends on `cairn-plot` and keeps `import cairn.plot as cp` working unchanged.

## Decisions

1. **Distribution + import names.** New distribution `cairn-plot` providing top-level module **`cairn_plot`**. The existing `cairn.plot` module becomes a thin re-export shim (`from cairn_plot import *`, plus the cairn-only extras like `DataRef` glue), so every existing user/test keeps working. We do NOT use namespace-package splitting of `cairn.*` across distributions (fragile, poor tooling support).
2. **Repo layout (monorepo, uv workspace).**
   ```
   packages/cairn-plot/
     pyproject.toml            # name = "cairn-plot", version 0.1.0
     src/cairn_plot/
       __init__.py             # the cp.* public surface
       components.py           # ← cairn/sdk/plot_components.py (moved)
       elements.py             # ← PlotElement + HtmlElement (factored OUT of cairn/sdk/elements.py)
       spec.py                 # ← plot-side pydantic models (factored OUT of cairn/sdk/card_spec.py)
       report.py               # ← PlotReport (+ _markdown_to_html) (factored OUT of cairn/sdk/report.py)
       bundle.py               # ← cairn/sdk/_plot_bundle.py, asset resolution via importlib.resources
       recipes.py              # ← the pure-numpy plotly-recipe helpers from cairn/plot.py
       _assets/plot-inline/    # core/figure/three/gpu-image IIFEs + style.css (package data)
   ```
   Root `pyproject.toml` gains `[tool.uv.workspace] members = ["packages/cairn-plot"]` and `cairn-track` adds a dependency on `cairn-plot` (workspace source in dev; `>=0.1,<0.2` pin on release).
3. **What stays in `cairn`:** everything app/server/run-coupled — `CardElement`, card specs for app cards, the server-backed `cairn.Report`, `DataRef`/`ArtifactInfo` run-reading, handlers, transport. `cairn/plot.py` shim re-exports `cairn_plot` and layers the run-integration extras (e.g. `cp.Image(run["tag"])` DataRef support) on top via the seam below.
4. **The DataRef seam.** `cairn_plot` must not import cairn's reader. Components accept a small **protocol** (`SupportsPlotData`: `.to_plot_payload() -> bytes|ndarray + meta`) instead of the concrete `DataRef`; `cairn`'s shim registers an adapter making `DataRef` satisfy it. Standalone users never see it.
5. **JS assets as package data.** `dist/plot-inline/*` is copied into `src/cairn_plot/_assets/plot-inline/` at build time by the existing `build:plot-inline` step (a small sync script + CI check that the two are identical, replacing today's "commit dist" convention for the plot bundle — dist stays committed for the app; the package assets are the canonical copy for the lib). `bundle.py` resolves via `importlib.resources.files("cairn_plot._assets")` with a repo-checkout fallback for dev.
6. **TS source stays where it is** (`cairn/ui/src/lib/cairn-plot/`). This spec splits the *Python distribution*, not the TS tree; the per-renderer IIFE outputs are already the clean artifact boundary.
7. **Version + API freeze.** `cairn_plot.__version__ = "0.1.0"`. Public = the documented `cp.*` surface (capitalized components, lowercase aliases, `Grid`, `Shared`, `Compare` family, `Report`/`report`, recipes). Everything else underscore-private. Deprecations go through the `cairn.plot` shim only.

## Migration plan (high level)

M1: factor pure-plot code out of the three mixed modules (in place, inside `cairn/`), so `cairn.plot` has zero app imports — proven by an import-lint test (`import cairn.plot` must not pull server/app modules).
M2: create `packages/cairn-plot` skeleton + uv workspace; MOVE the factored modules; `cairn.plot` becomes the shim; asset sync script + CI identity check.
M3: clean-venv gate in CI: build the wheel, install into a bare venv, run the 5-line quickstart + `smoke:plot`-style assertion on its output; plus the existing 152-test suite green through the shim.
M4: docs/quickstart + README for the package (P3 rides on this).

## Gates

- `pip install <wheel>` in bare venv → quickstart report renders (headless-verified).
- `import cairn_plot` pulls no cairn/server modules (import-lint).
- Full existing pytest suite green via the `cairn.plot` shim (no caller changes).
- Wheel size sanity: assets ≈ core+addons (~2–3 MB), no dist/assets duplication beyond the one canonical copy.

## Out of scope

PyPI publishing credentials/release automation (separate step once the wheel gate is green); TS-tree extraction to its own npm package; EXR (tracked separately — Python bake-time decode first, browser decoder for endpoint mode later).
