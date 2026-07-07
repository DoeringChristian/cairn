# WS-PYAPI — implementation report

**Scope:** the Python card/report API — `Run.__getitem__` lazy data handles,
`cairn.plot` element builders, the notebook display protocol
(`_repr_html_`/`_repr_mimebundle_` -> `/embed/card`), and `cairn.Report` as a
notebook-only container. Design spec: `docs/superpowers/specs/
2026-07-07-notebook-python-and-embed.md` (WS-PYAPI section + §11 addendum).

**Branch:** `feature/ws-pyapi` (STOP-at-branch; no merge to main).
**Base:** `ec4bb6f5` (confirmed at STEP 0 — has WS-SCHEMA `card_spec.py` +
WS-EMBED `/embed` route).

**Commits:**
- `ab8a1d75` — `Run.__getitem__` / `DataRef` lazy handle (reader.py)
- `27cdc915` — `cairn.plot` element builders + `cairn/sdk/elements.py`
  display-protocol base classes
- `ac443597` — `cairn.Report` (inline-only notebook container)
- `fff66f39` — marimo example wired to the real API

---

## 1. `Run.__getitem__` / `DataRef` (`cairn/sdk/reader.py`)

`run[tag]` returns `DataRef(run, tag, step=None)` — a frozen dataclass that
does **not** touch the backend at construction time (asserted directly in a
test via `monkeypatch` raising `AssertionError` from `get_sequence`/
`list_sequences`/`list_artifacts`). Optional step indexing `run[tag][step]`
returns a new, narrowed `DataRef` (immutable — the original is unaffected).

- `.resolve()` — eager fetch: tries `Run.artifact(tag, step=step)` first,
  falls back to `Run.sequence(tag)` (optionally indexed by step) — reuses
  the existing reader methods verbatim, no new fetch path.
- `.context_hash()` — resolves the `(name, context_hash)` a `SeriesRef`
  needs via the existing `Run.sequences()`; `""` (the "no context"
  sentinel) if the tag isn't a tracked sequence.

No new run-access surface — both methods are thin wrappers over
`Run.sequence`/`Run.artifact`/`Run.sequences()`.

## 2. `cairn.plot` element builders (`cairn/plot.py`, extended)

Grew the **existing** `cairn.plot` module (no new `cairn.image`/`cairn.card`
namespace) with builders that take DATA, not run+metric coordinates:

- Single-view: `scalar`, `image`, `figure`, `table`, `mesh`, `pointcloud`,
  `volume`, `boxes` (-> card type `"boxes3d"`).
- Compare: `media_compare(a, b, mode="side"|"split"|"blend"|"diff",
  card_type="image")` + typed sugar `image_compare`/`mesh_compare`/
  `pointcloud_compare`/`volume_compare`/`boxes_compare`.

Each `run[tag]`-backed call builds one `CardSpec` via
`cairn.sdk.card_spec.CardSpec`/`SeriesRef`/`CardSettingsSpec` — pydantic
construction **is** the schema validation (invalid `type`/extra fields raise
`ValidationError` at build time, same models WS-SCHEMA's conformance test
pins against `docs/schemas/cairn-card-spec.schema.json`) — and returns a
server-backed `CardElement`. `media_compare`/`*_compare` set two `series` +
`settings.mode` ("compare" sugar); a `DataRef` step becomes `settings.step`.
`cardFromSpec` (TS) stays the only interpreter — the builders never emit
anything but a validated spec dict.

**Raw-media deferral (WS-INLINE):** `image`/`mesh`/`pointcloud`/`volume`/
`boxes`/`media_compare` require `DataRef` sources — a `SeriesRef` is
inherently `(runId, name, context_hash)`, a pointer into server-tracked
data, and the schema has no inline-data variant. Passing raw
`np.ndarray`/bytes/PIL data raises a clear `NotImplementedError` naming
WS-INLINE and the design spec section, rather than doing something silently
wrong. `scalar`/`figure`/`table` are the three exceptions: they accept raw
data too and fall back to a self-contained `HtmlElement` (`line_series(...)
.to_html()` for scalar, a bare plotly `Figure.to_html()` for figure, a
duck-typed `.to_html()`/dependency-free HTML table for table) — no server
round trip.

