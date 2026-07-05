# Design: Notebook-aligned reports — inline markdown, cell model, Python cells & a Python card API

Status: **DESIGN ONLY** — no code written. Extends the merged Reports epic (AR1) and the
declarative `` ```cairn `` dialect designed in `2026-07-04-ai-authored-reports.md` (that
doc's Parts A–G are the reuse substrate; this doc extends its §4/§5/§6 and supersedes its
split-view "markdown-source editor" recommendation with an inline editor).

---

## 0. TL;DR (recommended architecture)

- **Inline "Obsidian" editor** — replace the raw-textarea + separate-preview split (which
  exists at *two* levels: `ReportMarkdownBlock` per-block, and the whole-report source view
  in `ReportEditorPage`) with **one segmented live editor**: the document is split into
  source segments (prose regions + `` ```cairn `` fences + `` ```python `` cells); each
  segment renders via the existing `<Markdown>`/`CairnFenceCard`, and clicking a segment
  swaps *that segment only* into a raw `<textarea>` that re-renders on blur. **No new
  editor dependency** — build a `SegmentedMarkdownEditor` over the existing
  `parseReportMarkdown` fence-splitter and `<Markdown>` renderer. (CodeMirror 6 is the
  fallback if per-segment caret UX proves inadequate; deliberately deferred.)
- **Cell model = markdown | cards | python**, unified as fenced regions in the *same*
  canonical markdown `source` that AR1 already made authoritative. A `` ```python `` fence
  is a new segment type alongside `` ```cairn ``; ordering/add/move/delete already exist for
  blocks and extend 1:1.
- **Python cells** run in the **reused Pyodide sandbox** factored out of `PluginCard.tsx`,
  with **one new reverse message** `cairn:cards`: the cell emits **declarative card specs**
  (the same `AddCardSelection`/`` ```cairn `` YAML shape) that render inline through the
  existing `cardFromSpec` → `CardRenderer` pipeline. **No arbitrary render code** crosses
  the boundary — only declarative specs. This unifies with the Python API (below): the
  in-cell `cairn` builder module *is* the notebook package, compiled to Pyodide.
- **Python↔TS card-spec single source of truth**: the spec schema is **the `` ```cairn ``
  YAML dialect** (already the canonical serialization). Python builds *that YAML/JSON*; it
  never re-implements `cardFromSpec`. A **JSON Schema** (generated once from the TS
  `CairnSpec`/`AddCardSelection` types, checked into `docs/`) is the contract both sides
  validate against — the anti-duplication linchpin.
- **Jupyter/marimo**: a thin `cairn.report` module with `Report(md).publish()` (POST to the
  reports route, reusing `Transport`'s Bearer token) and a notebook display integration via
  `_repr_mimebundle_` that **iframe-embeds the cairn UI's card renderer** pointed at the
  server (live cards), degrading to a static server-rendered snapshot. Card specs built in
  Python are the same YAML the UI parses — zero parser duplication (Python never parses
  markdown→blocks; that stays TS-only, per AR1 §6).

---

## 1. Current state (what's built, file:line)

**Persistence & schema.** A report is a first-class DB document (`reports` table,
`migrations.py:136-145`; opaque JSON `payload TEXT`). Routes:
`GET/POST/PUT/DELETE /api/projects/{id}/reports[/{rid}]` (`reports.py:45-146`), all writes
`require_role("write")` (`reports.py:25`). Payload schema (`types.ts:32-49`):
`{ blocks: (MarkdownBlock|CardsBlock)[], cardSettings?, source? }`. **AR1 made `source`
(canonical markdown) authoritative** when present; `blocks` is its parse cache
(`ReportEditorPage.tsx:98-110`). `block_count` on the list is `len(payload["blocks"])`
(`reports.py:69`).

**The `` ```cairn `` dialect** (`cairn-block.ts`) — a declarative YAML→`CardsBlock`
compiler: `parseCairnSpec` (`:99`), `compileCairnBlock` (`:253`, threads
`opts.resolvedRunIds` for selector blocks at `:259`), `serializeCairnSpec` (`:304`),
`stringifyCairnSpec` (`:349`). Cards are built by the shared **`cardFromSpec`**
(`card-from-spec.ts:44`) — the single fan-out used by *both* the "Add card" UI
(`ReportCardsBlock.tsx:112`) and the dialect. Per-card `settings:` already round-trip
inline (`cairn-block.ts:270-275`, `:321-343`).

**Markdown ⇄ blocks bridge** (`markdown-source.ts`): `splitFences` (`:89`, CommonMark-style
line-based, only `cairn` fences are extracted; every other fence stays atomic in prose
`:126-129`), `parseReportMarkdown` (`:155`), `serializeReportToMarkdown` (`:195`, byte-preserves
unedited fences via `rawCairnSource`). Card settings live in **localStorage** keyed by
`cardSettingsKeyForReport(reportId, card)` = `report:{id}` scope + **random `card.id`**
(`scope.ts:10-22`), serialized into `payload.cardSettings` at save (`payload.ts:14-21`) and
inlined into the dialect.

