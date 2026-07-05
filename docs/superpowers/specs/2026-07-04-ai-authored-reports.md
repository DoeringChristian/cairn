# Design: AI-authored reports (markdown dialect + executable cards + BYO-AI)

Date: 2026-07-04. Author: architecture research pass (read-only).
Status: DESIGN — no code written. Supersedes nothing; extends the merged Reports
epic (WS-RC / WS-RX, see `.superpowers/sdd/spec-reports.md`).

## 0. TL;DR

- **Dialect**: GFM markdown (already rendered by `lib/markdown.tsx`) **plus a fenced
  ` ```cairn ` code block** whose body is a **declarative YAML/JSON card spec** — NOT
  an imperative JS API. The spec compiles 1:1 to the existing `CardsBlock`
  (`runs` + `cards[]` + inline `settings`). No `eval`, so no new sandbox.
- **Execution/security**: the ` ```cairn ` interpreter runs on the **main thread** as a
  trusted parser producing `ComparisonCard[]`, rendered by the **existing** `CardRenderer`.
  There is no untrusted-code trust boundary to defend — it's the same safety tier as the
  block editor and `MarkdownCard` (raw HTML stays escaped). Arbitrary JS remains confined
  to the **existing** `PluginCard` `<iframe sandbox="allow-scripts">` escape hatch.
- **Dual authoring unified**: **markdown-with-` ```cairn `-fences is the canonical
  serialization**; `blocks[]` (the cells model) is a lossless *view* over it. One
  `parse ⇄ serialize` pair (`lib/reports/markdown-source.ts`) bridges them. Card
  **settings move inline into the fenced spec** so the markdown is self-contained.
- **Ingestion**: one funnel — a markdown string → `POST /reports`. Exposed as SDK
  `cairn.Report(md)` / `run.log_report(md)`, CLI `cairn report add file.md`, and UI
  drag-drop. Mirrors the `cairn.Markdown` wrapper + `token`-group CLI patterns.
- **Export**: canonical `.md` (live, re-renders anywhere) via the serializer; frozen
  `.html`/`.pdf` snapshot by rasterizing each card with `download.ts` primitives.
- **AI**: client-side, **provider-agnostic** (bring-your-own endpoint + key, stored
  client-only). The model is handed the runs/metrics context + the ` ```cairn ` grammar,
  and **streams the markdown dialect into the editor**. Its cards run through the same
  declarative interpreter as human-authored ones — zero new trust surface.

---

## 1. What exists today (the reuse surface)

Grounding cites (working tree, not `.claude/worktrees/*`):

### Reports data model & pages
- Server: `reports` table (`storage/migrations.py`), CRUD in `server/routes/reports.py`.
  `POST/PUT` bodies are `{name, payload: dict}`; payload is opaque JSON (`_parse_payload`
  just `json.loads`, no validation). `POST/PUT/DELETE` require `auth.require_role("write")`
  (`reports.py:25,94,107,133`).
- Payload schema (`ui/src/lib/reports/types.ts`):
  `ReportPayload { blocks: ReportBlock[]; cardSettings?; runSelector? }`,
  `ReportBlock = MarkdownBlock{id,type:"markdown",text} | CardsBlock{id,type:"cards",title?,runIds?,runSelector?,cards: ComparisonCard[]}`.
- `ComparisonCard{id,type,series: ComparisonSeriesRef[]}` and
  `ComparisonSeriesRef{runId,name,context_hash}` reused verbatim from
  `lib/comparisons/types.ts`. `MULTI_RUN_CARD_TYPES = [parallel,scatter,bar,tile]`.
- Editor/viewer: `pages/ReportEditorPage.tsx` (block list, add/move/delete, debounced
  autosave `AUTOSAVE_DELAY_MS=1500`, view/edit toggle). List: `pages/ReportsListPage.tsx`.