## 3. Display protocol (`cairn/sdk/elements.py`, new)

- `Element` — base class: `_repr_html_` (abstract) + `_repr_mimebundle_`
  (wraps it; picked up by both Jupyter and marimo).
- `HtmlElement` — wraps a self-contained HTML string. Never touches a
  server.
- `CardElement` — wraps a validated card-spec dict.
  `_resolve_server()`: an explicit override or a non-local
  `config.resolve_target()` (e.g. `cairn://host:port`) is trusted without a
  probe (same posture as `Transport`/`_HttpBackend`); a plain local repo
  path gets a fast (`0.5s` timeout) `/api/health` probe of
  `config.resolve_server()`'s default candidate — the "is `cairn ui`
  actually running" check the design spec's `file://`-mode caveat calls
  for. If reachable: `POST /api/embed/specs` (WS-EMBED, Bearer token via
  `config.resolve_token`) -> `sid` -> `<iframe
  src="{server}/embed/card?sid={sid}">` with the `cairn:resize`
  auto-height listener (same postMessage protocol
  `use-iframe-auto-height.ts`/`PluginCard` use). If not reachable: an inline
  `<pre>` notice (still valid `_repr_html_`) with the spec JSON — the
  degradation contract from design spec §5 (no exception, something renders
  in every environment).

## 4. `cairn.Report` (`cairn/sdk/report.py`, new) — **inline-only, no server push**

**Design decision, mid-implementation (coordinator, after clarifying with
the user):** `Report.publish()` and all reports-API integration were
**dropped entirely** — the notebook itself is the report; there is no
separate cairn-server report object, no dup-report risk, no new persistence
path. `Report(name=, project=)` is a plain notebook-display object:
`.md(text)` appends a markdown block, `.add(element)` appends any element
(a `cairn.plot` `Element`, or a bare plotly `Figure` — duck-typed via
`to_html`). `_repr_html_`/`_repr_mimebundle_` concatenate every block in
order — markdown via a small, deliberately minimal dependency-free
CommonMark subset (headers/paragraphs/bold/italic/code/bullet lists; no
`markdown`/`mistune` dependency added), each element via its own display
protocol. Sharing = sharing the notebook (or its native Jupyter/marimo HTML
export).

(The original task brief specified a `publish()` reusing the reports route
— that was superseded mid-task by an explicit coordinator decision; nothing
here posts to `/api/projects/{id}/reports`.)

## 5. Marimo example (`examples/marimo_cairn_demo.py`)

Replaced the commented-out "🚧 Coming soon" sketch with real code: queries
two runs from the `plot-helpers-demo` project, builds
`cairn.plot.media_compare(run_a["eval.predictions"],
run_b["eval.predictions"], mode="diff")` and a `cairn.Report(...).md(...)
.add(el)`, guarded to fall back to a plain `mo.md(...)` notice when fewer
than 2 runs exist. Fixed the spec-doc reference (was pointing at the
superseded `2026-07-05-notebook-reports.md`).

**Verified via `marimo export html`** against a repo freshly seeded by
`examples/demo_plot_helpers.py` (2 real runs): export exits 0, the report
section renders with the real run names ("Ablation study" present, not the
"need 2 runs" fallback), and the `CardElement` correctly degrades to its
"no reachable cairn server" text (no `cairn ui` running during the export).

## Tests

- `tests/unit/test_reader_dataref.py` (8) — laziness (mocked backend calls
  raise if touched by `run[tag]` construction), step indexing/immutability,
  type guards, `.resolve()` for both a plain step and a full sequence,
  `.context_hash()` known/unknown tag, `repr`.
