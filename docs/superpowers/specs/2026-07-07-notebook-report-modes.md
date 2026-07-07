# Design: Notebook report MODES — marimo/jupyter as a first-class cairn REPORT in the viewer (#60 Piece B)

Status: **DESIGN ONLY** — read-only research spec. No code, no branch, no commit.
Author context: builds directly on the notebook-cards FOUNDATION already merged on `main`
(WS-SCHEMA / WS-EMBED / WS-PYAPI) and extends
`docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md` (esp. §4 `/embed/card`, §5 display
protocol, §6/§7 the Pyodide security model). This is **Piece B** of #60: making a whole notebook a
first-class cairn report **mode** rendered in the viewer, with the **WASM / client-side path
(marimo-to-WASM, JupyterLite) as the recommended default** over server-spawned kernels.

---

## 1. Summary / recommended shape

- **Recommended v1 = a `marimo` report mode rendered as a sandboxed WASM iframe**, produced by
  `marimo export html-wasm` and served by cairn like the existing `/embed/card` shell. No
  server-spawned kernel, no new RCE-shaped exec surface. The `jupyter` mode (JupyterLite) is the
  same shape, sequenced **after** marimo (marimo's html-wasm export is a single self-contained
  artifact and is markedly simpler to embed than a JupyterLite deployment).
- **A report gains `payload.mode: "simple" | "marimo" | "jupyter"`** (absent ⇒ `"simple"`, so every
  existing report is unchanged — additive, no migration, mirroring how `payload.source` was added,
  `types.ts:38-48`). `simple` is today's block/markdown editor verbatim. For `marimo`/`jupyter` the
  report's content **IS** a notebook: the **notebook SOURCE is stored in the report payload**
  (`payload.notebook = { format, source }`), authoritative and editable, exactly as `payload.source`
  is authoritative for simple reports today.
- **The WASM bundle is a derived artifact, not stored source.** On save, cairn runs
  `marimo export html-wasm` over `payload.notebook.source` and caches the resulting self-contained
  HTML in the existing content-addressable blob store (`storage/blobs.py`, sha256→path), keyed by a
  content hash of the source. A new `/embed/notebook?rid=…` HTML route serves it, sibling to
  `/embed/card` — the **same public-shell / read-gated-data posture** (`app.py:248-261`,
  `embed.py`). The viewer renders the notebook in an `<iframe sandbox="allow-scripts …">`.
- **Cards inside the WASM notebook reuse everything we already built.** The notebook's Python runs in
  Pyodide in-browser; `cairn.plot.media_compare(...)` builds a `CardSpec` and its `CardElement`
  (`elements.py:108`) emits an `<iframe src="…/embed/card?sid=…">` — a **nested** iframe pointing at
  the *existing* `/embed/card` route and the *existing* React `CardRenderer`. **Zero new render
  path.** The card iframe is served same-origin by cairn, so the read-gated `/api/embed/*` +
  `/api/sequences/*` reads carry the viewer's cookie exactly as they do today.
- **The make-or-break feasibility fact: the cairn SDK is built entirely on synchronous `httpx.Client`
  (`transport.py:15,70`; `elements.py:157,170`), and httpx does NOT work under Pyodide** (httpcore
  needs real sockets; Emscripten has none). **A thin Pyodide-aware transport shim is required** — a
  `pyodide.http`-backed backend selected when `sys.platform == "emscripten"`. This is a small,
  well-scoped addition to `cairn/sdk/transport.py`; it is the one true prerequisite for cards-in-WASM
  and is analyzed honestly in §5.
- **Security posture: WASM is the safe default precisely because execution is client-side and
  browser-sandboxed** — there is **no server exec surface** (contrast the server-spawn path, which is
  an authenticated RCE-shaped surface needing a heavy review). The notebook source is stored untrusted
  content rendered to other viewers; the only genuinely new review items are (a) the server-side
  `marimo export` step and (b) the notebook iframe's sandbox flags. §7.

---

## 2. Grounding — files studied (cited)

**Reports subsystem (where a mode plugs in):**
- `cairn/ui/src/lib/reports/types.ts` — `ReportPayload` (`:32-49`): `blocks[]` + optional
  `cardSettings` + optional `source` (the AR1 canonical-markdown field, **added additively with no
  migration**, `:38-48`). This is the exact precedent for adding `mode`/`notebook`.
- `cairn/ui/src/pages/ReportEditorPage.tsx` — hydrate effect (`:121-145`) branches on
  `typeof payload.source === "string"`; `doSave` (`:147-173`) builds `payloadWithSource`. The
  natural place to branch on `payload.mode`.