- `components/reports/ReportCardsBlock.tsx` — **the key reuse point**: its `onAddCard`
  (`:108-127`) maps an `AddCardSelection` → `ComparisonCard`, and its inner
  `ReportCardRenderer` (`:352-409`) maps a `ComparisonCard` → a `CardRenderer` descriptor
  (multi-run vs. series branch on `isMultiRunCardType`, settings via
  `cardSettingsKeyForReport`). This is exactly the transform the ` ```cairn ` interpreter
  must reproduce — so we extract it, not re-implement it.
- `components/reports/ReportMarkdownBlock.tsx` — side-by-side textarea + live preview via
  the shared `<Markdown>`.
- Settings side-channel: `lib/reports/payload.ts` `buildReportPayload` (gather from
  localStorage on save) / `restoreReportCardSettings` (write to localStorage on load);
  keyed by `cardSettingsKeyForReport(reportId, card)` → `cardSettingsKeyForScope`
  (`lib/comparisons/types.ts:111`).

### Run-set binding
- `lib/run-selector.ts`: `RunSelector = {kind:"static",runIds} | {kind:"query",namePattern?,tags?,mode:"latest-n"|"newest-per-name",n?}`; pure `resolveRunSelectorFromRuns(sel,runs)`; live `useRunSelectorResolution` (`api/hooks.ts`) with `staleTime` + refetch-on-focus + `refresh()`.
- `lib/comparisons/rebuild-cards.ts` `rebuildCardsFromRuns(runIds)` — fetch each run's
  sequences, group same-named series into one card per `(name, object_type)`.

### Rendering & markdown
- `components/CardRenderer.tsx` — one dispatch for all card types (`CardDescriptor`
  discriminated union; `switch(metric.object_type)`; heavy/untrusted cards `React.lazy`).
  Object types handled: scalar, image, figure, audio, video, histogram, tensor, text,
  table, html, markdown, artifact, pointcloud, mesh, boxes3d, volume, plugin.
- `lib/markdown.tsx` — `<Markdown>` = `<ReactMarkdown remarkPlugins={[remarkGfm]}
  components={MD_COMPONENTS}>`. **Sanitization contract: no rehype-raw, raw HTML stays
  escaped as inert text. Do not add rehype-raw.**
- Media-compare reference model (`lib/cairn-plot/media-compare/reference.ts`) is a **card
  setting** (`ReferenceSelection{source,seriesIndex?,fixedStep?,externalScope?}`), read
  through the card-settings store — so "reference/diff" is expressible as inline `settings`.

### Sandbox precedent (for the arbitrary-code escape hatch only)
- `HtmlCard.tsx`: `<iframe sandbox="allow-scripts" srcdoc=…>` (opaque origin, no
  `allow-same-origin`), `cairn:resize` postMessage (`protocolVersion:1`, "receivers MUST
  ignore unknown fields"), host validates by `e.source === iframe.contentWindow`
  (`card-kit/use-iframe-auto-height.ts:42`), not by origin.
- `PluginCard.tsx`: same JS-in-`allow-scripts`-iframe sandbox + a `cairn:render` host→frame
  message (ArrayBuffer transfer). **Known weaker boundary**: the Pyodide/Python path gets
  a Blob-URL `src` and **no** `sandbox` attribute — cite as the "don't do this for
  untrusted authors" precedent.

### SDK / CLI / export
- `sdk/wrappers.py`: `_TypeWrapper{object_type,obj,kwargs}`; `Markdown(object_type="markdown")`
  is the template. Handler contract in `handlers/markdown.py` (`serialize→(bytes,meta)`,
  `mime_type="text/markdown"`, `can_handle→False` = wrapper-only). `run.track()` uploads
  the blob via `transport.upload_artifact` → `POST /api/artifacts`.
- CLI `cli.py`: Click group; `token` sub-group (`:741`) is the template for a new
  `report` group; `export_cmd`/`rm_cmd` are the HTTP-client templates (`_client()` →
  `Transport.post_json`).
- `download.ts`: `downloadBlob`, `downloadCsv`, `serializeSvg`, `svgToRasterBlob`
  (SVG→PNG via canvas), `exportChartFromContainer`, `exportImagesAsComposite`,
  `exportPlotlyChart`. `MIME_EXT` maps `text/markdown→.md`, `text/html→.html`. **No PDF
  lib today** (`format:"pdf"` degrades to SVG).
- `import_export.py`: runs-only ZIP bundle; reports/comparisons are NOT in it.

---

## 2. Part A — The report markdown dialect

### 2.1 Decision: declarative, not imperative

The block body is a **declarative YAML document** (JSON accepted too), not a JS program.
Rationale (the prompt asks to "lean toward whichever minimizes duplication and risk"):

| Axis | Declarative ` ```cairn ` (chosen) | Imperative ` ```cairn-js ` (rejected for v1) |
|---|---|---|
| Duplication | Compiles to the *existing* `CardsBlock`/`ComparisonCard`; renders through the *existing* `CardRenderer`. Zero new render path. | Needs a JS API surface, a runtime, and a bridge back to `CardRenderer` — a parallel world. |
| Security | No code executed → no XSS/exfil surface beyond today's block editor (which has none). | Untrusted JS → mandatory `iframe` sandbox, postMessage marshaling of card data, CSP. |
| AI emission | LLMs emit small YAML reliably; trivially validatable/repairable. | LLM must emit correct JS against a bespoke API; harder to validate, easier to break. |
| Covers the user's 3 examples? | Yes (all 3 are just cards with different `type`/`runs`/`settings`). | Yes, but with far more machinery. |
| Round-trip to blocks | Lossless (spec ⇄ `CardsBlock`). | Lossy (a program isn't a static block). |

The imperative path is kept **only** as the existing `PluginCard` (a card type, logged or
authored) — the sanctioned home for arbitrary JS/Python. A future ` ```cairn-js ` could
route through that same iframe if ever needed; explicitly out of scope for v1.