- `tests/unit/test_plot_elements.py` (30) — every builder emits a
  schema-valid `CardSpec` (round-tripped through `CardSpec.model_validate`
  and composed into a `CardsSpec` fence-root, proving no card-spec fork);
  `media_compare`/typed `*_compare` set two series + `settings.mode`;
  invalid mode rejected; `DataRef` step -> `settings.step`; raw media on
  every single-view/compare builder raises `NotImplementedError` matching
  `"WS-INLINE"`; `scalar`/`figure`/`table` raw fallback -> `HtmlElement`
  with real content (plotly HTML / html table); `figure()` rejects a
  non-Figure raw arg; `CardElement._repr_html_` — no-server fallback text
  (server forced unreachable via a monkeypatched dead address) AND a live
  iframe against the real `live_server` fixture (real uvicorn thread) whose
  `sid` was confirmed to resolve via `GET /api/embed/specs/{sid}`;
  `_repr_mimebundle_` matches `_repr_html_`.
- `tests/unit/test_report.py` (10) — empty report, markdown rendering
  (headers/bold/italic/code/lists), `.add()` of a `CardElement` (no-server
  fallback text present), an `HtmlElement`, and a bare plotly `Figure`;
  block order preserved (`md`/`element`/`md`); `_repr_html_` concatenates
  in order (name -> block1 -> block2 -> block3, asserted via string
  `.index()` ordering); `_repr_mimebundle_` matches `_repr_html_`.

Total new: 48 tests, all passing.

## Gates

- `uv run --extra dev pytest tests/unit` — **15 failed (pre-existing
  baseline, unchanged: test_cli / test_config / test_config_target /
  test_local_transport — all environmental, none touch WS-PYAPI code), rest
  passed**, including all 48 new tests. No new failures.
- No ruff/mypy config exists anywhere in the repo (checked `pyproject.toml`,
  searched for `ruff.toml`/`mypy.ini`/pre-commit config) — lint/type gate
  skipped per instructions (none exists to run).

## End-to-end smoke (real server)

Seeded a throwaway repo (`cairn init` + a `cairn.Run` with a `loss` scalar,
5 steps), started `cairn ui --repo <scratch>/.cairn --port 4411 --no-auth`,
then in a live Python process pointed `cairn.Reader(repo="cairn://
127.0.0.1:4411")` at it:

- `run = reader.runs(project="smoke").last()` -> found the real run.
- `el = cairn.plot.scalar(run["loss"])` -> `el._repr_html_()` contains
  `<iframe id="cairn-embed-<sid>" src="http://127.0.0.1:4411/embed/card
  ?sid=<sid>" ...>`.
- `curl http://127.0.0.1:4411/api/embed/specs/<sid>` -> 200, returns the
  exact spec (`{"type":"scalar","series":[{"runId":"<run>","name":"loss",
  "context_hash":""}]}`).
- `curl http://127.0.0.1:4411/embed/card?sid=<sid>` -> 200.
- `cairn.Report(name="Smoke report", project="smoke").md(...).add(el)
  ._repr_html_()` contains the same live iframe plus the markdown heading.
- Server killed; throwaway repo removed (scratchpad only, no pre-existing
  data touched — DELETE-SAFETY honored).

(The original brief's smoke step ended in `Report(...).add(el).publish()`
-> verify via reports API; that step no longer applies since `publish()`
was dropped per the mid-task decision above — the smoke test instead
verifies `Report._repr_html_()` renders the element correctly, which is
the surface that replaced it.)

---

## Report back (coordinator)

- **Base check:** confirmed `ec4bb6f5` at STEP 0 (not stale).
- **Commit SHAs:** `ab8a1d75` (DataRef), `27cdc915` (plot builders +
  elements.py), `ac443597` (Report), `fff66f39` (marimo example).
- **API surface added:** `Run.__getitem__` -> `DataRef` (reader.py);
  `cairn.plot.{scalar,image,figure,table,mesh,pointcloud,volume,boxes,
  media_compare,image_compare,mesh_compare,pointcloud_compare,
  volume_compare,boxes_compare}`; `cairn.sdk.elements.{Element,HtmlElement,
  CardElement}`; `cairn.Report` (exported at top level).