**Rendering.** `lib/markdown.tsx` = `react-markdown@10` + `remark-gfm` **only** (no
rehype-raw → raw HTML inert; no katex; no syntax highlight). `<Markdown>` takes a
`components` overlay (never forks `MD_COMPONENTS`). `ReportSourceMarkdown.tsx` overlays a
`pre` override that renders `` ```cairn `` fences as `<CairnFenceCard>` (`:46-57`).

**The two split editors (what the user calls "raw and preview").**
`ReportMarkdownBlock.tsx:26-42` = `<textarea>` beside a live `<Markdown>` pane.
`ReportEditorPage.tsx:368-392` = whole-report `<textarea>` beside a `<ReportSourceMarkdown>`
preview. Both are always side-by-side in edit mode — never inline.

**In-browser Python precedent.** `PluginCard.tsx` runs **Pyodide** (`PYODIDE_CDN`, `:62`) in
a **blob-URL iframe** (`buildPyIframeSrcdoc`, `:128-162`; the Python path gets **no**
`sandbox` attr — weaker isolation, a known wart). Protocol (`:98-118`): host→frame
`cairn:render` (ArrayBuffer transfer), frame→host `cairn:resize` (`protocolVersion:1`,
"ignore unknown fields"), auto-height via the shared `useIframeAutoHeight`
(`card-kit/use-iframe-auto-height.ts:33-52`, already reused by `HtmlCard`). Plugin Python
returns **HTML** injected into `#output` (`:158`) — there is **no** reverse structured
channel and **no** in-Pyodide card builder today (the stub only defines plugin base
classes, `:139-152`). `CardRenderer` dispatches on `metric.object_type` and every card is
anchored to a server `(runId, metric, context_hash)` — **no inline-data card exists**.

**Python SDK.** `cairn.Run`/`Reader`/type wrappers/`JSPlugin`,`PythonPlugin` (`__init__.py:42-74`).
`Transport` carries `Authorization: Bearer {token}` resolved as explicit arg → `CAIRN_TOKEN`
→ config `token` (`transport.py:64-69`, `config.py:155-172`); `post_json`/`get` helpers
exist (`:115-133`). **No report/card builder, no `_repr_html_`/marimo/jupyter anything**
exists (greenfield). AR1 §6 already specced `cairn.Report(md)` posting `{source: md}` and
made the anti-duplication call: **the SDK does not parse markdown in Python.**

---

## 2. Bug inventory (the mandate's "enumerate + classify")

Severity + **FIX-NOW** (mergeable in the current editor, not throwaway) vs **REDESIGN**
(subsumed by / only sensible inside the new model). Root causes cited.