### 2.2 The ` ```cairn ` block grammar

A fenced block ` ```cairn ` … ` ``` ` whose body is YAML with this schema (one block =
one `CardsBlock`):

```yaml
# runs: the block's run set — mirrors CardsBlock.runIds / runSelector 1:1
runs:
  # exactly one of:
  ids: [run_abc123, run_def456]          # → CardsBlock.runIds (static)
  # selector: { mode: newest-per-name, namePattern: "train-*", tags: [prod], n: 5 }
  #                                       → CardsBlock.runSelector (query)

title: "Validation metrics"               # → CardsBlock.title (optional)

cards:
  - metric: train/loss                    # series card: type inferred from the metric's
    type: scalar                          #   object_type; `type` optional if unambiguous
    settings: { yScale: log, smoothing: 0.6 }   # inline → card-settings store
  - metric: val/accuracy                  # type omitted → resolved from sequences
  - type: parallel                        # multi-run card: no `metric`, keys on type
  - metric: samples                       # image card with a reference/diff baseline
    type: image
    settings: { reference: { source: series-same-step, seriesIndex: 0 } }
```

Field → existing-model mapping (the "mirror" the prompt demands — each binds to a named
function):

| Dialect field | Compiles to | Existing function it reuses |
|---|---|---|
| `runs.ids` | `CardsBlock.runIds` | (identity) |
| `runs.selector` | `CardsBlock.runSelector` (`QueryRunSelector`) | `resolveRunSelectorFromRuns` / `useRunSelectorResolution` |
| `cards[].metric` + `.type` (series) | `ComparisonCard{id:newId(),type,series: runIds.map(...)}` | the `onAddCard` "series" branch (`ReportCardsBlock.tsx:120-126`) → extract to `cardFromSpec` |
| `cards[].type` (no metric, multi-run) | `ComparisonCard{type, series:[]}` | the `onAddCard` "multi-run" branch |
| `cards[].series` (explicit overlay) | `ComparisonCard.series` verbatim | the `onAddCard` "manual-series" branch |
| `cards[].settings` | write under `cardSettingsKeyForReport(reportId, card)` | `saveCardSettings` / `loadCardSettings` |
| type inference (metric→object_type) | look up in the block's fetched sequences | the metric-union scan in `AddCardModal.tsx:117-166` → extract to `metricIndex(runIds)` |