- **Reuse (no forks):** `Run.sequence`/`Run.artifact`/`Run.sequences()`
  (reader) unchanged, only wrapped; `cairn.sdk.card_spec.CardSpec` (WS-
  SCHEMA) is the only spec model used — construction *is* the validation;
  `POST/GET /api/embed/specs` + `GET /embed/card` (WS-EMBED) are the only
  render path — `cardFromSpec` stays the sole interpreter; **no** reports-
  route usage (see decision in §4 — `publish()` was dropped, not merely
  deferred).
- **Display-protocol behavior:** server-backed `CardElement` -> live
  `/embed/card?sid=` iframe when a server is reachable (explicit config
  trusted; local-repo default probed with a 0.5s `/api/health` timeout),
  else an inline text fallback (never raises). Raw plot data
  (`figure`/`scalar`/`table`) -> self-contained Plotly/HTML, no server ever
  needed.
- **Raw-media deferral:** `image`/`mesh`/`pointcloud`/`volume`/`boxes`/
  `media_compare` on non-`DataRef` input raise `NotImplementedError`
  naming WS-INLINE (design spec §6.3) — no inline-data card variant exists
  in the schema yet.
- **`cairn.Report`:** inline-only per the coordinator's mid-task decision —
  no `publish()`, no server push, no reports-route reuse; purely a
  notebook display container.
- **Tests:** 48 new (8 DataRef + 30 plot/elements + 10 Report), all green;
  baseline 15 pre-existing failures unchanged, no new failures.
- **Smoke:** real `cairn ui --no-auth` server, real run, live iframe with a
  sid that resolves via `/api/embed/specs/{sid}` and `/embed/card`
  confirmed by curl; `Report.add(el)._repr_html_()` contains the same
  iframe. Server killed, scratch repo removed.
- **Gates:** pytest green (baseline-only failures); no lint/type config
  exists in the repo to run.

STOP at branch `feature/ws-pyapi` (no merge to main — shared checkout,
review gate).

## MERGE LOG (merge agent M-PYAPI, 2026-07-07)

- **Merge:** `git merge feature/ws-pyapi` from main tip `ec4bb6f5` was a
  clean **fast-forward** to `c928a012` (5 commits, Python-only, disjoint
  from prior UI/dist work — no conflicts).