- `cairn/ui/src/pages/ReportsListPage.tsx` — create flow: `handleCreate` (`:58`) POSTs
  `{ name, payload: { blocks: [] } }` via `useCreateReport` (`api/hooks.ts:343-350`). The mode
  selector plugs in here (create-time) and in the editor (switch).
- `cairn/server/routes/reports.py` — CRUD; opaque JSON `payload` (`ReportCreate.payload: dict`,
  `:29-31`); `_block_count` already tolerates a source-only payload (`:98-105`). The server **never
  parses the payload** today — a `notebook` field rides through untouched, *unless* we add the
  server-side export step (§4.3), which is the one place the server begins to read it.
- `cairn/server/storage/migrations.py` — `reports` table is `(id, project_id, name, created_at,
  updated_at, payload TEXT)` (`:136-145`); `payload` is opaque JSON, so `mode`/`notebook` need **no
  schema migration**. The content-addressable blob store used for the WASM artifact:
  `storage/blobs.py` (sha256→path), served by `routes/artifacts.py` (`GET /api/artifacts/{digest}`,
  HTTP Range).

**Embed foundation (the render substrate to reuse):**
- `cairn/server/routes/embed.py` — `POST /api/embed/specs` → `{sid}` (content-hash idempotent, TTL'd)
  + `GET /api/embed/specs/{sid}`; both behind router-level `require_role("read")`; the module's
  `TODO(remote-embed)` documents the deferred cross-origin capability-token work (`:17-19`).
- `cairn/server/app.py` — `_mount_spa_or_placeholder` (`:230`): `/assets` StaticFiles, the
  `GET /embed/card` HTML route registered **before** the SPA catch-all (`:257-261`), and the catch-all
  that serves `index.html` for any non-`/api` path while 404-ing `/api/*` (`:270-281`). A new
  `GET /embed/notebook` slots in exactly beside `/embed/card`.
- `cairn/ui/src/embed-main.tsx` — the standalone one-card SPA entry (a 2nd vite input,
  `vite.config.ts` `rollupOptions.input.embed`); fetches `/api/embed/specs/:sid`, synthesizes a seed
  `SequenceMeta`, renders `<CardRenderer>` under `QueryClientProvider` + `MemoryRouter`; emits
  `cairn:resize` for host auto-height (`:87-106`).

**Python display protocol + SDK (what runs under Pyodide):**
- `cairn/sdk/elements.py` — `Element`/`CardElement`/`HtmlElement`; `CardElement.iframe_html`
  (`:184-202`) POSTs the spec to `/api/embed/specs` **via httpx** (`:157,170`) then returns the
  `/embed/card` iframe; `HtmlElement` is the self-contained (no-server) fallback. **The httpx calls
  here are exactly what breaks under Pyodide.**
- `cairn/sdk/transport.py` — `Transport` wraps a single `httpx.Client` (`:70`); every method
  (`get`/`post_json`/`head`/…) is synchronous httpx. `cairn/sdk/reader.py` — `Run.__getitem__` →
  `DataRef` lazy handle (`:493-502`, `:186-243`); `RunQuery` (`:582`) filter/last/first.
- `cairn/config.py` — `resolve_server` (`:131`), `resolve_target` (`:175`) — the server-URL/token
  discovery `CardElement._resolve_server` already mirrors.
- `cairn/sdk/card_spec.py` — the pydantic card-spec mirror (`CARD_TYPES`, `CardSpec`, `CardsSpec`,
  `ReportSpec`) kept honest against `docs/schemas/cairn-card-spec.schema.json` by a conformance test.
- `cairn/sdk/report.py` — the **inline-only** `cairn.Report` (notebook IS the report; no `publish()`).
  Note the module already anticipates "native Jupyter/marimo HTML export" as the sharing story
  (`:8-10`) — this spec is the viewer-side complement.

**Pyodide / iframe exec precedent + security:**
- `cairn/ui/src/components/PluginCard.tsx` — the in-repo Pyodide precedent: CDN-loaded Pyodide in an
  iframe; **the Python path carries NO `sandbox` attribute** (a known isolation wart the prior spec
  §7 calls out); `cairn:render`/`cairn:resize` postMessage protocol.
- `docs/superpowers/specs/2026-07-07-notebook-python-and-embed.md` §6/§7 — the client-side-Pyodide
  security model (sandbox flags, postMessage-only, "no server exec surface"), and §4.5 the
  same-origin vs cross-origin embed-auth analysis this spec inherits wholesale.

---

## 3. The report-mode model

### 3.1 The field

`ReportPayload` gains two additive fields (TS `types.ts`, mirrored in the pydantic `ReportSpec`):

```ts
export interface ReportPayload {
  blocks: ReportBlock[];           // simple mode (unchanged)
  cardSettings?: Record<string, unknown>;
  source?: string;                 // simple mode canonical markdown (unchanged)
  runSelector?: RunSelector;

  // NEW (additive, no migration — absent ⇒ "simple"):
  mode?: "simple" | "marimo" | "jupyter";
  notebook?: {
    format: "marimo" | "ipynb";    // marimo = a .py app file; ipynb = notebook JSON
    source: string;                // the authoritative notebook source
    /** sha256 of `source` at last successful WASM export (cache key + staleness check). */
    exportHash?: string;
  };
}
```

- **`mode` absent ⇒ `"simple"`**, so every persisted report loads unchanged. This is the exact
  additive-field discipline `source` already uses (`types.ts:38-48`, `ReportEditorPage.tsx:130`).
- **The notebook SOURCE lives in `payload.notebook.source`** — authoritative and editable, the direct
  analogue of `payload.source` for simple reports. **Rationale over the alternatives:** (a) storing it
  as a separate *artifact* would fork the report's edit/version/autosave story away from the existing
  `PUT /api/projects/{id}/reports/{rid}` path for no gain — the payload is already opaque JSON the
  server persists verbatim; (b) a marimo `.py` app or a modest `.ipynb` is small text, well within a
  JSON payload; large embedded outputs are the concern, addressed by storing the **derived WASM
  export in the blob store** (§4.3), not the source. So: **source in payload, heavy derived bundle in
  blobs.**
- **No DB migration** — `reports.payload` is opaque `TEXT` (`migrations.py:142`).

### 3.2 How the three surfaces branch on mode

- **Report list (`ReportsListPage`)** — unchanged except a small mode badge on each row
  (`_block_count` already tolerates any payload shape; for notebook modes show e.g. "marimo
  notebook" instead of a block count — the list route `reports.py:_block_count` returns `0` for a
  notebook payload today, so add a `mode`-aware label server-side or client-side).
- **Editor (`ReportEditorPage`)** — the hydrate effect (`:121-145`) branches on `payload.mode`:
  `simple` → today's `SegmentedMarkdownEditor` path verbatim; `marimo`/`jupyter` →
  a new `<NotebookReportEditor>` (the code editor for the notebook source + a "Run/Preview" that
  mounts the WASM iframe). `doSave` (`:147-173`) writes `payload.notebook.source` instead of
  `blocks`/`source`. Autosave/debounce/rename all reuse the existing machinery unchanged.
- **Viewer (view mode)** — `marimo`/`jupyter` render the WASM iframe (§4). The "View source" escape
  hatch (`:397-401`) shows the notebook source read-only.

### 3.3 Mode-selector UX

- **Create-time** (`ReportsListPage.handleCreate`, `:58`): the "+ New report" affordance becomes a
  small menu — "Simple report" (today's default) / "marimo notebook" / "jupyter notebook (JupyterLite)".
  The chosen mode seeds `payload` (`{ mode, notebook: { format, source: <starter> } }` for notebook
  modes; `{ blocks: [] }` for simple). A starter notebook is a 3-line marimo app that
  `import cairn` and shows one example card, so a new notebook renders something immediately.
- **Switch after create**: a mode toggle in the editor header. `simple → marimo` is a **one-way,
  confirmed** conversion (wrap the report's `source` markdown into a marimo markdown cell + a code
  cell scaffold); `marimo ↔ jupyter` is a best-effort convert (marimo ships a `convert` for ipynb).
  Switching **away** from a notebook mode is destructive to notebook state, so it is confirm-gated and
  keeps the old payload under `payload.archived` for one save cycle. Recommendation: ship **create-time
  selection only in v1**; defer in-place switching to a follow-up (it is convenience, not core).

---

## 4. WASM embedding (the headline)

### 4.1 What runs, and where — no server kernel

The notebook executes **entirely client-side** in Pyodide inside a sandboxed `<iframe>`. cairn's
server **spawns no kernel and runs no notebook code**. The server's only new responsibility is
producing a **static WASM notebook bundle** and serving it as a public shell (data stays behind
`/api/*`), exactly the `/embed/card` posture.

### 4.2 The artifact: `marimo export html-wasm`

marimo ships a first-class WASM export: `marimo export html-wasm <app.py> -o out.html` produces a
**single self-contained HTML file** that boots marimo's Pyodide runtime and runs the notebook in the
browser (`--mode run` for an app-style read view; `--mode edit` for an editable notebook). This is
the recommended artifact:

- **One file, no server runtime** — it inlines (or references by relative asset) marimo's JS + the
  Pyodide bootstrap; the browser fetches Pyodide + wheels from the marimo/pyodide CDN (or a
  self-hosted mirror, §7).
- **Deterministic from source** — same `notebook.source` ⇒ same export ⇒ content-hashable and
  cacheable.

For the `jupyter` mode, the analogue is **JupyterLite**: a static site bundle running the notebook in
a Pyodide kernel. JupyterLite is heavier (it's a whole app deployment, not a single file) and is
therefore sequenced **after** marimo — the marimo html-wasm single-file export is the cleaner first
target. (JupyterLite's `jupyter lite build` produces a static directory; cairn would serve it from a
per-report or shared static mount and open the specific notebook via `?path=`.)

### 4.3 Who runs the export, and when — server-side on save (recommended v1, with an eye to O3)

Two options; recommend **server-side export on save**:

- **Server-side (recommended):** on `PUT /api/projects/{id}/reports/{rid}` for a notebook-mode report,
  the server (which already has marimo as a Python dep) runs `marimo export html-wasm` over
  `payload.notebook.source`, stores the resulting HTML in the **blob store** (`storage/blobs.py`),
  and records the digest. `exportHash = sha256(source)` gates it — if the source is unchanged, reuse
  the cached blob (content-hash idempotent, exactly like `embed_specs.put`). Served at
  `GET /embed/notebook?rid=…` (resolves report → digest → blob bytes) or directly at
  `GET /api/artifacts/{digest}` behind read-gate. **Why server-side:** it keeps the viewer thin (no
  marimo toolchain in the browser to *produce* the bundle), makes the export cacheable/shareable, and
  a view-mode reader never needs the export toolchain. **The cost / open question (O3):** running
  `marimo export` is running a CLI subprocess over user-authored source on the server. It is **not**
  executing the notebook (export compiles/bundles; the *notebook runs in the browser*), but it is a
  new server-side process invocation and must be reviewed (resource/time limits, temp-file handling,
  marimo-CLI trust). This is the single most important thing to confirm with the user.
- **Client-side (fallback):** ship the marimo runtime assets in `dist/` and have the editor iframe
  boot the notebook source directly (marimo's playground/embed can take source at runtime). Avoids the
  server subprocess entirely (purest "no server surface") but ships a much larger `dist/` and puts the
  export/boot burden on every viewer's browser. Recommendation: **prefer server-side; keep
  client-side as the escape hatch if O3's review rejects the subprocess.**

### 4.4 Embedding + lifecycle

- **View mode:** viewer renders `<iframe src="/embed/notebook?rid=…" sandbox="allow-scripts">` (see
  §7 for exact flags). The iframe is the marimo `--mode run` export — a rendered, re-runnable app.
- **Edit mode:** the `<NotebookReportEditor>` shows a code editor over `notebook.source` and a
  "Run/Preview" that mounts the `--mode edit` export in the iframe. Saving persists `source` and
  triggers a re-export.
- **Auto-height:** reuse the existing `cairn:resize` protocol (`embed-main.tsx:87-106`,
  `use-iframe-auto-height.ts`). marimo's export won't emit `cairn:resize` itself, so either (a) give
  the notebook iframe a generous fixed/user-resizable height (simplest, recommended v1) or (b) inject
  a tiny ResizeObserver shim into the export. v1: **user-resizable fixed height.**
- **Same-origin serving is load-bearing:** because cairn serves `/embed/notebook` on its own origin,
  the notebook's Pyodide code (and the nested `/embed/card` iframes it spawns) talk to `/api` as
  **same-origin** — cookies flow, no CORS, no capability token needed for the local/common case
  (`app.py` CORS is `allow_origins=[]` when auth on, same-origin only). This is the same reason the
  existing `/embed/card` "LOCAL / SAME-ORIGIN only" posture works.

---

## 5. Cards inside the WASM notebook — the crux (honest feasibility)

**The goal:** inside the WASM notebook, `cairn.plot.media_compare(run_a["pred"], run_b["pred"])`
returns a `CardElement` whose `_repr_html_` renders the *real* cairn card — i.e. the cairn SDK
(reader over HTTP + `elements.py`) must work **under Pyodide**, talking to the **same cairn server**
via `/api` + the `/embed/card` path we already built.

### 5.1 Does `cairn` (httpx) work under Pyodide? — **No, not as-is.**

The SDK's entire HTTP layer is `httpx.Client` (`transport.py:15,70`; the display path in
`elements.py:157,170` calls `httpx.get`/`httpx.post` directly). **httpx does not function under
Pyodide:** its sync transport is httpcore, which opens real TCP sockets via the OS — Emscripten has
no sockets. There is no drop-in fix: `pyodide-http` (the common shim) patches `urllib` and `requests`
to route through the browser's `fetch`/`XMLHttpRequest`, **but it does not patch httpx**. So the
honest verdict is: **cards-in-WASM requires a Pyodide-aware transport shim in the cairn SDK.** This is
the make-or-break item, and it is tractable.

### 5.2 The shim (concrete)

Add a Pyodide backend to `cairn/sdk/transport.py`, selected at runtime:

```python
import sys
_IS_PYODIDE = sys.platform == "emscripten"   # true under Pyodide/marimo-wasm/JupyterLite
```

When `_IS_PYODIDE`, `Transport` swaps its `httpx.Client` for a thin backend built on
`pyodide.http`:

- **GET (data reads):** `pyodide.http.open_url(url)` is a **synchronous** XHR that works on the main
  thread and in workers and returns text — sufficient for the JSON `/api/sequences/*`, `/api/embed/*`
  reads the reader needs. For binary (artifact bytes) it's weaker; see below.
- **POST (`/api/embed/specs`):** `open_url` is GET-only. POST needs `pyodide.http.pyfetch`, which is
  **async**. Two ways to keep the SDK's synchronous surface intact:
  1. **Synchronous requests in a worker via cross-origin isolation.** marimo-wasm and JupyterLite run
     Pyodide in a Web Worker. With COOP/COEP headers (cross-origin isolation) +
     `SharedArrayBuffer`, `pyodide-http`-style synchronous fetch works from the worker. This keeps
     the reader fully synchronous (no API change) but **requires cairn to serve `/embed/notebook`
     with `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`
     headers** — a concrete, small server change on the notebook route.
  2. **Async path.** marimo cells (and JupyterLite) support top-level `await`, so a
     `cairn.plot.*_async(...)` / `await el.render()` variant using `pyfetch` avoids the
     cross-origin-isolation requirement, at the cost of an async API surface in-notebook.
  Recommendation: **(1) synchronous-in-worker with COOP/COEP** so the *identical* `cairn` API works
  in a notebook and in a normal Python process — the notebook code a user writes is byte-identical to
  what they'd run locally. Fall back to (2) if COOP/COEP proves problematic with the marimo CDN
  assets (cross-origin-isolated pages require all subresources to be CORP/CORS-cleared — the marimo
  CDN wheels must send the right headers, an integration risk noted in O2).

The shim is ~a backend class + a selector; it changes **no** call site (`reader.py`, `elements.py`
keep calling `transport.get`/`post_json`). This is the correct seam.

### 5.3 Auth + CORS from the WASM iframe

- **Same-origin (the common/local case):** cairn serves `/embed/notebook`, so the notebook's `/api`
  calls and its nested `/embed/card` iframes are **same-origin** — the `cairn_session` cookie flows,
  `require_role("read")` passes, no token in code, no CORS. This is why serving the bundle from cairn
  (not a marimo CDN playground) matters.
- **Cross-origin / remote notebooks:** inherits the **exact deferred problem** the `embed.py`
  `TODO(remote-embed)` and the prior spec §4.5 describe — a `SameSite=Lax` cookie won't ride a
  third-party iframe, so a remote host needs the **per-sid short-lived capability token +
  `--embed-origins` CORS allowlist**. That work is already scoped as a deferred, security-reviewed
  follow-up; notebook modes ride on it unchanged. **v1 is same-origin only**, matching `/embed/card`.
- **The nested-iframe path is the elegant part:** the notebook doesn't need to *render* cards itself —
  `CardElement.iframe_html()` already emits an `<iframe src="…/embed/card?sid=…">`, so a card inside
  the WASM notebook is just a nested same-origin iframe hitting the *existing* route and the
  *existing* `CardRenderer`. The only thing the notebook's Pyodide code does over the network is the
  `POST /api/embed/specs` (needs the §5.2 shim) + the reader's data GETs.

### 5.4 The honest residual risks

- **Binary reads under Pyodide.** `open_url` returns text; artifact *bytes* (images/meshes for a raw
  `media_compare`) want `pyfetch(...).bytes()` (async) or a base64 text hop. For the **server-backed**
  card path this is moot (the card iframe fetches its own bytes same-origin via `CardRenderer`); it
  only bites the **self-contained inline-data** path (WS-INLINE), which is already deferred
  (`elements.py:26-31` raises `NotImplementedError`). So v1 (reference-mode cards) is unaffected.
- **Package availability in Pyodide.** `numpy`/`pandas`/`plotly`/`pydantic` load fine; `torch` does
  not. The cairn SDK itself must be pure-Python-import-clean under Pyodide (it is, modulo the httpx
  swap) and installable via `micropip` from the notebook (or vendored into the export).
- **COOP/COEP fragility (O2).** Cross-origin isolation is all-or-nothing for the page; every
  subresource (marimo/pyodide CDN wheels) must be CORP-cleared. Self-hosting the runtime assets under
  the cairn origin removes this fragility (and the CDN supply-chain dependency) — recommended for the
  hardened path, at a `dist/` size cost.

**Verdict:** cards-in-WASM is **feasible** and reuses the entire existing card render path, **but it
is gated on the Pyodide transport shim (§5.2) and same-origin serving with COOP/COEP.** It is not
free, but it is a small, well-contained SDK addition — not a redesign.

---

## 6. Security

**Why WASM is the safe default:** notebook code runs **client-side in a browser-sandboxed Pyodide
VM**. There is **no server-side execution of notebook code**, therefore **no new server exec surface,
no auth trust-boundary widening for code execution, and no RCE-shaped review** — the opposite of the
server-spawn path (§7-deferred), which would put an authenticated code-execution surface behind the
same boundary as `plugin_ws.py` (spec-auth §5's "the exec/RCE-shaped surface"). A malicious notebook
can, at worst, abuse *its own* browser tab; it cannot escape the WASM VM to the server.

**Iframe sandbox flags (the notebook iframe):**
- `sandbox="allow-scripts"` — Pyodide needs JS. **Do NOT add `allow-same-origin`** for a notebook
  authored by another user, or the frame regains DOM/cookie/`localStorage` access to the cairn origin.
  This is precisely the wart the prior spec §7 flags in `PluginCard` (its Python iframe has *no*
  sandbox at all) — notebook modes **fix it** by serving from a controlled path with an explicit
  restrictive sandbox.
- **Tension with §5.2:** same-origin `/api` cookie auth wants the frame to *be* same-origin, but a
  sandboxed cross-content frame with `allow-same-origin` re-opens the isolation hole. Resolution: the
  **nested `/embed/card` iframe** (which needs same-origin cookie auth) is a *separate*, trusted cairn
  shell we control — it can carry `allow-scripts allow-same-origin` because *we* wrote it
  (`elements.py:200` already does). The **outer notebook iframe** (untrusted user code) stays
  `allow-scripts` only; its `POST /api/embed/specs` rides the §5.2 shim, and the sensitive same-origin
  reads happen in the inner trusted card frame, not the untrusted notebook frame. This split is the
  key security design point and must be validated in review.
- COOP/COEP headers (§5.2 option 1) are set on the notebook route for cross-origin isolation.

**What still needs review (the genuinely new items):**
1. **The server-side `marimo export` step (O3)** — a subprocess over untrusted source. Review:
   resource/time limits, temp-file isolation, no shell injection via source, marimo-CLI trust. This
   is the one place the server touches the untrusted notebook. (If rejected, fall back to client-side
   export, §4.3.)
2. **Notebook source as stored untrusted content rendered to *other* viewers.** A report author's
   notebook runs in a *viewer's* browser. The sandbox contains it (no same-origin, no cookie), and
   the `cairn:query`-style mediation is not even needed here because the card path goes through the
   trusted inner frame. But: **auto-run on open** must be **opt-in** (a viewer clicks "Run"), never
   silent — same policy as the prior spec §6.4. A shared notebook never silently executes an author's
   Python in a viewer's browser on load.
3. **The sandbox-flag split (outer untrusted vs inner trusted frame)** — the core invariant above.
4. Inherited (not new): the `/embed/*` read-gate, and the deferred cross-origin capability token.

No new exec surface; the review is bounded to the export step + the iframe flags — a far lighter lift
than the server-spawn path.

---

## 7. Deferred: the server-spawn path (B1)

A server that spawns real kernels — `jupyter_server` / a marimo *server* (not export) behind an
`/api` proxy — is the **heavier alternative, explicitly out of scope for v1:**

- **It is an RCE-shaped exec surface behind auth.** Executing arbitrary notebook Python on the cairn
  host is exactly the `plugin_ws.py` posture (spec-auth §5, "auth is the boundary; no sandbox"). It
  needs a full security review, not a bounded one.
- **Process lifecycle + ops.** Per-report/per-user kernel processes: spawn, idle-timeout, resource
  caps, cleanup, port management, crash recovery — real operational weight cairn does not carry today.
- **Multi-tenant blast radius.** One user's runaway/malicious kernel affects the shared host.

**When you'd reach for it:** when the WASM path hits hard limits — packages that don't exist in
Pyodide (e.g. `torch`, CUDA, large native wheels), datasets too big for browser memory, or
compute too slow in WASM. At that point B1 becomes a *separately specced*, security-reviewed,
opt-in-per-deployment feature (likely gated behind an admin flag and network isolation), not the
default. **v1 deliberately ships WASM only.**

---

## 8. Relationship to WS-PYCELL

- **WS-PYCELL** (prior spec §6) = **Pyodide *cells* inside the SIMPLE report** — a `` ```python ``
  fence in the block/markdown editor that runs client-side and emits declarative `cairn:cards` specs.
- **Marimo/jupyter MODES** (this spec) = the **whole report IS a notebook** running in a WASM iframe.
- **Shared substrate, different granularity.** Both are client-side Pyodide, both ultimately render
  cards through the *same* `/embed/card` + `CardRenderer` path, and both need the **same §5.2 Pyodide
  transport shim** (the shim is the shared dependency). They differ in host: WS-PYCELL hosts Pyodide
  itself (factoring `pyodide-sandbox.ts` out of `PluginCard`) and defines the `cairn:cards`/
  `cairn:query` postMessage protocol; notebook modes delegate the Pyodide hosting to marimo's/
  JupyterLite's own runtime and use nested `/embed/card` iframes instead of a postMessage card
  channel.
- **Sequencing:** they are **independent** and need not share a runtime. The **Pyodide transport shim
  (§5.2) should ship once** and be consumed by both. WS-PYCELL is the finer-grained, more
  security-surface-heavy path (it hosts and sandboxes Pyodide directly); notebook modes lean on
  marimo/JupyterLite to host Pyodide, so they carry *less* sandbox-authoring risk but *more*
  export/toolchain integration. Recommendation: **ship the transport shim first (it unblocks both),
  then notebook-marimo mode, with WS-PYCELL on its own track.**

---

## 9. Phasing + gates (dependency-ordered)

```
  WS-PYTRANSPORT ──▶ Pyodide-aware Transport backend (sys.platform=="emscripten"
   (Phase 0)         → pyodide.http). Unblocks cards-in-WASM AND WS-PYCELL.
        │
        ├──▶ WS-RMODE ──▶ payload.mode + notebook field; editor/list/viewer branch;
        │    (Phase 1)    create-time mode selector; starter notebook. (No WASM yet —
        │                 renders source read-only + "export pending".)
        │
        └──▶ WS-MARIMO-WASM ──▶ server-side `marimo export html-wasm` on save → blob;
             (Phase 2)          /embed/notebook route (COOP/COEP + sandbox flags);
                                viewer/editor iframe; nested /embed/card cards work.
                                     │
                                     └──▶ WS-JUPYTERLITE (Phase 3, deferred) — jupyter mode
                                          via JupyterLite static bundle.
```

- **Phase 0 — WS-PYTRANSPORT.** Add the Pyodide backend to `transport.py` + the `elements.py` POST
  path; verify `cairn.plot.media_compare(...)._repr_html_()` produces a working `/embed/card` iframe
  from *inside* a marimo-wasm notebook. **Gate:** a browser smoke test — a card renders live inside a
  marimo-wasm notebook served same-origin by cairn; **security review** of the shim (no token leak,
  same-origin read-gate intact). This is the make-or-break; do it **first** and prove feasibility
  before building the mode UI.
- **Phase 1 — WS-RMODE.** `payload.mode` + `payload.notebook` (TS `types.ts` + pydantic `ReportSpec`);
  `ReportEditorPage`/`ReportsListPage` branch; `<NotebookReportEditor>` (code editor over source);
  create-time selector + starter notebook; mode-aware list label. **Gate:** additive-field round-trip
  (a simple report loads unchanged; a notebook report round-trips source); no migration.
- **Phase 2 — WS-MARIMO-WASM.** Server-side `marimo export html-wasm` on save → blob (content-hash
  cached); `GET /embed/notebook?rid=…` (registered before the SPA catch-all, `app.py:257`) with
  COOP/COEP + `sandbox="allow-scripts"`; viewer/editor iframe; auto-run **opt-in**. **Mandatory
  security review** (the export subprocess O3; the outer/inner sandbox-flag split §6; COOP/COEP
  subresource story) → fix round → browser-verify (auth on and off; a private card renders inside the
  notebook). **Depends on Phase 0 + Phase 1.**
- **Phase 3 — WS-JUPYTERLITE (deferred).** `jupyter` mode via JupyterLite. Heavier (static-site
  bundle, per-report or shared mount). Behind marimo.
- **(Separate track) WS-PYCELL** — pyodide cells in simple reports (prior spec §6); consumes
  WS-PYTRANSPORT; its own security review.

---

## 10. Risks + open questions (for the user)

**Top 3 open questions:**
- **O1 — Pyodide transport shim (the feasibility gate).** Confirm the approach: swap httpx for a
  `pyodide.http` backend under `sys.platform=="emscripten"`, **synchronous-in-worker via COOP/COEP**
  so the in-notebook `cairn` API stays byte-identical to local use (fallback: an async
  `pyfetch`-based API). This is the make-or-break; Phase 0 proves it before anything else is built.
  *(Recommendation: sync-in-worker + COOP/COEP, self-host runtime assets to keep isolation clean.)*
- **O2 — Same-origin + COOP/COEP serving.** Approve cairn serving the marimo-wasm bundle **from its
  own origin** with `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers (needed for
  sync-in-worker requests). This constrains subresources (marimo/pyodide CDN wheels must be
  CORP-cleared) and pushes toward **self-hosting the runtime assets** (bigger `dist/`, no CDN
  supply-chain). Accept the `dist/` weight, or accept the CDN/CORP fragility?
- **O3 — Server-side `marimo export` on save.** Approve running `marimo export html-wasm` as a
  server-side subprocess over user-authored source (compiles/bundles — does *not* execute the
  notebook; the notebook runs in the browser), cached by content hash? Or require the **client-side**
  export path (purest "no server surface", but a much larger `dist/` and per-viewer boot cost)? This
  is the only place the server touches untrusted notebook content and needs an explicit yes.

**Further risks:**
- **R1 — marimo vs jupyter first.** marimo's single-file html-wasm export is markedly simpler to embed
  than a JupyterLite deployment; v1 = marimo, jupyter deferred. Confirm that ordering matches user
  need (the memory note says the user leaned "spawn a server"; this spec recommends WASM-first —
  surface that tension explicitly).
- **R2 — Auto-run policy.** Notebook runs in the *viewer's* browser; must be opt-in (click "Run"),
  never silent on open. Confirm the UX (frozen preview + Run button).
- **R3 — Package/perf ceiling.** `torch`/native/large-data notebooks won't run in WASM → that's the
  B1 server-spawn trigger (§7), deferred. Document the supported package set.
- **R4 — In-place mode switching.** Recommend create-time-only in v1; defer `simple↔notebook`
  conversion (lossy, confirm-gated). Confirm that's acceptable.
- **R5 — Export staleness.** `exportHash` gates re-export; if a referenced run's *data* changes, the
  notebook re-fetches live on run (cards are live), but a cached export's *frozen outputs* could be
  stale — surface "re-run to refresh".
- **R6 — Blob GC for stale exports.** Content-hash caching bounds growth, but superseded exports
  accumulate; confirm a TTL/GC story (mirrors the `embed_specs` R6 in the prior spec).

---

## 11. Workstream + gate summary

| WS | Ships | Depends on | Gate(s) |
|----|-------|-----------|---------|
| **WS-PYTRANSPORT** (P0) | Pyodide `Transport` backend (`sys.platform=="emscripten"` → `pyodide.http`); `elements.py` POST works under Pyodide | — | **Security review** (no token leak, read-gate intact) + browser smoke: a card renders live inside a marimo-wasm notebook served same-origin |
| **WS-RMODE** (P1) | `payload.mode` + `payload.notebook` (TS + pydantic); editor/list/viewer branch; `<NotebookReportEditor>`; create-time selector + starter | — | Additive round-trip; simple reports unchanged; no migration |
| **WS-MARIMO-WASM** (P2) | server-side `marimo export html-wasm` → blob (hash-cached); `/embed/notebook` (COOP/COEP + sandbox); viewer/editor iframe; nested `/embed/card` cards; opt-in run | WS-PYTRANSPORT, WS-RMODE | **Mandatory security review** (export subprocess; outer/inner sandbox split; COOP/COEP) → fix → browser-verify (auth on/off; private card in notebook) |
| **WS-JUPYTERLITE** (P3, deferred) | `jupyter` mode via JupyterLite static bundle | WS-MARIMO-WASM | Review as scoped |
| **WS-PYCELL** (separate track) | pyodide cells in simple reports (prior spec §6) | WS-PYTRANSPORT | Mandatory security review (§7 of prior spec) |
| **B1 server-spawn** (deferred, §7) | kernel proxy | — | Full RCE-shaped security review; ops sign-off; admin-gated |

Reuse discipline (no duplication): **one** card render path (`/embed/card` + `CardRenderer`, reached
by a *nested* iframe — no new renderer); **one** card spec schema (WS-SCHEMA, `card_spec.py`); **one**
Pyodide transport shim (WS-PYTRANSPORT, shared with WS-PYCELL); **one** embed-serving posture (public
shell + read-gated `/api/*`, `app.py`); the notebook source rides the **existing** report payload +
`PUT` route; the WASM bundle rides the **existing** content-addressable blob store.