The interpreter is one pure-ish function:
`compileCairnBlock(spec, metricIndex) → CardsBlock` (+ a settings map). It never produces
markup, only data.

### 2.3 Three concrete examples

**(a) A metric plot across a dynamic RunSelector** (the user's "always newest N" case):
```cairn
runs:
  selector: { mode: newest-per-name, namePattern: "train-*", n: 5 }
cards:
  - { metric: train/loss, type: scalar, settings: { yScale: log } }
  - { metric: val/accuracy, type: scalar }
```
→ a `CardsBlock` with `runSelector`, resolved live via `useRunSelectorResolution`; the
"auto" badge + refresh behave exactly as today.

**(b) An image comparison with a per-run diff baseline**:
```cairn
runs: { ids: [run_a, run_b] }
cards:
  - metric: prediction
    type: image
    settings: { reference: { source: external, externalScope: per-run } }
```
→ `ImageGalleryCard` reads `settings.reference` (`ReferenceSelection`) through the same
media-compare machinery it uses today.

**(c) A from-comparison embed** — "drop comparison X in here":
```cairn
from_comparison: 7a485538f69ca475     # optional convenience: expand a saved comparison
```
→ the interpreter fetches the comparison payload (`api.comparison`) and expands it into a
`CardsBlock` (its `cards` + resolved `runIds` + settings copied via
`cardSettingsKeyFor → cardSettingsKeyForReport`) — reusing the exact copy logic already in
ComparePage's `handleCreateReport` (`ComparePage.tsx:829-878`), extracted to a shared
`reportBlockFromComparison(cmp)`.

---

## 3. Part B — Execution model & security

### 3.1 Where/how blocks execute
On the **main thread**, at render time, via `compileCairnBlock`. A ` ```cairn ` block in a
markdown source is intercepted by a **custom react-markdown `code` component** (registered
in a *report-specific* extension of `MD_COMPONENTS` — the base `MD_COMPONENTS` stays
untouched to preserve the `MarkdownCard` byte-identical contract): when
``className === "language-cairn"``, instead of rendering a `<pre><code>`, it parses the body
and renders `<ReportCardsBlock>` (or an inline error card). All other code fences render as
today's escaped ` <pre> `.

### 3.2 Trust boundary
There is **no untrusted-code execution**. The interpreter accepts a fixed schema; unknown
keys are ignored (`protocolVersion`-style forward-compat, mirroring the "receivers MUST
ignore unknown fields" rule); no string in the spec ever becomes HTML or JS. Card data is
fetched through the same authenticated `/api/*` client the UI already uses. Therefore:

- **XSS**: impossible via ` ```cairn ` (no markup emitted) and impossible via prose (no
  rehype-raw — `<script>` stays inert text).
- **Exfiltration**: the block can only *read* project data the user can already see; it
  cannot issue arbitrary network calls (no `fetch` exposed).
- **AI-authored == human-authored**: identical parser, identical ceiling.

The **only** place arbitrary code runs is a `PluginCard` (JS in `<iframe
sandbox="allow-scripts">`, opaque origin). That boundary is unchanged and is the sanctioned
escape hatch. We do **not** adopt the Pyodide path's weaker (no-`sandbox`) pattern for
report authoring.

### 3.3 Inline rendering, errors, reactivity
- **Inline**: a compiled ` ```cairn ` block renders in document flow exactly where the
  fence sits, via `ReportCardsBlock` — same cards, same live data hooks, as the cells editor.
- **Per-block errors**: parse/validation failures render an inline **error card** (a red
  banner with the YAML line + message), never crash the report or sibling blocks. Mirrors
  the iframe precedent of "errors always rendered as inert content."
- **Reactivity**: a block with `runs.selector` re-resolves via `useRunSelectorResolution`
  (short `staleTime`, refetch-on-focus) and its "refresh" rebuilds cards via
  `rebuildCardsFromRuns` — the existing WS-RX behavior, unchanged.

---

## 4. Part C — Dual authoring, unified

### 4.1 One model, two views
**Recommendation: markdown-with-` ```cairn `-fences is the canonical serialization; the
`blocks[]` cells model is a lossless structured view over it.**

- `MarkdownBlock` ⇄ a prose region between fences.
- `CardsBlock` ⇄ one ` ```cairn ` fenced block.

A single bidirectional module `lib/reports/markdown-source.ts`:
- `serializeReportToMarkdown(blocks, settings) → string` — prose blocks emit their text;
  cards blocks emit a ` ```cairn ` fence built from `runIds`/`runSelector` + `cards` +
  **inlined** per-card `settings`.
- `parseReportMarkdown(md) → { blocks, settings }` — split the doc on top-level ` ```cairn `
  fences; each fence → `CardsBlock` (via `compileCairnBlock`), each inter-fence region →
  `MarkdownBlock`.

Both editor surfaces mutate the **same in-memory `blocks[]`**; the markdown-source editor
is just `blocks ⇄ md` on the fly. No second state machine, no second renderer.

### 4.2 Canonical storage — the key reconciliation
Today settings live in a side-channel (`payload.cardSettings` + localStorage). For markdown
to be **self-contained** (needed for SDK ingestion, AI emission, and export where there is
no localStorage to seed), **card settings move inline into the ` ```cairn ` spec**. On load,
the interpreter writes inlined settings into the card-settings store under
`cardSettingsKeyForReport` (via `saveCardSettings`) so **existing card components read
settings unchanged**; on save, `buildReportPayload` reads them back (via `loadCardSettings`)
and the serializer inlines them. `payload.cardSettings`/localStorage becomes a *derived
cache*, not the source of truth.

### 4.3 Persistence: incremental, no migration
- **Short term (recommended):** keep `payload.blocks` as the persisted DB shape (no
  migration, all existing code keeps working) **and** add `payload.source` (the canonical
  markdown string) written alongside on every save. When `payload.source` is present it is
  authoritative; `blocks` is the parse cache. SDK/AI/export/import all speak `payload.source`.
- **Later (optional):** flip to `source`-only storage and drop `blocks` from the payload
  once every read path parses source. Flagged as an open question (§9), not required for v1.

This makes "pure-markdown reports" and "the cells editor" the same document, editable from
either end, with markdown as the portable interchange form.

---

## 5. Part D — Inline markdown preview

- Reuse `lib/markdown.tsx`'s `<Markdown>` for prose (already the live-preview engine in
  `ReportMarkdownBlock`).
- The **markdown-source editor** (new view) is a full-document textarea + a live preview
  pane that runs the *same* `parseReportMarkdown → render` pipeline the viewer uses, so
  ` ```cairn ` blocks preview as **live cards** (executed, not placeholders) — because
  execution is safe and cheap (no sandbox spin-up). Debounce parsing (~300 ms) so typing
  inside a fence doesn't thrash card fetches; while a fence is syntactically incomplete,
  show the last good render or a compact "editing card spec…" placeholder for that block
  only.
- A view toggle in `ReportEditorPage`: **Cells** (existing block editor) ⇄ **Markdown**
  (source editor) ⇄ **Preview/View** (read-only). All three are views over one `blocks[]`.

---

## 6. Part E — Ingestion (markdown file → report)

**One funnel:** a markdown string → `POST /api/projects/{id}/reports` with
`{name, payload: {source: md, blocks: parseReportMarkdown(md).blocks}}`. Recommended
entry points, all mirroring existing patterns:

1. **SDK — `cairn.Report(md, name=...)` / `run.log_report(md)`** (primary).
   - Decision: a report is a **first-class document** (the `reports` table), *not* a
     per-step blob artifact. So `cairn.Report` does **not** go through the `_TypeWrapper` /
     `run.track` blob path (that's for `cairn.Markdown`, a logged artifact — a different
     storage model, called out by the ingestion research). Instead `cairn.Report` posts to
     the reports route.
   - Because parsing markdown→blocks is TS-only, the **SDK sends `payload={source: md}`**
     and lets the UI parse on load (the server stores opaque JSON; `block_count` in the
     list view degrades to 0 until first UI open, or the SDK sends a trivial single
     `MarkdownBlock` fallback so `block_count` is sane without a Python parser). This avoids
     duplicating the parser in Python — the single biggest anti-duplication call in
     ingestion.
   - Auth: `POST /reports` needs `require_role("write")`; the SDK transport already carries
     the token used by `cairn export`/`cairn login`.
2. **CLI — `cairn report add FILE.md --project P [--name N]`**. Add a `@main.group("report")`
   (mirror the `token` group, `cli.py:741`) with `add` (+ later `list`/`rm`). Body reads the
   file, `_client().post_json(...)` to the reports route (template: `export_cmd`).
3. **UI drag-drop / "Import report"** on `ReportsListPage`: read the dropped `.md` file
   text → `api.createReport(projectId, stem, {source})` → navigate to the editor. Mirrors
   the existing `importRuns` FormData affordance.

All three converge on the same `{source}` payload — no per-channel logic.

---

## 7. Part F — Export / save

- **Canonical `.md` (live)**: `serializeReportToMarkdown(blocks, settings)` →
  `downloadBlob(new Blob([md], {type:"text/markdown"}), name+".md")`. Round-trips: export
  then `cairn report add` reproduces the report (cards re-render against the same runs).
  This is the primary export.
- **Frozen `.html` (shareable, no live data)**: render prose via `<Markdown>` to static
  HTML and **rasterize each card** with the existing `download.ts` pipeline
  (`exportChartFromContainer` / `svgToRasterBlob` for charts, `exportImagesAsComposite` for
  image panes, `exportPlotlyChart` for figures), embedding PNGs inline. Assemble one
  self-contained HTML file (styles inlined, like `serializeSvg` already does per-SVG).
- **`.pdf`**: v1 = browser print of the frozen HTML (no new dep). True programmatic PDF
  would need a library (`download.ts` currently degrades `pdf`→`svg`) — defer.
- Reuse, don't rebuild: `downloadBlob`, `MIME_EXT`, `safeName`, and every rasterizer
  already exist in `download.ts`.

---

## 8. Part G — AI integration in the viewer

**Architecture: client-side, provider-agnostic, bring-your-own-endpoint.**

- **Where the call happens**: directly from the browser to the user's chosen LLM endpoint.
  A settings panel stores `{endpointUrl, apiKey, model, provider}` in localStorage —
  **never server-side** in v1 (no key custody). One thin adapter normalizes an
  OpenAI-compatible chat/completions call; an Anthropic Messages adapter is the second
  shape. (If shared org keys are later wanted, add an opt-in server proxy — flagged, out of
  scope.)
- **Context handed to the model** (assembled client-side): the ` ```cairn ` grammar (a
  short system-prompt spec), the project's runs (id / display_name / tags / created_at from
  `/api/runs`), and available metrics per run (from `/api/runs/{id}/sequences`, i.e. the
  same `metricIndex` the interpreter/AddCardModal build). This lets the model pick real
  metric names and run ids.
- **Output & streaming**: the model emits the **report markdown dialect**, streamed
  straight into the markdown-source editor (§5) with the live preview compiling ` ```cairn `
  blocks as they complete. "Write with AI" (new report) and "Edit with AI" (rewrite/extend
  a selection) both land in the same editor for human review before save.
- **Safety**: the model's ` ```cairn ` blocks run through the **same declarative
  interpreter** as human-authored ones — it cannot express anything a human spec can't, and
  it cannot emit executable HTML/JS (raw HTML stays escaped; arbitrary code only via an
  explicit `PluginCard`, which the AI is not given a tool to author in v1). AI safety ==
  human-author safety, by construction.

---

## 9. Part 3 — No-duplication implementation plan

**Guiding principle:** the executable API is a *thin binding* over the code the UI already
runs. Every new module below names the existing function it extends.

### 9.1 Extractions to do FIRST (turn today's inline logic into shared functions)
These are the anti-duplication levers — do them before anything new consumes them:

1. **`cardFromSpec` / `AddCardSelection → ComparisonCard`**: extract the three-branch mapping
   currently inline in `ReportCardsBlock.tsx:108-127` (series / multi-run / manual-series)
   into `lib/reports/card-from-spec.ts`. Both the block editor's `onAddCard` **and**
   `compileCairnBlock` call it. (Prevents two copies of the fan-out.)
2. **`metricIndex(runIds)`**: extract the sequence-union scan from `AddCardModal.tsx:117-166`
   into a hook/util so both AddCardModal and the interpreter's type-inference share it.
3. **`reportBlockFromComparison(cmp)`**: extract ComparePage's `handleCreateReport`
   copy-logic (`ComparePage.tsx:829-878`) so both the "Create report" button and the
   ` ```cairn from_comparison ` path share it.
4. **Settings inline round-trip**: extend `buildReportPayload`/`restoreReportCardSettings`
   (`lib/reports/payload.ts`) to (de)serialize settings to/from inline spec, reusing
   `loadCardSettings`/`saveCardSettings`/`cardSettingsKeyForReport` unchanged.

### 9.2 New modules (each binds to existing code)
| New | Binds to / reuses |
|---|---|
| `lib/reports/cairn-block.ts` — `compileCairnBlock(spec, metricIndex) → CardsBlock` | `cardFromSpec`, `resolveRunSelectorFromRuns`, `newId` |
| `lib/reports/markdown-source.ts` — `parseReportMarkdown` / `serializeReportToMarkdown` | `compileCairnBlock`, the existing `CardsBlock`/`MarkdownBlock` types |
| report-scoped `MD_COMPONENTS` extension — `language-cairn` code component | base `MD_COMPONENTS` (`lib/markdown.tsx`, untouched), `ReportCardsBlock` |
| Markdown-source editor view in `ReportEditorPage` | existing `blocks[]` state, `<Markdown>`, view toggle |
| `lib/reports/export.ts` — `.md` / `.html` | `serializeReportToMarkdown`, `download.ts` rasterizers |
| SDK `cairn.Report` + `run.log_report` | reports route (`POST`), transport token; **not** the blob path |
| CLI `report` group | `token`-group + `export_cmd` templates |
| `lib/ai/*` — provider-agnostic client + context assembler + editor glue | `metricIndex`, `/api/runs`, markdown-source editor |

### 9.3 Places a naive implementation WOULD duplicate — and the guard
- Re-implementing card construction in the interpreter → **use `cardFromSpec`**.
- A second markdown renderer for reports → **reuse `<Markdown>`**; only *add* a `language-cairn`
  code component, never fork the component map (protects the `MarkdownCard` byte-identity
  contract).
- A Python markdown→blocks parser in the SDK → **don't**; SDK ships `{source}`, UI parses.
- A parallel card-render path for ` ```cairn ` blocks → **render via `ReportCardsBlock`/`CardRenderer`**.
- Re-deriving run sets → **`resolveRunSelectorFromRuns` / `rebuildCardsFromRuns`**.
- A new settings store for inline settings → **reuse the card-settings store + `cardSettingsKeyForReport`**.

### 9.4 Risky / prototype-first
1. **Settings round-trip fidelity (highest risk)**: card `settings` are opaque per-type
   blobs; inlining to YAML and re-hydrating must be lossless. Prototype
   `serialize→parse→render` for a scalar (`yScale:log`, smoothing), an image
   (`reference`/diff), and a multi-run card before building on it.
2. **Markdown ⇄ blocks isomorphism**: the fence splitter must survive prose containing
   ``` ``` ```, nested fences, and preserve block order/ids. Prototype the splitter against
   adversarial docs; decide id stability (regenerate vs. carry a hidden id comment).
3. **`source` vs `blocks` canonicality**: divergence risk with autosave (which shape wins on
   a concurrent edit). Decide the write order (serialize `blocks`→`source` on every save;
   `source` authoritative on load). Keep both in `payload` until proven.
4. **AI provider surface**: keep to two adapters (OpenAI-compatible + Anthropic Messages);
   resist a plugin framework. CORS from the browser to third-party LLM endpoints may bite
   (some providers block browser origins) — prototype one real call early.

### 9.5 Suggested workstreams
- **WS-1 (foundation)**: §9.1 extractions + `cairn-block.ts` + `markdown-source.ts` + inline
  settings. Pure lib, unit-testable, no UI. Unblocks everything.
- **WS-2**: markdown-source editor view + `language-cairn` render component + live preview
  toggle in `ReportEditorPage`.
- **WS-3**: ingestion — `payload.source` write path, SDK `cairn.Report`/`run.log_report`,
  CLI `report add`, UI drag-drop import.
- **WS-4**: export — `.md` canonical + frozen `.html`/print-PDF via `download.ts`.
- **WS-5**: AI — provider-agnostic client, context assembler, "Write/Edit with AI" streaming
  into the editor.

WS-1 → (WS-2, WS-3) in parallel → WS-4, WS-5 in parallel.

---

## 10. Decisions table

| # | Decision | Rationale |
|---|---|---|
| D1 | Dialect = **declarative YAML** in ` ```cairn ` fences | No `eval` → no sandbox, no XSS; compiles to existing `CardsBlock`; LLM-friendly. |
| D2 | Blocks execute on **main thread** via a trusted interpreter | Same safety tier as the block editor; renders through existing `CardRenderer`. |
| D3 | Arbitrary code stays in **`PluginCard` iframe** only | Reuse the one existing sandbox; don't invent a second. |
| D4 | **Markdown-with-fences is canonical**; `blocks[]` is a view | One document, two editors; markdown is the portable interchange form. |
| D5 | Card **settings inline** in the spec; localStorage = derived cache | Makes markdown self-contained for SDK/AI/export. |
| D6 | Persist `payload.source` **alongside** `blocks` (no migration) | Incremental; existing code unaffected; flip to source-only later. |
| D7 | Ingestion funnels to `POST /reports` with `{source}`; SDK `cairn.Report` ≠ blob artifact | Report is a document, not a per-step artifact; avoids a Python parser. |
| D8 | Export: `.md` canonical (live) + `.html`/print-`.pdf` frozen | Reuse `download.ts` rasterizers; no new dep for v1. |
| D9 | AI is **client-side, BYO endpoint/key**, emits the dialect | Provider-agnostic, no server key custody; AI == human trust ceiling. |
| D10 | Extract `cardFromSpec`/`metricIndex`/`reportBlockFromComparison` first | Single source for card construction across editor, interpreter, from-comparison. |

## 11. Open questions
1. **Canonicality flip**: keep `blocks` in the payload forever, or migrate to `source`-only?
   (D6 defers; decide after WS-1/WS-2 prove the parser.)
2. **Block id stability** across markdown round-trips — regenerate ids, or embed a hidden
   `<!-- id -->` marker per block? Affects settings-key continuity.
3. **`block_count` for SDK-ingested reports** before first UI open — accept 0/1, or add a
   minimal server-side fence counter (not a full parser)?
4. **AI key custody**: client-only forever, or an opt-in server proxy for shared org keys?
5. **CORS to third-party LLMs** from the browser — which providers work origin-direct vs.
   need a proxy?
6. **` ```cairn-js ` / imperative escape hatch** — ever needed, or is `PluginCard` enough?
7. **Comparisons parity**: should comparisons also gain a markdown/` ```cairn ` serialization,
   or stay JSON-only? (The interpreter would already support it.)