- **Docstring fix:** `cairn/sdk/elements.py`'s module docstring referenced
  `_resolve_series_ref`; the real function is `_resolve_series` (in
  `cairn/plot.py`). Fixed and committed as `9e6aaf80` ("Fix stale function
  name in elements docstring").
- **Gates:** `uv run --extra dev pytest tests/unit` — 487 passed, 15
  failed, 3 skipped. The 48 new WS-PYAPI tests (`test_plot_elements.py`,
  `test_reader_dataref.py`, `test_report.py`) all pass in isolation too.
  The 15 failures are the pre-existing baseline, same files as before
  (`test_cli.py`, `test_config.py`, `test_config_target.py`,
  `test_local_transport.py`) — no new failures introduced.
- **Live server:** started `cairn ui --repo .cairn --port 4301 --no-auth`;
  health OK. Seeded `examples/demo_image_comparison.py` (10 runs: baseline
  + 9 distortion variants, project `image-comparison-demo`) giving a real
  image metric (`output`) plus scalar metrics (`quality.mae`,
  `quality.psnr`) to test against.
- **(a) Element -> embed round-trip:** confirmed live. `cairn.plot.scalar(run["quality.mae"])._repr_html_()`
  produced a real `<iframe src=".../embed/card?sid=...">`; `GET
  /api/embed/specs/<sid>` returned 200 with the matching spec.
  `cairn.Report().add(el)._repr_html_()` contains the identical iframe.
  Browser-opened the scalar sid at `/embed/card?sid=...` — renders a
  correct single-series line chart (flat 0 line for baseline `quality.mae`,
  as expected). Console clean.
- **(b) media_compare — IMPORTANT FINDING, renderer does NOT fully honor
  `settings.mode`:** built
  `cairn.plot.media_compare(runA["output"], runB["output"], mode="diff")`
  (and `mode="side"`), fetched each spec's sid, and opened both in the
  browser at `/embed/card?sid=...`.
  - `mode="side"` renders correctly: two labeled panels ("baseline" /
    "brightness-up") side by side.
  - `mode="diff"` does **not** render a pixel-diff. It renders identically
    to `side`/`normal` — two unmodified panels, no diff computed — even
    though the settings panel's "Compare > Mode" dropdown does read
    "diff". Root-caused via `cairn/ui/src/components/VisualContentCard.tsx`
    and `cairn/ui/src/components/card-kit/use-media-reference.ts`: `diff`/
    `split`/`blend` modes require a resolved **reference/baseline** per
    pane, sourced from `settings.baselineIndex` (an index into the card's
    own `series` picking which one is the diff baseline) or an
    `externalBaseline`. `cairn.plot.media_compare()` (`cairn/plot.py:702-721`)
    only sets `series` (2 entries) + `settings.mode` — it never sets
    `settings.baselineIndex`. With no reference resolved, `globalHash` is
    `undefined` for every pane (`use-media-reference.ts:121-133`), so the
    diff pipeline has nothing to diff against and silently falls back to
    showing each pane's raw image — visually indistinguishable from `side`.
    **Fix needed:** `media_compare()` must also emit `settings.baselineIndex`
    (e.g. `1`, pointing at `series[1]` as the reference for `series[0]`, or
    vice versa depending on the intended semantics) whenever `mode` is
    `"diff"`/`"split"`/`"blend"`. `mode="normal"`/`"side"` need no baseline
    and are unaffected.
  - Separately confirmed: this is **distinct** from a second, real bug in
    the WS-EMBED `/embed/card` entry point
    (`cairn/ui/src/embed-main.tsx`'s `EmbeddedCard`): it never calls
    `saveCardSettings` with the fetched spec's `settings` before
    `CardRenderer` mounts (contrast `CairnFenceCard.tsx:121-133`, which
    does), so on a **fresh** page load the Mode dropdown always shows
    `"normal"` regardless of what the spec's `settings.mode` says — the
    spec-provided mode is silently dropped. This is a WS-EMBED gap on top
    of the WS-PYAPI `baselineIndex` gap above; both need fixing for
    `media_compare(mode="diff")` to render correctly out of the box.
  - Console clean throughout (no JS errors on either card).
- **Auth-on caveat:** confirmed via `cairn/server/embed_specs.py`'s own
  docstring — `/api/embed/specs` and `/embed/card` sit behind the same
  `require_role("read")` dependency as other `/api` routes, so `--no-auth`
  is unaffected and auth-on isn't weakened; a `sid` alone is not yet an
  unguessable cross-origin capability token (documented `TODO(remote-embed)`,
  deferred). Reasoning-only check, nothing built.
- **Cleanup:** worktree `.claude/worktrees/ws-pyapi` was clean (no
  node_modules symlink present, only gitignored `.tsbuildinfo` files) and
  removed via `git worktree remove`. No stray auto-branch existed beyond
  `feature/ws-pyapi`, which was kept. Server left running at
  `:4301 --no-auth`. Scratch verification script lived only under the
  session scratchpad dir (never touched the repo). Seeded demo runs in
  `.cairn` were left in place (additive test data, not a report/comparison,
  not deleted).

**Because of the media_compare finding above, do NOT consider WS-PYAPI's
`media_compare`/`image_compare`/`mesh_compare`/etc. builders fully done for
`diff`/`split`/`blend` modes** — a follow-up fix round is needed for
`cairn/plot.py`'s `media_compare()` to set `settings.baselineIndex`, and
optionally a separate WS-EMBED fix for `embed-main.tsx` to seed
`saveCardSettings` from the fetched spec on load.