| # | Bug (root cause, file:line) | Sev | Class |
|---|---|---|---|
| B1 | **Markdown-source edits never autosave → data loss.** Autosave deps are `[blocks,name,hydrated]` (`ReportEditorPage.tsx:157`); typing only sets `mdSource` (`:373`), never schedules a timer; unmount flush is skipped (`:170`) and `doSave` serializes from `blocks` (`:127`). Only explicit Save (`:184-205`) persists. | HIGH | FIX-NOW (then SUBSUMED — inline editor removes the split view) |
| B2 | **Refresh badge fires in VIEW mode and autosaves.** Badge is gated only by `selector`, not `editMode` (`ReportCardsBlock.tsx:139-146`); `handleRefresh`→`onChange` (`:102`)→`updateBlock` mutates `blocks`→autosave. A viewer can overwrite the persisted card set. | HIGH | FIX-NOW |
| B3 | **"Auto mode fills all cards of the runs automatically."** `handleRefresh` (`:97-106`) calls `rebuildCardsFromRuns` (`rebuild-cards.ts:21-53`) = **full replace, one card per (name,object_type)** across all resolved runs — discards curated cards/order/overlays. This is the user's named bug (b). | HIGH | FIX-NOW |
| B4 | **Per-card settings orphaned on any rebuild/reparse.** Settings keyed by random `card.id` (`scope.ts:20`); every rebuild/`cardFromSpec` mints a new id (`rebuild-cards.ts:49`, `card-from-spec.ts:48,54`) → yScale/smoothing/step/reference silently dropped. | HIGH | FIX-NOW + SUBSUMED (frozen config in dialect) |
| B5 | **Selector card ids churn on async metric-index load.** `fallbackId` stabilizes only the *block* id (`CairnFenceCard.tsx:46,92`); recompile on `metricIndex`/resolution regenerates card ids and re-writes settings under new keys (`:105-114`). | MED | FIX-NOW / SUBSUMED |
| B6 | **#44 — native cells editor renders stale cards for selector blocks.** Runs panel + AddCardModal use resolved `runIds` (`:52,297`) but cards render from frozen `card.series[].runId` (`:322-331,348`); when the selector re-resolves, chips update, cards don't. The only reconciliation is the destructive `handleRefresh` (B2/B3). (Fence path was fixed via `opts.resolvedRunIds`, `cairn-block.ts:259`; the *editor* path was not — documented at `cairn-block.round-trip.ts:183-204`.) | HIGH | FIX-NOW |
| B7 | **Card DATA (step/mode/iteration/settings) editable in VIEW mode but not persisted — the user's bug (c).** Interactive `CardRenderer` controls write localStorage in view mode; `CairnFenceCard`'s settings `useEffect` is ungated (`:105-114`); there's no save path in pure view mode, and the next `restoreReportCardSettings` (`ReportEditorPage.tsx:102/108`) clobbers them. Settings are mutable where they can't be saved, and not frozen into the document. | MED | REDESIGN (edit-mode gating + frozen per-card config) |
| B8 | **`doSave` closure omits `mdSource`; unmount flush persists stale `blocks`-derived source**, clobbering markdown edits (compounds B1). Deps `[hydrated,reportId,blocks,name]` (`:140`). | MED | FIX-NOW (then SUBSUMED) |
| B9 | **Overview: delete/rename have no error/pending UI; pagination strands.** `handleDelete` no `onError`, button not disabled (`ReportsListPage.tsx:51-54,227`); deleting the last row on page 2 leaves `offset=50` with no clamp (`:127-149`). | LOW/MED | FIX-NOW (overview) |
| B10 | **Overview + editor: run lists capped at 200 silently truncate.** `useRuns({limit:200})` (`ReportsListPage.tsx:33`, `ReportEditorPage.tsx:46`) feeds `allProjectRuns`; chips/pickers drop runs >200 (`ReportCardsBlock.tsx:59-62`, `ReportsListPage.tsx:335`); resolution uses a *different* limit so resolved ids can reference absent runs (missing chips). | MED | FIX-NOW (overview) |
| B11 | **Overview: `block_count` misleads.** Computed from `payload.blocks` (`reports.py:69`); for a **source-only report** (SDK/`cairn.Report` ships `{source}` with no blocks, per AR1 §6) it renders **"0 blocks"**. Also stale vs `source` after B1/B8. | LOW→MED (blocks Python API) | FIX-NOW (overview + server) |
| B12 | (historical, fixed in fence path) selector blocks compiled empty series — `effectiveRunIds` fix at `cairn-block.ts:259`. The *unfixed* remainder is B6. | — | reference |

**Fix-now shortlist (independently mergeable):** B2, B3, B6 (the cells/auto-mode/#44
cluster — one coherent fix: re-resolve, don't regrow), B1+B8 (markdown-source autosave/flush
— stopgap until the inline editor lands), B9, B10, B11 (overview). B7 and the settings-id
issues (B4/B5) are best solved *inside* the redesign (frozen per-card config), though B4's
"stable card id" can ship early.

