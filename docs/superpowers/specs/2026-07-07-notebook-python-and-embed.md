# Design: In-browser Python cells, `cairn.Report`/`cairn.card` API, and the `/embed/card` standalone-card foundation

Status: **DESIGN ONLY** — no code written. Read-only research spec.
Author context: extends `2026-07-05-notebook-reports.md` (the notebook-reports epic) and
`2026-07-04-ai-authored-reports.md` (the `` ```cairn `` declarative dialect / AR1 substrate).
Security-sensitive (browser Python execution) — §7 is a mandatory security model.

This doc specs **three tightly-related things** that share one foundation:

1. **In-browser Python cells** in the *simple* report mode (notebook-reports Phase 2) — a report
   can contain `` ```python `` cells that run **client-side in a Pyodide sandbox** and emit cairn
   cards as output. No server-side execution.
2. **`cairn.Report` / `cairn.card(...)` Python API** — a Python SDK surface to build cards/reports
   programmatically, with the card spec defined **once** (a single JSON Schema derived from the TS
   card types) so Python and TS never drift.
3. **Card-standalone-in-notebook foundation** (Piece A of the jupyter/marimo epic #60) — make cairn
   cards render in *any* Jupyter/marimo notebook, via Python objects implementing
   `_repr_mimebundle_`/`_repr_html_` that emit an `<iframe>` pointed at a **new
   `/embed/card` server route** which mounts a minimal SPA shell rendering **one** card from a spec
   (reusing the existing React viewer — zero card reimplementation). Simple plots may instead emit
   self-contained `cairn.plot` Plotly HTML.

---

## 1. Summary / recommended shape

- **Shared foundation, built first (unblocks 1 & 3):** (a) a **single-source card-spec JSON
  Schema** generated from the TS types via `ts-json-schema-generator`, checked into
  `docs/schemas/`, with a CI drift-check; and (b) the **`/embed/card` route + minimal embed SPA
  shell** that renders one card from a spec by reusing `CardRenderer`. Both are prerequisites for
  everything Python.
- **Card-spec single source = "TS is authoritative, JSON Schema is the generated contract, Python
  validates against it, and `compileCairnBlock`/`cardFromSpec` is the *only* interpreter."** Python
  never re-implements card construction; it emits the `` ```cairn `` YAML/JSON the TS already parses.
- **`/embed/card`** mounts a **new tiny SPA entry** (`embed.html` + `embed-main.tsx`) — *not* the
  full app shell — wrapping just `QueryClientProvider` + `CardRenderer`, reading the card spec from
  a **short-lived server-stored spec id** (`?sid=`) rather than a giant URL. Auth is the standard
  cookie/Bearer trust boundary; cross-origin (remote notebook) embedding is a documented, gated
  exception. Auto-height via the existing `cairn:resize` postMessage protocol.
- **Python display protocol:** `cairn.card(...)`/`cairn.Report` objects implement
  `_repr_mimebundle_` (Jupyter + marimo) returning an `<iframe src=".../embed/card?sid=…">`; the
  object discovers server URL + auth via the existing `Transport`/config chain. Trivial standalone
  plots (`cairn.plot`) can instead return self-contained Plotly HTML (no server needed).
- **Python cells = client-side Pyodide only.** The cell computes in the browser and can emit
  **declarative card specs only** (new `cairn:cards` reverse postMessage), which render through the
  same `compileCairnBlock` → `CardRenderer` path. **No server-side kernels** (that is #60 B1, out of
  scope). Data access is mediated through the host's already-authenticated API client, never a raw
  token.

---

## 2. Grounding — files studied (cited)

**Card-spec source of truth (TS):**
- `cairn/ui/src/lib/comparisons/types.ts` — `ComparisonSeriesRef` (`:8-14`), `ComparisonCard`
  (`:16-21`, the **closed 16-member `type` union**), `MULTI_RUN_CARD_TYPES`/`MultiRunCardType`
  (`:32-49`), `isComparisonCard` runtime guard (`:118-135`, deliberately accepts *any* non-empty
  `type` string).
- `cairn/ui/src/lib/run-selector.ts` — `StaticRunSelector`/`QueryRunSelector`/`RunSelector`
  (`:26-46`), `DEFAULT_RUN_SELECTOR_N`, guards, `resolveRunSelectorFromRuns` (`:104-130`).
- `cairn/ui/src/lib/reports/types.ts` — `MarkdownBlock`/`CardsBlock`/`ReportBlock`/`ReportPayload`
  (`:13-49`); `ReportPayload.source` is canonical markdown (AR1).
- `cairn/ui/src/lib/reports/cairn-block.ts` — the `` ```cairn `` YAML dialect: `CairnSpec`
  (`:88-101`), `CairnCardInput`/`CairnRunsInput`/`CairnRunsSelectorInput` (`:57-85`),
  `parseCairnSpec` (`:110`), `compileCairnBlock` (`:296`, threads `opts.resolvedRunIds`),
  `serializeCairnSpec` (`:364`), `stringifyCairnSpec` (`:417`), `CompiledCairnBlock`
  (`:103-107`, note: inline `settings` returned as a side-channel `Record<cardId, unknown>`).
- `cairn/ui/src/lib/reports/card-from-spec.ts` — `AddCardSelection` (`:34-37`), `cardFromSpec`
  (`:44-57`) — the **single fan-out** shared by the "Add card" UI and the dialect. Note the
  `object_type as ComparisonCard["type"]` casts (`:48,51`) — an *open* string forced into the
  closed union.
- `cairn/ui/src/lib/reports/markdown-source.ts` — `splitFences` (`:91-137`, only `cairn` fences
  extracted; everything else literal prose), `parseReportMarkdown` (`:195`),
  `serializeReportToMarkdown` (`:244`, byte-preserving).
- `cairn/ui/src/components/reports/CairnFenceCard.tsx`, `ReportCardsBlock.tsx` — render a fence body
  inline: `parseCairnSpec` → resolve runs (`useRunSelectorResolution`) → `useMetricIndex` →
  `compileCairnBlock` → write inline settings → `ReportCardsBlock` → `CardRenderer`.

**React render path:**
- `cairn/ui/src/main.tsx` — SPA bootstrap: `createBrowserRouter` (react-router-dom 6),
  `QueryClientProvider` (staleTime 2s), routes list (`:34-70`). `/login` sits outside `<App>`.
- `cairn/ui/src/App.tsx` — chrome shell only (header/footer + `<Outlet/>`); **no dedicated auth or
  theme provider** — auth is cookie-based, queried via `useSession`; theming is CSS
  (`index.css`/tailwind tokens). A minimal card mount needs only `QueryClientProvider` + `index.css`.
- `cairn/ui/src/components/CardRenderer.tsx` — `CardDescriptor` union (`:63-92`: `series` |
  `multi-run`); dispatch on `props.kind` then `metric.object_type` (`:135-320`). Cards fetch their
  own data from the server via `useSequence`/`api` (react-query) — **every card is server-anchored
  by `(runId, name, context_hash)`; there is no inline-data card today.** Switch handles more
  `object_type`s than the union declares (adds `table`, `html`, `markdown`, `artifact`).
- `cairn/ui/src/components/PluginCard.tsx` — **the Pyodide precedent** (see below).
- `cairn/ui/src/components/card-kit/use-iframe-auto-height.ts` — host-side subscriber for the
  `cairn:resize` postMessage (`min`/`max` clamps; ignores height 0). Reused by `HtmlCard`.

**Pyodide / iframe exec precedent:**
- `PluginCard.tsx`: `PYODIDE_CDN` (`:62`), `buildPyIframeSrcdoc` (`:128-162`) builds a **blob-URL
  iframe**; the **Python path gets NO `sandbox` attribute** (`:307-311` sets `sandbox` only for
  `lang==="js"`) — a known isolation wart. Loads Plotly + Pyodide from CDN, `# cairn-requires:`
  micropip install (`:136`), injects a stub `cairn` module with plugin base classes (`:139-152`).
  Protocol: host→frame `cairn:render` (ArrayBuffer transfer), frame→host `cairn:resize`
  (`protocolVersion:1`, "receivers MUST ignore unknown fields", `:117`). Python plugin returns
  **HTML** injected into `#output` (`:158`) — **no reverse structured channel, no in-Pyodide card
  builder** exists.
- `cairn/server/routes/plugin_ws.py` — the **server-side** exec surface (`exec()` of plugin source
  in-process, `:95`; `WindowPlugin` spawns subprocesses). Gated by `auth.authenticate_ws` +
  `close(4401)` **before** `accept()` (`:362-373`); cookie-only. **Sandbox model: none — auth is the
  sole boundary** (spec-auth §Non-goals). This is the RCE-shaped precedent; simple-mode Python cells
  deliberately do NOT follow it (they stay client-side).

**Server + auth:**
- `cairn/server/app.py` — `create_app(...)` (`:54`), `app.state.auth_enabled` (`:142`), CORS
  (`:144-157`: `allow_origins=[]` when auth on, `["*"]` when off), router tiers
  (read-role loop `:177-192`, write-role `:195-196`, `plugin_ws` self-gated `:202`), SPA mount
  `_mount_spa_or_placeholder` (`:223-273`): `/assets` StaticFiles + a catch-all `/{path:path}`
  (`:248-259`) that serves `index.html` for any non-`/api` path and **404s `/api/*`**.
- `cairn/server/auth.py` — `ROLE_RANK` read<write<admin (`:40`), `require_role` dependency factory
  (`:403-426`, **no-op returning None when `auth_enabled` is false**), `_principal_from_request`
  (Bearer then `cairn_session` cookie, `:389-400`), `authenticate_ws` (cookie-only, `:429`),
  token/session/otp/ssh machinery.
- `cairn/server/routes/reports.py` — CRUD; opaque JSON `payload`; read-role router + per-route
  `_write = Depends(auth.require_role("write"))` overrides. `cairn/server/routes/_common.py` —
  `get_db`/`get_blobs`/`require_run`/`utc_now`.
- `cairn/server/routes/artifacts.py` — byte serving by digest with HTTP Range (`GET /api/artifacts/
  {digest}`); artifact bytes in content-addressable `storage/blobs.py` (sha256 → path).
- `.superpowers/sdd/spec-auth.md` — the auth model; §5 names plugin_ws as "the exec/RCE-shaped
  surface"; §Non-goals defers exec sandboxing ("auth is the boundary"). §7 CORS: same-origin
  posture; canvas-export note (same-origin sends cookies regardless of `crossOrigin="anonymous"`).

**Python SDK:**
- `cairn/__init__.py` — top-level exports (`:42-74`): `Run`, `Reader`, `plot`, the type wrappers
  (`Image`, `Figure`, `Table`, `Html`, `Markdown`, `Tensor`, 3D types…), `log_artifact` etc. **No
  report/card builder, no `_repr_*`, no jupyter/marimo — greenfield.**
- `cairn/sdk/wrappers.py` — `_TypeWrapper` with a class-attribute `object_type` (`:13-20`); concrete
  wrappers (`Image` `object_type="image"`, `Figure` `"figure"`, `Table` `"table"`, `Html` `"html"`,
  `Markdown` `"markdown"`, …). **These already mirror the TS `object_type` strings** — the natural
  Python vocabulary for `cairn.card`.
- `cairn/sdk/transport.py` — `Transport(server_url, *, token=…)` (`:45-71`); Bearer header from
  `config.resolve_token` (explicit arg > `CAIRN_TOKEN` env > config.toml `token`); `post_json`
  (`:115`), `get` (`:123`). `cairn/sdk/discovery.py` — `resolve_target(repo=…)` resolves server
  URL. `cairn/config.py` — config/env (pydantic-based).
- `cairn/plot.py` — pure-numpy helpers returning **`plotly.graph_objects.Figure`** (`:1-5`,
  `confusion_matrix`/`pr_curve`/`roc_curve`/`bar`/`line_series`). A Figure has `.to_html(...)` → a
  **self-contained HTML string** (the offline-plot alternative for `_repr_html_`).
- `pyproject.toml` — Python deps include **`pydantic>=2.0`** (available for schema validation). UI
  `package.json` — TypeScript 5.6 / vite 5 / react-router-dom 6; **no JSON-schema-gen tooling yet**
  (must be added as a devDependency).

---

## 3. Piece 2 first — the card-spec single source of truth (the linchpin)

Everything Python (the API and the in-cell builder) depends on Python and TS agreeing on the card
spec. This is the top anti-drift lever, so it ships **before** the API.

### 3.1 The problem, precisely

There are **three competing "card type" definitions** in TS today (per the type-graph study):

1. The **closed union** `ComparisonCard.type` (16 members) — `comparisons/types.ts:19`.
2. The **looser runtime guard** `isComparisonCard` — accepts *any* non-empty `type` string
   (`:118-135`) so new types don't silently drop.
3. The **renderer switch** on `metric.object_type` — handles `table`/`html`/`markdown`/`artifact`
   **which are absent from the union** (`CardRenderer.tsx:177+`).

Plus per-card `settings` are an **untyped side-channel** (`Record<cardId, unknown>`), so a naive
schema cannot yet validate per-type settings. A single-source schema must first **reconcile the
card-type vocabulary**.

### 3.2 Decision: TS is authoritative; generate a JSON Schema; Python validates

**Mechanism (concrete, not hand-wave):**

1. **Introduce one canonical TS enum** `CARD_TYPES` (a `const` array) in
   `cairn/ui/src/lib/reports/card-spec.ts` (new) that is the union of the renderer's real cases
   (the 16 + `table`/`html`/`markdown`/`artifact`). Re-point `ComparisonCard.type` and the renderer
   switch at it so the three definitions converge to one list. This is a small, self-contained
   refactor and is a prerequisite (it removes the `object_type as ComparisonCard["type"]` casts).
2. **Author the schema root as TS types** in that same `card-spec.ts`: `CardSpec` (≈ `ComparisonCard`
   + optional `settings`), `SeriesRef` (= `ComparisonSeriesRef`), `RunSelectorSpec` (= `RunSelector`),
   `CardsSpec` (≈ `CairnSpec`: `runs` + `cards[]` + `title`), and `ReportSpec` (= the `source`
   string plus metadata for `publish`). Keep `settings` typed as a **discriminated union keyed by
   card type** where a shape is known (start permissive: `Record<string, JSONValue>` with a few
   well-known keys like `yScale`, `smoothing`, `step`), tightening over time. The goal is a schema
   that is *correct-by-construction*, not exhaustive on day one.
3. **Generate JSON Schema** from those TS types with **`ts-json-schema-generator`** (add as a UI
   devDependency; it handles unions/enums/`const` arrays cleanly, unlike `typescript-json-schema`).
   Output → `docs/schemas/cairn-card-spec.schema.json`, committed. A tiny script
   `cairn/ui/scripts/gen-card-spec-schema.ts` runs it; wire an npm script `schema:gen`.
4. **CI drift-check:** a check step re-runs `schema:gen` into a temp file and `diff`s against the
   committed schema; non-empty diff fails CI. (Mirror the existing round-trip test discipline in
   `cairn/ui/src/lib/reports/*.round-trip.ts`.) Add a round-trip test: a fixture spec →
   `compileCairnBlock` accepts it → serialize → re-parse equals.
5. **Python side:** at build time (or a committed generated module), turn the JSON Schema into a
   **pydantic v2 model** (`datamodel-code-generator`, or hand-write thin pydantic models validated
   against the schema with `jsonschema` at runtime). `cairn.card(...)` builders return these models;
   `.model_dump()` yields the exact YAML/JSON the TS `parseCairnSpec` consumes. Python **never**
   parses markdown and **never** re-implements `cardFromSpec` — it only *emits* validated specs.

**Why this and not alternatives:** hand-maintaining two schemas drifts (the whole point); a runtime
"TS is the only validator" (Python posts, server/TS rejects) gives bad Python DX (no local
validation, errors only at render). Generating from TS keeps TS authoritative *and* gives Python
local validation. `ts-json-schema-generator` is a mature, single-purpose tool with no runtime cost
(build-time only). **Open question O1** records the codegen-tool choice for the user.

### 3.3 The `cairn.card` / `cairn.Report` Python API

New module `cairn/sdk/report.py`, re-exported as `cairn.Report`, `cairn.card`, `cairn.cards`,
`cairn.runs`. Builders produce validated spec dicts (the `` ```cairn `` shape), and `Report`
assembles the canonical markdown `source`:

```python
import cairn

r = cairn.Report(name="Ablation study", project="proj")
r.md("## Results\nBaseline vs. ablation.")
r.cards(
    runs=cairn.runs.select(mode="newest-per-name", name_pattern="ablate-*", n=5),
    cards=[cairn.card("scalar", metric="val/loss", settings={"yScale": "log"}),
           cairn.card("scalar", metric="val/acc")],
)
r.publish()          # POST /api/projects/{proj}/reports  {name, payload:{source}}
r                    # in a notebook: renders live cards inline (see §5)
```

- `cairn.card(type, *, metric=…, series=…, settings=…)` returns a `CardSpec` (validated against the
  schema). `cairn.runs.select(...)` mirrors `QueryRunSelector`. `cairn.cards(...)`/`r.cards(...)`
  emit one `` ```cairn `` fence; `r.md(str)` appends a prose region; `r.source` yields the canonical
  markdown.
- `publish()` = `transport.post_json("/api/projects/{id}/reports", {name, payload:{source}})`,
  reusing the Bearer chain; `require_role("write")` already enforced server-side. Payload is
  source-only (AR1 §6) — the server never parses it; the UI does.
- The **Python vocabulary reuses the existing `_TypeWrapper.object_type` strings** (`wrappers.py`) so
  `cairn.card("image", …)` etc. line up 1:1 with the TS `object_type` cases.
- **CLI** `cairn report add FILE.md --project P` uses the same funnel (a raw markdown file → `{source}`).
- **`block_count` fix (prior spec B11):** the reports list must count from `source` when `blocks`
  is absent, so a source-only Python report doesn't show "0 blocks."

---

## 4. Piece 3 — the `/embed/card` route + minimal embed SPA (standalone-card foundation)

This is the render foundation for notebook embedding **and** the substrate the Python display
protocol (§5) and (optionally) the pyodide cell output can point at. It ships alongside the schema.

### 4.1 What it renders

A **single card** from a spec, using the existing `CardRenderer` — **zero card reimplementation**.
The card spec is exactly a `CardsSpec`/`CardSpec` (§3). The route serves a **new minimal SPA entry**,
not the full app shell.

### 4.2 Spec delivery: short-lived server-stored spec id (not a giant URL)

Card specs can reference many runs/series and settings; base64-in-URL is brittle (length limits,
logging, sharing). Decision:

- **`POST /api/embed/specs`** (write-role) — stores a spec JSON in a new `embed_specs` table
  (`id = secrets.token_hex(8)`, `project_id`, `spec TEXT`, `created_at`, `expires_at` ~ 30 days,
  `created_by_token`). Returns `{ sid }`. Idempotent by content hash (same spec → same sid) so
  re-rendering a notebook cell doesn't leak rows.
- **`GET /api/embed/specs/{sid}`** (read-role) — returns the stored spec JSON. TTL-checked.
- The **embed page** is served at **`GET /embed/card`** (a non-`/api` HTML route, so it flows through
  the SPA static path — see §4.3) and reads `?sid=…` client-side, then fetches
  `/api/embed/specs/{sid}` (same-origin, cookie/Bearer carried) to get the spec, then renders.
- **Also allow `?spec=<base64url>`** for *tiny* inline specs (a single scalar card, no settings) so a
  trivial embed needs no POST — but the `sid` path is the default for anything non-trivial.

The Python object (`§5`) does the `POST /api/embed/specs` at display time and builds
`{server}/embed/card?sid={sid}` as the iframe `src`.

### 4.3 Serving the embed SPA (reuse the existing bundle, new entry)

The **precedent for "render one card from a spec object" already exists** and must be reused:
`ReportCardsBlock.tsx`'s `ReportCardRenderer` (`:447-504`) builds a **synthetic seed
`SequenceMeta`** from a card spec — proving `object_type` is the *only* `metric` field the dispatch
needs, plus `name`/`context_hash` to fetch — and hands it to `<CardRenderer>`:

```ts
const seedMetric: SequenceMeta = { name: primary.name, object_type: card.type,
  context: null, context_hash: primary.context_hash, min_step: 0, max_step: 0, count: 0 };
<CardRenderer runId={primary.runId} metric={seedMetric}
  extraSeries={card.series.slice(1)} controlledSeries
  settingsKeyOverride={cardSettingsKeyForReport(reportId, card)} />
```

The embed page is exactly this pattern, standalone:
- Add a **second vite entry** `cairn/ui/embed.html` + `cairn/ui/src/embed-main.tsx`. It mounts
  **only** `QueryClientProvider` (reuse the `main.tsx` config) + `CardMutationContext.Provider
  value={false}` (freeze settings → read-only, exactly like report view-mode, `card-settings.ts:36`)
  + a new `<EmbedCardPage>` that: reads `sid`/`spec`, fetches the spec, resolves runs
  (`useRunSelectorResolution` for a selector, else static ids), builds the synthetic seed metric per
  the snippet above, and renders `<CardRenderer/>`. It **must import `index.css`** and set the base
  `bg-bg text-fg` classes or cards render unstyled. **No `<App>` chrome, no router.** This reuses
  every card component, card-kit hook, and the api client verbatim.
- **Bypass the 401→`/login` hard-redirect** (`api/client.ts:14-30`, `redirectToLogin`) in the embed
  entry: an embed must surface an auth error inline, not navigate the iframe to the login page.
- Vite `build.rollupOptions.input` gets `{ main: index.html, embed: embed.html }`; the build emits
  `dist/embed.html` + shared `dist/assets/*`. **Commit `dist/`** (memory: pip installs can't always
  build). *(Simpler alternative: register `/embed/card` as a top-level route inside the existing
  `createBrowserRouter` — the SPA catch-all already serves `index.html` for any non-`/api` path, so
  no server route is even needed — but that ships the full app bundle. Lazy card chunks mitigate it;
  the separate-entry approach is leaner and is the recommendation, decision O-embed-entry.)*
- Server: in `_mount_spa_or_placeholder` (`app.py:223`), add an explicit
  `@app.get("/embed/card")` returning `dist/embed.html` bytes (read once at startup, like
  `index.html`). It stays **outside `/api`**, so it is a *public shell* (no data) — same posture as
  the SPA catch-all; the data (`/api/embed/specs/{sid}`) is what enforces auth. Register before the
  catch-all.

### 4.4 Sizing / auto-height for iframe embedding

**Correction to a common assumption:** cards do **not** auto-fill their container. `CardShell`
(`CardShell.tsx:88-102`) sets an **explicit inline pixel `height`** = `resolveCardHeight(settings,
defaultHeight, min)` (per-type `defaultHeight`, e.g. image 400, scalar ~180; clamped to
`CARD_MIN_SIZES`) and assumes a **CSS grid parent** via `gridColumn: span ${colSpan ?? 3}`. So a card
dropped into the embed page will take its fixed default height and its grid span is inert without a
grid. The embed layout must therefore:
- Provide a single-column grid (or override `gridColumn`/`colSpan`) so the card lays out at full
  width; and
- Either accept the per-type `defaultHeight`, or **pre-seed a height** via `saveCardSettings` under
  the embed's `settingsKeyOverride` (the `CairnFenceCard.tsx:124-133` pattern) when the caller
  requests a specific size.
- Some cards *do* grow to content: `VisualContentCard` computes height from image aspect ratio, and
  `HtmlCard`/`PluginCard` auto-grow their inner iframes via `cairn:resize` within min/max bounds.
- The embed page then measures its own rendered card (a `ResizeObserver` on the mount root) and posts
  `{type:"cairn:resize", height, protocolVersion:1}` to `parent` — **reusing the exact existing
  protocol** (`use-iframe-auto-height` / PluginCard `:117`). The notebook side (`_repr_html_`
  snippet) includes a ~15-line listener that sets the outer `iframe.style.height` on `cairn:resize`
  from the known iframe origin. `min`/`max` clamps mirror `PLUGIN_MIN/MAX_HEIGHT`.

### 4.5 Auth for `/embed/card` — same-origin vs cross-origin (the crux)

Embedding **private run/artifact data** requires credentials. Two cases:

- **Same-origin notebook (local `cairn ui`, the common case):** the notebook and server share an
  origin from the browser's view only if the notebook is served from the cairn origin — usually it
  is **not** (Jupyter runs on `:8888`, cairn on `:PORT`). So even "local" is effectively
  cross-origin. However, with **auth OFF** (the documented local-dev posture, `--no-auth`, CORS
  wildcard), the embed just works: no credentials needed, `require_role` is a no-op.
- **Auth ON / remote notebook (cross-origin):** the iframe is a *third-party* context. Cookies are
  `SameSite=Lax` + `HttpOnly`, so a cross-site iframe **will not send the `cairn_session` cookie**,
  and CORS is `allow_origins=[]` (same-origin only). Options, in preference order:
  1. **Signed, short-lived embed token in the URL** (recommended). `POST /api/embed/specs` (Bearer,
     from the notebook's SDK token) returns not just `sid` but a **signed capability token** scoped
     to *that sid, read-only, ~1h TTL*. The embed page presents it as `?t=…`; `/api/embed/specs/{sid}`
     and the downstream data reads accept this **sid-scoped token** (a narrow auth path that grants
     read of *only the runs/artifacts referenced by that spec*, not general API access). This keeps
     the powerful SDK token out of the URL while letting a remote iframe fetch exactly the embedded
     card's data. Implemented as a new `verify_embed_token` path in `auth.py` alongside Bearer/cookie.
  2. **Cookie via top-level OTP** — only works when the notebook and cairn are same-site; not general.
  3. **Static snapshot fallback** — if no server reachability/credentials, `_repr_html_` embeds a
     server-rendered PNG/HTML snapshot instead of a live iframe (offline/exported notebooks). For
     `cairn.plot` figures, the snapshot is just `fig.to_html()` (self-contained) — no server at all.
- **CORS carve-out:** `/api/embed/specs/*` (and the sid-scoped data reads) need
  `Access-Control-Allow-Origin` for the remote-notebook origin when using the capability-token path.
  Because credentials ride in the URL token (not cookies), `allow_credentials` stays `False` and we
  can allow a configured embed-origin allowlist (a new `--embed-origins` server flag) without
  reintroducing the wildcard+credentials anti-pattern. This is the **only** sanctioned cross-origin
  API surface; document it loudly.
- **Canvas-export/CORS note:** the embed card renders same-origin *within its own iframe* (assets +
  data both from the cairn origin), so chart canvas export (`exportChartFromContainer`) keeps
  working inside the iframe; the parent notebook cannot read the cross-origin iframe's canvas (by
  design — that's the isolation).

### 4.6 Security posture of `/embed/card`

- The embed shell is **public HTML with no data** (like the SPA shell). All data is behind
  `/api/embed/specs/*`, gated by cookie/Bearer/sid-token — the standard trust boundary.
- The **sid-scoped capability token** is the new sensitive primitive: it must grant read of *only*
  the runs/artifacts named in that spec, be short-lived, single-scope, and revocable by TTL. A
  security-review gate covers token minting/verification, TTL, scope enforcement, and the
  embed-origin allowlist. No exec surface is introduced by this piece.

---

## 5. Python display protocol (`_repr_mimebundle_` / marimo) — Piece 3 client half

`cairn.card(...)` and `cairn.Report` objects implement notebook display. The object knows the server
URL + auth via the same `Transport`/`discovery`/`config` chain the SDK already uses
(`resolve_target`, `resolve_token`).

- **`_repr_mimebundle_(self, include, exclude)`** (works in **both** Jupyter and marimo) returns:
  - **Primary — live iframe:** `text/html` = `<iframe src="{server}/embed/card?sid={sid}[&t={tok}]"
    …>` plus the ~15-line `cairn:resize` listener (auto-height). The object calls
    `POST /api/embed/specs` at display time to get `sid` (+ capability token if auth on). This is the
    live path — cards query the server and stay fresh.
  - **Fallback — static HTML:** for a `cairn.plot` Figure or when the server is unreachable, return
    `fig.to_html(include_plotlyjs="inline", full_html=False)` — a **self-contained Plotly HTML**
    block, no server, no iframe. `cairn.plot` helpers already return plotly Figures
    (`plot.py`), so `cairn.plot.roc_curve(...)._repr_html_()` "just works" offline.
  - A `text/plain` entry (repr string) for terminals.
- **`_repr_html_`** delegates to the same iframe/HTML builder (older Jupyter, nbconvert).
- **marimo:** `_repr_html_`/`_repr_mimebundle_` render in marimo cells directly; a reactive
  `anywidget` wrapper (live re-query on cell re-run) is a **v2 nicety**, not required for v1.
- **Auth + server-URL discovery:** the object resolves the HTTP base via **`config.resolve_server()`**
  and the token via **`config.resolve_token()`** (env `CAIRN_REPO`/`CAIRN_TOKEN`, `configure()`, or
  `~/.config/cairn/config.toml`), mirroring `Transport`'s own wiring. Display-only needs a `read`
  token; `publish()` needs `write`. No notebook-specific auth, **never server-side key custody**
  (AR1 §8). **Caveat — pure-local `file://` mode:** `resolve_target` yields a `file://…` location when
  no server/UI is running, so **there is no embeddable HTTP URL**; in that case the object *must* fall
  back to the static Plotly-HTML / snapshot path (or instruct the user to start `cairn ui`). The live
  iframe requires a reachable HTTP server.
- **Degradation contract:** a single `cairn.card`/`Report` object tries live iframe → falls back to
  static snapshot/Plotly HTML → falls back to `text/plain`. The user gets *something* in every
  environment.

---

## 6. Piece 1 — in-browser Python cells (simple report mode, Pyodide)

Extends `2026-07-05-notebook-reports.md` §D. This is the client-side Python execution surface. It
builds on the schema (§3) and reuses the pyodide precedent in `PluginCard`.

### 6.1 Execution model — client-side Pyodide only

- **Factor the Pyodide runtime out of `PluginCard.tsx`** (`buildPyIframeSrcdoc` + iframe lifecycle +
  `cairn:resize` + `useIframeAutoHeight`) into a reusable `card-kit/pyodide-sandbox.ts`. A new
  `<PythonCell>` component mounts that sandbox, feeds it the cell source on **Run (▶)**, and renders
  output. Same CDN load, same `# cairn-requires:` micropip handling, same error boxing.
- **No server-side execution.** Simple-mode Python runs entirely in the browser's Pyodide/WASM VM.
  Server-spawned kernels are the separate #60 B1 path and are **explicitly out of scope**. There is
  **no new server exec surface** in this spec.

### 6.2 The reverse channel — declarative specs only (new `cairn:cards`)

- Add one **frame→host** message: `{ type: "cairn:cards", specs: CardSpec | CardSpec[],
  protocolVersion: 1 }`.
- The cell's Python calls an injected in-Pyodide **`cairn` builder** — the *same* builder as the SDK
  `cairn.card`/`cairn.runs` (§3.3), compiled into Pyodide (one implementation, two runtimes). It
  accumulates `CardSpec`s and posts them.
- The host **validates each spec against the JSON Schema** (§3), then renders via the **existing**
  `compileCairnBlock` → `cardFromSpec` → `CardRenderer` pipeline in the cell's output area.
- **No HTML, no arbitrary DOM crosses the boundary** — unlike plugin cards (which inject HTML,
  `PluginCard.tsx:158`), a python *cell* can only *display* via the sanctioned declarative path.
  This is the key security upgrade over plugins.

### 6.3 Data access — mediated, never a raw token

- A cell computes over real run data via **`cairn.query(...)`**, which is a `cairn:query`
  request/response over postMessage that the host proxies through the **already-authenticated UI API
  client** (react-query / `api`). The cell never receives a token and has no `fetch` to the cairn
  origin (the sandbox forbids it; see §7). This lets a cell filter/compute over run metrics, then
  emit specs referencing those metrics.
- **Two output modes** (matching CardRenderer's metric-anchored constraint):
  - **(a) Reference mode (v1):** emitted specs reference **existing tracked metrics**
    `(runId, metric, context_hash)` → compile through `cardFromSpec` with zero new card machinery.
    Covers "plot val/loss for the newest 5 ablation runs, filtered in Python."
  - **(b) Inline-data mode (v2, deferred):** a cell computes a *novel* array/figure with no server
    metric to anchor to → needs a **new `inline` card variant** that `CardRenderer` renders from
    spec-embedded data (e.g. a Plotly figure JSON). CardRenderer is 100% server-anchored today; this
    is net-new and defers behind (a). (A stopgap: a cell can emit a `cairn.plot`-style Plotly HTML
    into an `html` card, but that's the HTML path, not a first-class card.)

### 6.4 Persistence of cell code + outputs

- The **cell source** persists in a `` ```python `` fence in the canonical `source` (extend
  `splitFences` to extract `python` fences alongside `cairn`, per the prior spec §B). The **last
  emitted specs** are frozen into an adjacent `output:`-tagged region so reopening a report shows
  cards **without auto-executing untrusted code**.
- **Auto-run policy = opt-in per cell.** Default on reopen: show frozen output + offer Run. A shared
  report never silently runs an author's Python.

### 6.5 Execution UX

- Run (▶), running spinner, output area, inline error rendering (reuse the `` ```cairn `` error
  banner style). Optional reactivity: a cell re-runs when the report's run-selector resolution
  changes (mirrors existing refresh).

---

## 7. Security model (mandatory — browser Python execution)

**What runs where:**
- **Simple-mode Python cells run only in the browser**, inside a Pyodide/WASM VM hosted in an
  `<iframe>`. **Nothing executes on the server.** There is no new server exec surface anywhere in
  this spec. (The server's *existing* exec surface — `plugin_ws.py` — is untouched and remains behind
  auth per spec-auth §5.)

**Sandbox properties (and the wart to fix):**
- Today `PluginCard`'s **Python iframe has NO `sandbox` attribute** (`:307-311`) — a real isolation
  gap. For Python *cells* we **fix this**: serve Pyodide + the frame from a controlled origin so the
  iframe can carry `sandbox="allow-scripts"` **without** `allow-same-origin`. That denies the cell:
  DOM access to the parent, cookies, `localStorage`, and same-origin `fetch` to the cairn API.
  Options: (i) self-host the Pyodide assets under the cairn origin and use `srcdoc` + `sandbox`
  (preferred — also removes the CDN supply-chain dependency), or (ii) a dedicated sandbox origin.
  This is a **hard requirement** for the Python-cell workstream (unlike the plugin path, which stays
  as-is until separately hardened).
- The frame communicates **only** via `postMessage` (`cairn:render`-style in, `cairn:cards`/
  `cairn:query`/`cairn:resize` out). All messages are **origin-checked** and schema-validated;
  "receivers MUST ignore unknown fields."

**What an attacker-authored report/cell could attempt, and why it's contained:**
- *Exfiltrate data / call the API with the user's credentials* → **contained**: the sandbox has no
  `allow-same-origin`, so no cookies and no same-origin `fetch`; the only data path is
  `cairn.query` → host proxy, which runs with the *viewer's own* already-authenticated client and is
  read-only. The cell never sees a token. (Residual: a cell could ask `cairn.query` for data the
  viewer can already see — that's the viewer's own privilege, not escalation.)
- *Inject HTML/JS into the report page (XSS)* → **contained**: cells emit **declarative specs only**;
  no HTML/DOM crosses the boundary. The specs are validated against the schema and rendered by
  trusted React components. (The HTML/plugin injection path remains solely the explicit `PluginCard`,
  which is separately gated.)
- *Escape the WASM VM / run native code on the server* → **contained**: Pyodide is WASM in the
  browser; there is no server round-trip for execution.
- *DoS via infinite loops / memory* → **partially mitigated**: it's the *user's own browser tab*;
  add a run timeout + "stop" that tears down the worker/iframe. Not a server DoS.
- *Auto-run on report open* → **prevented by policy**: frozen-output-by-default; explicit opt-in run.

**Trust/auth boundary:**
- The report document itself is created/edited behind `require_role("write")` (`reports.py`); viewing
  behind `read`. The pyodide cell adds **no** new privilege — it can only display via specs and read
  via the viewer's existing client. The `/embed/card` sid-capability token (§4.5) is the only new
  auth primitive and is narrowly scoped + short-lived, covered by its own review gate.
- **Explicit non-goal:** server-side kernels / server exec for simple-mode Python. Any such surface
  would follow the `plugin_ws` precedent (auth as boundary) and is #60 B1, separately specced.

**Review gate:** a mandatory security-review subagent runs on the Python-cell workstream (sandbox
attributes, postMessage origin checks, schema validation of `cairn:cards`, the `cairn:query` proxy's
read-only + viewer-scoped enforcement, no token leakage into the frame) and on the embed workstream
(sid-token scope/TTL, embed-origin allowlist, catch-all/`/api` leak invariants).

---

## 8. Shared foundation + phasing (dependency-ordered)

The **card-spec schema (§3)** and the **`/embed/card` route + embed SPA (§4)** are the shared
foundation. The Python API (§3.3/§5) and the pyodide cells (§6) build on them.

```
                 ┌──────────────────────────────────────┐
  WS-SCHEMA  ───▶│ card-spec single source (JSON Schema, │───┐
  (Phase 1)      │ pydantic model, CI drift-check)       │   │
                 └──────────────────────────────────────┘   │
                 ┌──────────────────────────────────────┐   ├─▶ WS-PYAPI (Phase 3)
  WS-EMBED   ───▶│ /embed/card route + embed SPA entry + │───┤   cairn.Report/card,
  (Phase 2)      │ embed_specs store + sid(+token) auth  │   │   _repr_mimebundle_,
                 └──────────────────────────────────────┘   │   publish(), CLI
                                                             │
                                                             └─▶ WS-PYCELL (Phase 4)
                                                                 <PythonCell> + pyodide-sandbox
                                                                 + cairn:cards/query + sandbox hardening
```

- **Phase 1 — WS-SCHEMA (unblocks all Python).** Reconcile the card-type vocabulary into one
  `CARD_TYPES`; author `card-spec.ts` schema-root types; add `ts-json-schema-generator` +
  `schema:gen` + committed `docs/schemas/cairn-card-spec.schema.json`; CI drift-check + round-trip
  test; generate/write the pydantic model. **Review gate:** type-reconciliation review (no card
  silently dropped) + schema round-trip test green.
- **Phase 2 — WS-EMBED (foundation for notebook + cell output).** `embed_specs` table +
  `POST/GET /api/embed/specs`; sid-scoped capability token in `auth.py`; `embed.html`/`embed-main.tsx`
  minimal SPA entry rendering one card via `CardRenderer`; `GET /embed/card` server route;
  `cairn:resize` auto-height; `--embed-origins` CORS carve-out; commit `dist/`. **Security-review
  gate** (sid-token scope/TTL, origin allowlist, `/api` leak invariants) → fix round → browser-verify
  (render a private card in an iframe from another origin with a sid-token, auth on and off).
- **Phase 3 — WS-PYAPI (needs 1 + 2).** `cairn/sdk/report.py` (`Report`/`card`/`cards`/`runs`
  builders validating against the Phase-1 schema); `publish()` via `Transport`; CLI `cairn report
  add`; `_repr_mimebundle_`/`_repr_html_` (live iframe → static Plotly HTML fallback) pointing at
  Phase-2 `/embed/card`; `block_count` source-tolerant fix. **Review gate:** Python↔TS round-trip
  (Python builds spec → validates → TS `compileCairnBlock` accepts) + Jupyter & marimo display
  smoke tests.
- **Phase 4 — WS-PYCELL (needs 1 + 3; leans on 2's protocol).** Factor `card-kit/pyodide-sandbox.ts`
  out of `PluginCard`; `<PythonCell>` + `cairn:cards` reverse message + `cairn:query` proxy; inject
  the shared `cairn` builder into Pyodide; extend `splitFences` for `` ```python `` fences; freeze
  output; **sandbox hardening (self-host Pyodide + `sandbox` attr)**. Reference-mode cards only (v1).
  **Mandatory security-review gate** (§7 checklist) → fix round → re-review → browser-verify.
- **Phase 5 (deferred) — inline-data cards** (new `CardRenderer` variant), reactive marimo
  `anywidget`, and any further hardening. Behind everything above.

**Why this order:** the schema is the anti-drift linchpin every Python surface needs; `/embed/card`
is the render foundation the notebook display *and* (optionally) the cell output can reuse; the
Python API is needed by the pyodide cell (shared builder). Pyodide cells ship **last** because they
carry the security surface and depend on both the schema and the builder.

---

## 9. Risks + open questions (for the user to decide)

**Top 3 open questions:**
- **O1 — Schema codegen toolchain.** Confirm `ts-json-schema-generator` (TS→JSON Schema) +
  `datamodel-code-generator` (JSON Schema→pydantic), vs. hand-written pydantic validated at runtime
  with `jsonschema`, vs. adopting `zod` in TS as the authoring source. Recommendation:
  `ts-json-schema-generator` + committed schema + generated pydantic, with a CI drift-check. This is
  the single most load-bearing tooling choice.
- **O2 — Cross-origin embed auth for remote notebooks.** Approve the **sid-scoped, short-lived
  capability token in the embed URL** + `--embed-origins` CORS allowlist as the sanctioned
  cross-origin path (the only one), with the static-snapshot fallback when unavailable? This is a
  real (if narrow) widening of the same-origin posture and needs an explicit yes.
- **O3 — Pyodide sandbox hardening cost.** Self-hosting Pyodide (to enable a real `sandbox` attr and
  drop the CDN dependency) adds bundle weight/build steps and is a hard prerequisite for shipping
  Python cells safely. Accept that cost, or ship cells only in `--no-auth`/local mode until hardened?

**Further risks / questions:**
- **R1 — Card-type reconciliation churn.** Converging the three card-type definitions touches the
  renderer switch and `ComparisonCard.type`; must not drop `table`/`html`/`markdown`/`artifact` or
  break existing reports. Guarded by the round-trip test.
- **R2 — `settings` schema depth.** Per-card settings are untyped today; the schema starts permissive
  and tightens. Decide how strictly Python validates settings vs. passing them through.
- **R3 — Pyodide package availability.** `# cairn-requires:` micropip can't install arbitrary
  native wheels; document the supported package set (numpy/pandas/plotly are fine; torch is not).
- **R4 — Inline-data cards (v2).** Is reference-mode enough for v1, or do users need cells that emit
  novel in-browser-computed figures (new `CardRenderer` variant)? Affects Phase 5 scope.
- **R5 — Frozen-output staleness.** A shared report showing frozen cell output may mislead if the
  underlying runs moved; how is "output is stale / re-run to refresh" surfaced?
- **R6 — `embed_specs` growth/GC.** TTL + content-hash idempotency bound growth; confirm a cleanup
  job and the default TTL.

---

## 10. Proposed workstream + gate breakdown (summary)

| WS | Ships | Depends on | Gate(s) |
|----|-------|-----------|---------|
| **WS-SCHEMA** (P1) | `CARD_TYPES` reconcile; `card-spec.ts`; JSON Schema + gen script + CI drift-check; pydantic model | — | Type-reconcile review; schema round-trip test |
| **WS-EMBED** (P2) | `embed_specs` store; `/api/embed/specs`; sid-capability token; `embed.html`/`embed-main.tsx`; `/embed/card`; auto-height; `--embed-origins`; commit dist | — | **Security review** (token scope/TTL, origin allowlist, `/api` leak) → fix → browser-verify (private card in cross-origin iframe, auth on/off) |
| **WS-PYAPI** (P3) | `cairn/sdk/report.py` (`Report`/`card`/`runs`); `publish()`; CLI `report add`; `_repr_mimebundle_`/`_repr_html_`; `block_count` fix | WS-SCHEMA, WS-EMBED | Python↔TS spec round-trip; Jupyter + marimo display smoke |
| **WS-PYCELL** (P4) | `pyodide-sandbox.ts` (factored from PluginCard); `<PythonCell>`; `cairn:cards`+`cairn:query`; shared builder in Pyodide; `` ```python `` in `splitFences`; frozen output; **sandbox hardening** | WS-SCHEMA, WS-PYAPI | **Mandatory security review** (§7 checklist) → fix → re-review → browser-verify |
| **WS-INLINE** (P5, deferred) | inline-data `CardRenderer` variant; reactive marimo `anywidget` | WS-PYCELL | Review as scoped |

Reuse discipline (no duplication): **one** spec schema (TS→JSON Schema, Python validates, never
re-implement `cardFromSpec`); **one** card-build path (`cardFromSpec`); **one** markdown pipeline
(`<Markdown>`, Python never parses markdown); **one** Pyodide runtime (`pyodide-sandbox.ts`); **one**
postMessage protocol (`cairn:*`); **one** auth chain (Bearer/cookie + the narrow sid-token).

---

## 11. Requirements addendum (2026-07-07, user) — fluent element-builder API on WS-PYAPI

The Python API must let a user add **individual cairn-plot elements** ergonomically, not only whole
report payloads. Target ergonomics (illustrative):

```python
import cairn
import cairn.plot as cplot                                      # EXISTING cairn.plot, extended
r = cairn.reader()                                              # EXISTING reader
a = r.runs(project="p").filter(name__contains="segmenter").last()["predictions"]  # lazy tag data
b = r.runs(project="p").filter(tags__contains="baseline").last()["predictions"]
el = cplot.media_compare(a, b, mode="diff")     # data handles OR a raw np.ndarray / PIL image
el            # _repr_html_ / _repr_mimebundle_ / marimo → renders standalone in a notebook
report.add(el)                                                  # or drop into a report
```

**Data is decoupled from rendering.** `cplot.media_compare(...)` takes DATA (lazy tag handles or raw
images), not run+metric coordinates — mirroring the TS `cairn-plot` where a renderer takes a
`FrameSource` (`url | canvas | dataUrl`), not run identity.

Design constraints (fold into WS-PYAPI, no new render path):
- **Run references REUSE the existing Python reader — do NOT build a new run-access surface.**
  `cairn/sdk/reader.py` already provides `reader.runs(project=…).filter(…).last()/.first()/.list()`
  (a lazy `RunQuery`, Django-style `field__op=value` filters incl. `name__contains`, `tags__contains`,
  `metrics__*`, params; default sort `created_at` desc) returning `Run` objects with `.id`/`.name`/
  `.tags()`. "Latest" == default-desc + `.first()`/`.last()`/`limit`; filtering by name/tag/metric is
  already there. The element builders simply ACCEPT these `Run` objects (or ids/tags). If a Python-side
  "newest-per-name" convenience is genuinely missing, add it as a small terminal on the EXISTING
  `RunQuery`, not a new `cairn.runs.*` module. (The viewer-side `RunSelector` latest-n/newest-per-name
  in `lib/run-selector.ts` is a separate UI concern for auto-binding cards; the Python element API just
  takes the runs the reader returns — no duplication of run access.)
- **`run[tag]` is a lazy DATA handle** — `__getitem__` sugar over the EXISTING `Run.sequence(name)` /
  `Run.artifact(name, step)` (`cairn/sdk/reader.py`). It returns a lazy reference to the data behind
  that tag (image/mesh/scalar sequence or artifact), NOT a card — it resolves server-side only when the
  element is rendered (or is uploaded/inlined for a self-contained render). Optional step indexing
  (`run["predictions"][step]`) maps to the existing `step=` args.
- **`cairn.plot` is the EXISTING Python plotting module (`cairn/plot.py`), EXTENDED to be the Python
  mirror of `cairn-plot`.** It already has `confusion_matrix`/`pr_curve`/`roc_curve`/`bar`/`line_series`
  (pure-numpy → Plotly). Add the media/element builders alongside them — `cairn.plot.media_compare(a, b,
  mode="diff"|"split"|"blend"|"side")`, plus the rest of the `object_type` set (`scalar`, `mesh`/
  `pointcloud`/`volume`/`boxes`, `table`, `figure`, `html`, `markdown`). Do NOT invent a new
  `cairn.image.*`/`cairn.card.*` namespace — grow `cairn.plot`.
- **Builders take DATA, not run coordinates.** Each accepts EITHER a lazy `run[tag]` handle OR raw data
  (an `np.ndarray` / PIL image / bytes) — mirroring the TS `FrameSource` (`url | canvas | dataUrl`).
  This is the crux of "feed either it or an actual image": `media_compare(run_a["pred"], local_img)`
  is valid. The builder emits the ONE card spec (a `ComparisonCard`, validated against the WS-SCHEMA
  JSON schema; `cardFromSpec` stays the sole interpreter) whose two `FrameSource`s are: for a lazy
  server-backed handle → a by-reference artifact URL/hash (rendered via `/embed`); for raw data → an
  inline `dataUrl` (base64) so the element is SELF-CONTAINED (the WS-INLINE render path) and needs no
  server round-trip. The returned element's `_repr_html_`/`_repr_mimebundle_`/marimo produces exactly
  "the HTML/whatever Jupyter wants."
- **Element == standalone-renderable.** Every element implements `_repr_mimebundle_`/`_repr_html_` +
  marimo display (WS-EMBED iframe, or self-contained Plotly HTML offline), so `image.compare(a,b)` is
  useful in a bare notebook AND composable into `Report` (`report.add(el)` / list of elements).
- Keep the fluent layer a **thin typed façade** over (RunSelector + card spec); it introduces no new
  server route, renderer, or diff path. `compare(...)` sugar just sets the card's compare/diff mode +
  two series.