**The B2/B3/B6 fix (fix-now, not throwaway):** replace `handleRefresh`'s
`rebuildCardsFromRuns` full-replace with a **`rebindCardsToRuns(cards, runIds)`** that keeps
each existing card and only re-derives its `series` for the new run set (reusing each
metric's `name`/`object_type`, enriching `context_hash` from the metric index — exactly what
`compileCairnBlock`'s series branch does at `cairn-block.ts:234-238`). Gate the badge/refresh
behind `editMode`. Then for the native editor, run this rebind automatically when a selector
block's resolved `runIds` change (mirroring the fence path), so cards stop going stale
without a destructive regrow. `rebuildCardsFromRuns` (regrow-all) stays available only as an
explicit "Reset cards from runs" action, edit-mode only.

---

## 3. Design

### A. Obsidian-style inline markdown editor

**Model.** One component `SegmentedMarkdownEditor` renders the whole report `source` as an
ordered list of **segments** produced by the existing fence splitter (`splitFences`,
generalized to also recognize `` ```python `` and to split prose into *editable line/para
regions*). Segment kinds: `prose` | `cairn` | `python`.

**Interaction (the "render unless clicked" behavior).**
- Default: every segment is **rendered** — prose via `<Markdown>`, `cairn` via
  `<CairnFenceCard>`, `python` via `<PythonCell>` (§D).
- Click / focus a **prose** segment → swap *that segment only* into a raw `<textarea>`
  seeded with its exact source lines; caret placed at the click offset (best-effort:
  map click to nearest source line). On **blur** (or `Esc`/`Cmd+Enter`) → re-render.
- Click a **fence** segment → in edit mode, reveal its raw YAML/Python in a `<textarea>`
  (the fence body), rendered live below; on blur, re-render. (Fences are inherently
  multi-line, so they edit as a block, not per-line — this is correct and matches Obsidian's
  code-block behavior.)
- **Segment granularity for prose:** split prose on blank-line boundaries (paragraph/list/
  table/heading units), **not** raw physical lines — a naive per-physical-line editor breaks
  tables and multi-line list items. This reuses the same block-awareness `splitFences`
  already needs. (Obsidian itself edits by "line" but renders by block; we edit by block,
  which is simpler and safe here.)
- **Focus/caret continuity:** on entering edit for a segment, `autoFocus` the textarea and
  restore selection from a stored offset; on `Enter` at a block boundary, optionally split
  into a new segment (v2 nicety — v1 can keep the textarea until blur).

**Why this replaces the split.** The right-hand preview pane disappears: the rendered view
*is* the editor. `ReportMarkdownBlock`'s textarea+preview (`:26-42`) and the whole-report
split (`ReportEditorPage.tsx:368-392`) both collapse into this one surface. **No new dep** —
reuses `<Markdown>` (render), `splitFences` (segmentation), `CairnFenceCard` (cards). The
only genuinely new code is the click-to-edit state machine (which segment is active) and
caret restore — the part agent-analysis flagged as "what a lib would give you free"; we
accept owning it, scoped to block-granular editing to keep it tractable.

**Coexistence with cards/python.** Because all three kinds live in the *same* `source`
string and the *same* segment list, ordering/interleaving is free: a prose paragraph, then a
`` ```cairn `` card, then a `` ```python `` cell, then prose — each an independently
render/edit-able segment. Insertion = splice a new segment (a `+` affordance between
segments, mirroring today's `+ Markdown block` / `+ Cards block` at `ReportEditorPage.tsx:463`).

### B. Notebook-aligned cell model

**Cells = the segments of A**, promoted to first-class "cells" with Jupyter-ish affordances.
Three cell types map onto the canonical markdown 1:1:

| Cell type | Canonical serialization | Renders as | Editable body |
|---|---|---|---|
| markdown | prose region between fences | `<Markdown>` | prose (per-block textarea, A) |
| cards | one `` ```cairn `` fence | `<CairnFenceCard>` → `CardRenderer` | YAML dialect |
| python | one `` ```python `` fence (info-string `python`, optionally `python cairn` to opt into card-emit) | `<PythonCell>` (§D) | Python source; **output area** below (emitted cards) |

- **Ordering / add / move / delete**: already implemented for `blocks` (`moveBlock`,
  `deleteBlock`, add buttons, `ReportEditorPage.tsx:210-246,463-472`); extends to a third
  "+ Python cell" and to python segments verbatim.
- **Jupyter semantics**: markdown & cards cells "render on view"; python cells have an
  explicit **Run** (▶) and an **output** region (the emitted card specs), plus run state
  (idle/running/error/stale). A python cell's *output is not stored as executable* — only
  the emitted **declarative card specs** may be persisted (frozen), so reopening shows the
  last output without re-running (see §C/§D).
- **Serialization discipline**: `splitFences` already treats non-`cairn` fences as atomic
  prose — we extend it to *also* extract `python` fences (with the same
  longer-fence-nesting safety). The `` ```cairn `` / `` ```python `` info-strings are the
  only two recognized cell fences; every other language stays literal (a real Python *code
  listing* in prose can use ` ```py ` or 4-backtick nesting).

### C. Card-state persistence + edit-mode gating (the user's bug (c))

**Problem today (B4/B5/B7):** per-card config (step/iteration, mode, `settings`) lives in
mutable localStorage keyed by a *random* `card.id`, is mutated even in view mode, isn't
frozen into the document, and is lost whenever ids churn.

**Design — frozen per-card config carried in the dialect:**
1. **Stabilize card identity.** Give each card a **deterministic id** derived from its
   content (position + metric + type) so reparse/rebind doesn't churn it — or, simpler,
   carry an explicit `id:` per card in the `` ```cairn `` spec (the block already carries
   `id:`; extend to `cards[].id`). Fixes B4/B5 at the root: settings keys stop moving.
2. **Freeze all view-relevant state into `cards[].settings`** in the dialect. Today
   `settings:` carries chart settings; **extend it to carry the frozen `step`/`iteration`
   and display `mode`** (the fields the user wants "saved and only changeable in edit mode").
   The dialect already (de)serializes `settings` losslessly (`cairn-block.ts:270-275,321-343`)
   and `CairnFenceCard` writes them into the card-settings store
   (`CairnFenceCard.tsx:105-114`) — extend the store's schema, no new channel.
3. **Edit-mode gate mutation.** In **view mode**, card controls read the frozen config and
   are **read-only** (or the control changes are ephemeral/never written to the store and
   never autosaved). In **edit mode**, controls mutate the frozen config and mark the block
   dirty → autosave inlines it back into `source`. Concretely: gate the settings-write
   `useEffect` and the interactive `CardRenderer` control handlers on an `editMode` prop
   threaded down (today `CairnFenceCard` hardcodes `editMode={false}`,
   `CairnFenceCard.tsx:142`, and writes settings unconditionally — both change).
4. **`payload.cardSettings`/localStorage becomes a derived cache** (AR1 §4.2 D5 already
   states this direction); the **`source` is the single source of truth** for frozen config,
   so a report round-trips fully — SDK-ingested, exported, or AI-authored reports render
   identically with no localStorage seed.

Round-trip: a card's saved state = `cards[].settings` in the fence → parsed by
`compileCairnBlock` → written to store → read by `buildReportPayload` → re-inlined by
`serializeCairnSpec`. This is the existing settings loop (`payload.ts`, `cairn-block.ts`)
with a widened `settings` schema and an `editMode` gate.

### D. In-browser Python cells

**Execution model.** Factor the Pyodide runtime out of `PluginCard.tsx`
(`buildPyIframeSrcdoc` + iframe lifecycle + resize protocol + `useIframeAutoHeight`) into a
reusable `card-kit/pyodide-sandbox.ts`. A `<PythonCell>` mounts that sandbox, feeds it the
cell source on **Run**, and receives output. **Reuse, don't fork** — the same CDN load,
`# cairn-requires:` micropip handling, and error boxing.

**The reverse channel (new).** Add one message `frame→host` `cairn:cards`
(`protocolVersion:1`):
```
{ type: "cairn:cards", specs: CairnSpec | CairnSpec[], protocolVersion: 1 }
```
The cell's Python calls an injected **`cairn` builder** (§E) that accumulates card specs and
posts them; the host validates against the JSON Schema (§E), compiles each via the **existing
`compileCairnBlock` → `cardFromSpec` → `CardRenderer`** pipeline, and renders them in the
cell's output area. **No HTML, no arbitrary DOM crosses the boundary** — unlike plugin cards
(which inject HTML, `PluginCard.tsx:158`), a python *cell* emits only declarative specs.
This is the key security upgrade: the cell can compute data in-browser but can only *display*
via the sanctioned declarative path.

**API surface exposed to the cell** (the in-Pyodide `cairn` module, mirroring the SDK §E):
- `cairn.scalar(metric, runs=..., **settings)`, `cairn.image(...)`, `cairn.parallel(runs=...)`,
  `cairn.card(type=..., series=[...])` — builders that return/accumulate a `CairnSpec` card
  entry (the `AddCardSelection` shape).
- `cairn.runs.select(mode=..., name_pattern=..., n=...)` / explicit ids — the `runs:` block.
- `cairn.query(...)` — read server data (metrics/series) via the host (a `cairn:query`
  request/response over postMessage that proxies the *authenticated* `/api/*` client the UI
  already uses; the cell never gets a raw token or `fetch`). This lets a cell compute over
  real run data, then emit specs referencing those metrics.
- `cairn.show(*specs)` / returning specs from the cell → posts `cairn:cards`.

**Two card-output modes** (matching the CardRenderer constraint that cards are metric-anchored):
- **(a) Reference mode (v1, cheap):** emitted specs reference **existing tracked metrics**
  `(runId, metric, context_hash)` — they compile through `cardFromSpec` and render with zero
  new card machinery. Covers "plot loss for the newest 5 runs, computed/filtered in Python."
- **(b) Inline-data mode (v2):** a cell computes a *novel* array/figure in-browser with no
  server metric to point at. Needs a **new `inline` card variant** that `CardRenderer` can
  render from spec-embedded data (e.g. a Plotly figure JSON or a small series) without a
  server fetch. Flagged as net-new (CardRenderer is 100% `object_type`+server-anchored today,
  `CardRenderer.tsx:177`); defer behind (a).

**Execution UX.** Run button (▶), running spinner, output area, **error rendering** (the
sandbox already boxes Python tracebacks; surface them inline like the `` ```cairn `` error
banner, `CairnFenceCard.tsx:117-127`). **Reactivity:** a cell can subscribe to the report's
run-selector refresh — re-run on new data / when the selector's resolved run set changes
(mirrors WS-RX refresh). Persisted state: the cell **source** (in the `` ```python `` fence)
+ the **last emitted specs** frozen into an adjacent/`output:`-tagged region so a reopened
report shows cards without auto-executing untrusted code. Auto-run policy = opt-in per cell
(default: show frozen output, offer Run).

**Security.** Pyodide is sandboxed (fix the `PluginCard` wart: give the cell iframe a real
`sandbox` where cross-origin CDN allows, or self-host Pyodide to enable `sandbox` +
`allow-scripts` without `allow-same-origin`). The **only** output is declarative specs
validated against the schema; unknown fields ignored ("receivers MUST ignore unknown
fields"). No raw HTML/JS injection path exists for cells (that remains solely the explicit
`PluginCard`). Data access is mediated (`cairn.query` → host's authed client), never a raw
token.

### E. Python card API + Jupyter/marimo (unifies D)

**Package.** A new `cairn.report` module (SDK), re-exported as `cairn.Report`, `cairn.card`,
`cairn.runs` — the **same builder** compiled into Pyodide for §D (one implementation, two
runtimes). It **builds card specs = the `` ```cairn `` YAML/JSON dialect**, and it **never
parses markdown→blocks** (that stays TS-only, AR1 §6).

```python
import cairn
r = cairn.Report(name="Ablation study", project="proj")
r.md("## Results\nBaseline vs. ablation.")
r.cards(runs=cairn.runs.select(mode="newest-per-name", name_pattern="ablate-*", n=5),
        cards=[cairn.scalar("val/loss", yScale="log"),
               cairn.scalar("val/acc")])
r.publish()          # POST /api/projects/{proj}/reports  {name, payload:{source: md}}
r                    # in a notebook: renders live cards inline (see below)
```
- `r.md(str)` appends a prose region; `r.cards(...)`/`r.card(...)` append a `` ```cairn ``
  fence; `.source` yields the canonical markdown string. `publish()` = `transport.post_json(
  "/api/projects/{id}/reports", {name, payload:{source}})`, reusing the Bearer token
  (`transport.py:64-69`). `require_role("write")` already enforced server-side.
- **CLI** `cairn report add FILE.md --project P` (AR1 §6 #2) — same funnel.
- **`block_count` fix (B11):** server computes count from `source` when `blocks` absent
  (a trivial fence count — *not* a full parser), or the list tolerates source-only reports.

**Single-source-of-truth for the spec schema (the top anti-duplication lever).** The card
spec is defined **once** as the TS `CairnSpec`/`AddCardSelection` types (`cairn-block.ts`,
`card-from-spec.ts`). Generate a **JSON Schema** from them (e.g. `ts-json-schema-generator`)
checked into `docs/schemas/cairn-spec.schema.json`. Then:
- The **Python builders** produce dicts and validate against that schema (pydantic model
  generated from it, or `jsonschema`), so Python can never emit a shape the TS compiler
  rejects.
- The **in-cell Python** (§D) and the **UI host** both validate `cairn:cards` payloads
  against the same schema.
- **Nobody re-implements `cardFromSpec`.** Python emits YAML/JSON; the TS `compileCairnBlock`
  is the *only* interpreter. This is the "documented contract + generated schema" answer to
  "how to avoid duplicating the schema across TS+Python."

**Jupyter/marimo display integration.** Add `_repr_mimebundle_` (works in Jupyter *and*
marimo) to `cairn.Report` (and optionally a `cairn.report.Card`):
- **Primary: iframe-embed the cairn card renderer.** The bundle returns an `text/html`
  iframe pointing at a **UI render endpoint** (a lightweight route/page that renders a given
  `source` or card spec against the live server — essentially `ReportSourceMarkdown` hosted
  standalone). Reuses the *actual* UI card components → zero render duplication; cards are
  live (query the server). Requires the notebook to reach the server URL; auth via the same
  Bearer token / a short-lived signed embed URL.
- **Fallback: static snapshot.** For offline/exported notebooks, request a server-rendered
  PNG/HTML snapshot (reusing the export rasterizers AR1 §7 describes) and embed inline.
- **Auth for the notebook** reuses the standard chain — `CAIRN_TOKEN`/config `token`/explicit
  arg → Bearer (`transport.py`, `config.py:155-172`); a `write` token for `publish()`, a
  `read` token suffices for display-only. No notebook-specific auth. (BYO-token aligns with
  AR1 §8's "never server-side key custody" stance.)
- **marimo specifically:** `_repr_mimebundle_`/`_repr_html_` renders in marimo cells too; an
  optional `anywidget` wrapper (if reactive re-query is wanted) is a v2 nicety, not required.

**Unification of D + E:** the in-cell `cairn` builder (§D) and the notebook `cairn.report`
builder (§E) are the *same module* (one Python source, compiled to Pyodide for the browser).
A user's notebook code and a report's python cell build cards through identical calls; the
only difference is the transport (postMessage `cairn:cards` in-browser vs `_repr_mimebundle_`
/`publish()` in the notebook).

### F. Report overview fixes

- **B9**: add `onError` banners + pending-disable to create/rename/delete
  (`ReportsListPage.tsx:41-54,178-182`); clamp `offset` after deletion when the page empties.
- **B10**: stop hard-capping `useRuns({limit:200})` for report surfaces — page/stream all
  project runs (or at least align the picker/chip limit with `RUN_SELECTOR_FETCH_LIMIT` so
  resolved ids always have metadata); missing-chip fallback should show a resolvable label.
- **B11**: server `block_count` tolerant of source-only reports (count from `source`); type
  the list row from the API type, not a local `ReportSummary` (`:154-159`).
- **`handleCreate`** should seed `payload:{source:""}` (or a single empty prose region) for
  consistency with the source-canonical model (`:46`).

---

## 4. Decisions table

| # | Decision | Rationale |
|---|---|---|
| D1 | Inline segmented editor (render-unless-clicked), **no new dep** | Reuses `<Markdown>` + `splitFences` + `CairnFenceCard`; CodeMirror deferred as fallback |
| D2 | Edit prose by **block/paragraph**, not physical line | Per-line breaks tables/lists; block-granular is safe and reuses fence-split block awareness |
| D3 | Cells = markdown \| cards \| python, all **fences in the one canonical `source`** | Extends AR1's authoritative-`source` model; ordering/add/move already exist |
| D4 | Python cells emit **declarative card specs only** (`cairn:cards`), rendered via `cardFromSpec`→`CardRenderer` | No arbitrary DOM/HTML from cells; strictly stronger than plugin cards |
| D5 | **Reuse the Pyodide sandbox** from `PluginCard` (factored out), fix the missing-`sandbox` wart | One runtime; sandboxed |
| D6 | **Spec schema single-sourced in TS**, exported as JSON Schema; Python validates against it, never re-implements `cardFromSpec` | The central anti-duplication lever |
| D7 | Frozen per-card config lives **inline in `cards[].settings`**; view-mode read-only, edit-mode mutates+autosaves | Solves bug (c); `source` is single source of truth; localStorage = derived cache |
| D8 | Stable/deterministic **card ids** (or explicit `cards[].id`) | Root-fixes settings orphaning (B4/B5) |
| D9 | Auto-refresh **re-binds** existing cards to the resolved run set; **never regrows** one-card-per-metric (that becomes an explicit edit-mode "Reset" action) | Fixes bug (b)/B3/B6/#44 without data loss |
| D10 | `cairn.Report(md).publish()` posts `{source}`; **no Python markdown parser**; notebook display via `_repr_mimebundle_` iframe-embedding the UI renderer | AR1 §6 reuse; zero parser duplication |
| D11 | Notebook auth = existing Bearer chain; inline-data cards deferred behind reference-mode | Minimal surface; CardRenderer stays metric-anchored in v1 |

---

## 5. Phased plan (each phase names the module it extends)

**Phase 0 — Fix-now bugs (ship independently, not throwaway).**
- 0a. **Cells/auto-mode/#44 cluster (B2/B3/B6):** add `rebindCardsToRuns(cards, runIds,
  metricIndex)` next to `rebuild-cards.ts`; make selector blocks auto-rebind on resolution
  change in `ReportCardsBlock`; gate the refresh badge behind `editMode`; demote
  `rebuildCardsFromRuns` to an explicit edit-mode "Reset cards from runs".
- 0b. **Stable card ids (B4):** add `cards[].id` to the dialect (`cairn-block.ts`) +
  deterministic id in `cardFromSpec`; settings keys stop churning.
- 0c. **Markdown-source autosave/flush (B1/B8):** stopgap — add `mdSource` to the autosave/
  flush path (parse-on-idle) until Phase 2 removes the split view.
- 0d. **Overview (B9/B10/B11):** error/pending UI, offset clamp, run-limit, source-tolerant
  `block_count`, API-typed rows (`ReportsListPage.tsx`, `reports.py`).

**Phase 1 — Spec schema single source (unblocks everything Python).**
- Generate `docs/schemas/cairn-spec.schema.json` from the TS `CairnSpec`/`AddCardSelection`;
  wire a check that TS types and schema stay in sync (CI). Extend `cards[].settings` schema
  to carry frozen `step`/`iteration`/`mode` (D7 groundwork).

**Phase 2 — Inline editor (subsumes the split view).**
- Build `SegmentedMarkdownEditor` over `splitFences` + `<Markdown>` + `CairnFenceCard`;
  replace `ReportMarkdownBlock`'s textarea+preview and `ReportEditorPage`'s split view.
  Retire the "Markdown/Cells" toggle into one surface (keep a raw-source escape hatch).

**Phase 3 — Frozen card config + edit-mode gating (bug (c)).**
- Thread `editMode` into `CairnFenceCard`/`CardRenderer`; gate settings writes; freeze
  step/mode into `cards[].settings`; make view mode read-only; autosave inlines to `source`.
  Extends `payload.ts`/`cairn-block.ts` settings loop (no new channel).

**Phase 4 — Python cells (in-browser).**
- Factor `card-kit/pyodide-sandbox.ts` out of `PluginCard`; add `<PythonCell>` + the
  `cairn:cards` reverse message + `cairn:query` proxy; inject the `cairn` builder; render
  emitted specs via `compileCairnBlock`→`CardRenderer`; add the `` ```python `` fence to
  `splitFences`/the cell model. Reference-mode cards only (v1).

**Phase 5 — Python API + Jupyter/marimo.**
- `cairn.report` module (`Report`/`card`/`runs` builders) validating against the Phase-1
  schema; `publish()` via `Transport`; CLI `cairn report add`; `_repr_mimebundle_` iframe
  display; the standalone UI render endpoint. Share the builder source with Phase 4's Pyodide.

**Phase 6 (deferred) — inline-data cards** (new `CardRenderer` variant) + reactive marimo
widget + Pyodide `sandbox` hardening/self-host.

---

## 6. No-duplication levers (top 3) + full guard list

1. **One spec schema (D6/Phase 1).** TS types → generated JSON Schema → Python validates.
   Python emits YAML/JSON; **`compileCairnBlock`/`cardFromSpec` is the only interpreter.**
   Guards against the single biggest risk: two card-construction implementations drifting.
2. **One card-build path.** In-cell Python, notebook Python, "Add card" UI, and the dialect
   all funnel to `cardFromSpec` (`card-from-spec.ts:44`) — never re-implement the
   series/multi-run/manual-series fan-out.
3. **One markdown pipeline.** `<Markdown>` (never fork `MD_COMPONENTS`) for render; the
   inline editor, python-cell output, `` ```cairn `` cards, and the notebook iframe all reuse
   it. Python never parses markdown (AR1 §6).

Further guards: reuse the **Pyodide sandbox** (don't build a second runtime); reuse
`useIframeAutoHeight`/the `cairn:*` protocol (don't invent a second postMessage contract);
reuse `splitFences` for both the bridge and the editor segmentation (don't write a second
splitter); reuse the **Bearer-token chain** for notebook auth (don't add notebook-specific
auth); reuse the **settings inline loop** for frozen config (don't add a second settings
channel).

---

## 7. Riskiest — prototype first

1. **Pyodide-in-cell → card output** (Phase 4): the `cairn:cards` reverse channel + the
   in-Pyodide builder + the `cairn:query` data proxy is the most novel integration; the
   `PluginCard` no-`sandbox` wart needs resolving for real isolation. Prototype the
   round-trip (cell computes → emits spec → renders via `CardRenderer`) end-to-end first.
2. **Python↔TS card-spec contract** (Phase 1): if schema generation/sync is flaky the whole
   Python surface duplicates silently. Prototype the codegen + a round-trip test (Python
   builds spec → validates → TS `compileCairnBlock` accepts) before building on it.
3. **Inline editor caret/segment UX** (Phase 2): click-to-edit with correct caret placement
   and block-boundary handling (tables, multi-line lists, fences) is the classic "harder
   than it looks." Prototype prose-only first; decide CodeMirror-6 vs hand-rolled from that.

---

## 8. Open questions

1. **Inline-data cards** — do we need cells that emit *novel* in-browser-computed data (a new
   `CardRenderer` variant), or is reference-mode (emit specs pointing at tracked metrics)
   sufficient for v1? (Affects Phase 6 scope.)
2. **Python cell trust on reopen** — auto-run vs frozen-output-only. Recommend frozen-output
   default + explicit Run; but a shared report with stale frozen cards may mislead. How is
   "output is stale" surfaced?
3. **Where does the notebook iframe render endpoint live** — a dedicated `/embed` route in
   the existing UI, or a headless render service? Auth for embed (signed short-lived URL vs
   cookie vs token query param — the WS path is cookie-only today, `auth.py:429-442`).
4. **Deterministic card ids** — content-hash vs explicit `cards[].id`. Content-hash is
   invisible but can collide on identical cards; explicit id clutters hand-authored YAML.
5. **`source`-only storage** — when do we drop `payload.blocks` from the DB shape (AR1 §4.3
   "later")? Blocks the `block_count` fix's final form.
6. **Reactive marimo** — is `anywidget` worth a dep for live re-query, or is a static
   `_repr_mimebundle_` snapshot enough?

---

### File index (primary touch points)
Editor/overview: `pages/ReportEditorPage.tsx`, `pages/ReportsListPage.tsx`,
`components/reports/{ReportCardsBlock,ReportMarkdownBlock,ReportSourceMarkdown,CairnFenceCard}.tsx`.
Model/bridge: `lib/reports/{types,payload,scope,card-from-spec,cairn-block,markdown-source,metric-index}.ts`,
`lib/comparisons/rebuild-cards.ts`, `lib/markdown.tsx`, `api/hooks.ts` (`useRunSelectorResolution`).
Python/sandbox: `components/PluginCard.tsx`, `components/card-kit/use-iframe-auto-height.ts`,
`components/CardRenderer.tsx`. Server/SDK: `server/routes/reports.py`, `server/auth.py`,
`sdk/transport.py`, `config.py`, `cairn/__init__.py`, `sdk/plugins.py`.
Prior spec: `docs/superpowers/specs/2026-07-04-ai-authored-reports.md`.
