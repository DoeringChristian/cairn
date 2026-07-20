# Design: Query URLs for cairn-track (feasibility + grammar + redirect pattern)

Date: 2026-07-20. Status: DESIGN ONLY (no implementation). Track: cairn-track / cairn-plot.

## 0. TL;DR

Today run/artifact selection lives only in Python (`Reader.runs(...).filter(...).last()`,
`run[tag]`). This design adds a **live query URL** — a stable server URL that always
resolves to "the `<tag>` artifact of the latest (optionally filtered) run" — so
cairn-plot's just-landed URL seam (`cp.Image(url=…)`, `cp.Compare`, client-side
fetch+sniff+decode) can render **reports that show the freshest data every time they
open**.

Recommendations: (1) a **query-param** grammar `GET /api/query?run=latest&name=…&tag=…`;
(2) the query endpoint **302-redirects to the existing content-addressed
`/api/artifacts/{digest}`** — this makes cairn-plot's caches correct essentially for
free; (3) **session-cookie auth** (reports served same-origin by the cairn server);
(4) freshness = re-resolve on every fetch via `Cache-Control: no-store` on the query
endpoint, `immutable` on the digest endpoint; (5) **the local-only tracking branch does
NOT need to be removed** — query URLs simply require a server *when used*; baked/offline
reports keep working. The user's openness to dropping local-only is not needed for this
feature.

## 1. Feasibility — what already exists

* **Server**: FastAPI (`cairn/server/app.py`), routers under `cairn/server/routes/`.
* **Content-addressed artifacts**: `GET /api/artifacts/{digest}`
  (`routes/artifacts.py:51`) streams bytes by SHA256 digest with `mime_type` from the DB
  and HTTP Range support. Digest ≡ content (immutable) — the ideal redirect target.
* **Selectors are Python-only today**: `RunQuery` (`sdk/reader.py:582`) offers Django-style
  `.filter(name__startswith=…, status=…, lr__gt=…, metrics__loss__lt=…)`, `.sort()`,
  `.limit()`, `.first()/.last()`. "latest" = `.last()` (created_at DESC). `run[tag]` →
  `DataRef` (`reader.py:185`) → `_find_artifact` (`reader.py:367`) which, with no step,
  returns the **highest-step** entry ("latest checkpoint"). None of this is reachable
  over HTTP — the server has `/api/runs`, `/api/runs/{id}/artifacts`, etc., but no
  selector endpoint.
* **A selector schema already exists** — `QueryRunSelector` in `sdk/card_spec.py:164`
  (`mode: "latest-n" | "newest-per-name"`, `namePattern`, `tags`, `n`) — but is resolved
  **only client-side** in `ui/src/lib/run-selector.ts:104`
  (`resolveRunSelectorFromRuns`, glob→regex name match, all-of tags). There is **no
  Python/server implementation**. The query-URL compiler should reuse this exact schema and
  give it a first server-side home.
* **Internal prior art**: `POST /api/projects/{pid}/resolve-artifact-ref`
  (`routes/artifact_registry.py:226`) already resolves a mutable ref
  (`name:latest`, `name:v3`, an alias) to a concrete version/digest — "latest" is just an
  auto-set alias. A query endpoint is the same mutable-alias → immutable-digest
  indirection, generalized to run selectors.
* **Auth** (`server/auth.py`): Bearer token (SDK/CLI) or HttpOnly session cookie
  (browser, 30-day sliding), roles `read<write<admin`, one-time login OTP
  (`/api/auth/otp`, single-use, 15 min). `--no-auth` sets `auth_enabled=False` →
  `require_role` becomes a no-op (`auth.py:403`).
* **CORS** (`app.py:150`): auth-off → `allow_origins=["*"]`; auth-on →
  `allow_origins=[]` (same-origin only), `allow_credentials=False` in both cases;
  `expose_headers` already includes `Content-Range`/`Accept-Ranges`. Consequence: **cookie
  auth works only same-origin** — reports must be served from the cairn origin (they are:
  SPA, `/plot`, `/embed/card` all served by the same app).

## 2. cairn-plot's URL-consumption contract (and the caching hazard)

Two provenance modes with very different cache behavior (`vendor/cairn-plot`):

* **`cp.Image(url=…)` → `kind:"image"` DataSpec** (`src/cairn_plot/components.py:817`).
  Client **fetches + sniffs (mime→ext→magic) + decodes** at
  `ui/src/plot-descriptor.ts:202`, producing a `data:` URL that embeds the fetched bytes.
  Downstream caches key on that data URL, so they are **already content-addressed for that
  one fetch**; the fetch itself is uncached and runs once per resolve.
* **raw URL string `cp.Image(data="http://…")` → `kind:"url"` passthrough**
  (`components.py:970`): `imageUrl = data.src` — the **raw live URL flows straight into
  every cache**.

Caches, all keyed on **URL strings** (`ui/src/lib/cairn-plot/image/cache.ts`,
`engine/diff-engine.ts`): `imageLoadCache` (raw url), `imageDataCache`
(`${imageUrl}::${colormap}`, `${baselineUrl}::${imageUrl}::${diffMode}::${colormap}`),
GPU `DiffCache` (`${contentKeyA}|${contentKeyB}|…`). **The hazard**: a live query URL's
bytes change over time, so any cache keyed on the raw query-URL string returns stale
`ImageData` (`<img src>` refetches, but the caches do not). This breaks the url≡content
assumption — for the `kind:"url"` path specifically.

All fetches use default `redirect:"follow"`; `res.url` (the final redirected URL) **is
available but never read** anywhere in the codebase.

## 3. URL grammar (recommended: query params)

Primary form:

```
GET /api/query?run=latest&project=demo&name=exp*&tag=train/render&step=latest&format=raw
    → 302 Location: /api/artifacts/<digest>
```

**Justification**: query params map 1:1 onto `RunQuery`'s existing kwargs (trivial to
compile in both directions), stay readable, extend without new path grammar, and let
Python emit them mechanically. A `/api/q/<entity>/<selector>/<object>` path form is a
possible sugar alias but is strictly less expressive for multi-filter selection.

Parameters:

* **Run selectors** — `run=latest` (default) · `run=latest:N` (Nth-newest) ·
  `run=id:<run_id>` (pin) · `run=newest-per-name` (one latest run per display_name; needs
  a GROUP-BY query). Refinement filters reuse `RunQuery` semantics: `project=`,
  `name=<glob>` (→ `name__startswith`/`icontains`), `status=`, and param/metric predicates
  `lr__gt=1e-4`, `metrics.loss__lt=0.1`.
* **Object addressing** — `tag=<name>` (sequence or named artifact) · `step=latest`
  (default, highest step) · `step=<N>` · `step=best:<metric>:<max|min>` (deferrable) ·
  `kind=image|metric|mesh|…` (optional disambiguation).
* **Format negotiation** — `format=raw` (default → 302 to the blob) ·
  `format=json` (returns `{run_id, digest, step, mime_type, size, url}` — what
  `cp.Compare` needs to fetch *two* digests, and what Python sugar uses to bake).
  `Accept:` header may mirror this but the explicit param is simpler to generate.
* **Pinning** — `at=<iso8601>` freezes the run-selection clock ("latest run created ≤ T");
  omitting `at` = live. `run=id:<run_id>` is the hardest pin. The ultimate pin is to
  resolve once at generation time and bake the raw `/api/artifacts/{digest}` URL (already
  immutable) — the report author chooses live vs. pinned vs. baked.

## 4. The redirect pattern (RECOMMENDED)

`GET /api/query?…` → **302** → `GET /api/artifacts/{digest}`. Why this is the right shape:

* **Caching becomes correct for free.** Fetches already follow redirects, so
  `cp.Image(url=queryURL)` transparently lands on the digest and its bytes. For the
  `kind:"image"` decode path this is *already* correct — each resolve re-fetches and the
  decoded `data:` URL is content-addressed. For the `kind:"url"` path, keying the caches on
  the **final** URL (`res.url` = the digest URL) makes every existing key expression
  content-addressed automatically: two different "latest" resolutions yield two different
  digests → two cache entries (no stale collision); identical content across queries → same
  digest → cache hit (free dedup); superseded digests age out via the existing FIFO/LRU.
* **No new blob-serving path.** The query endpoint is a thin resolver; all byte-serving,
  Range, and mime handling stay in `/api/artifacts/{digest}`.
* **Mirrors existing indirection** — internal `resolve-artifact-ref`, and W&B artifact
  aliases / MLflow `models:/Name/Production` URIs (mutable alias → immutable version).

**cairn-plot change required** (per the URL-contract audit): capture `res.url` at the
`plot-descriptor.ts:202` fetch and thread the final digest URL into the `imageUrl`/
`baselineUrl` props that all §2 caches derive from (`resolveDataProps` /
`resolveImageViewportItems` in `data-sources.ts`). Once the digest URL reaches the panes,
`imageDataCache`/`diffCacheKey`/`loadImageData` are content-addressed with no further
edits. **One-line class of change** — "key caches on `response.url`, not the request URL"
— but two sites, not literally one line. The one snag: the `kind:"url"` passthrough hands
its raw URL to `<img src>`/`new Image()`, which does not expose the redirected URL; that
path needs an explicit `fetch(url,{redirect:"follow"})` + read `res.url` before handing
the URL to the panes. Recommendation: route live query URLs through `kind:"image"` (the
decode path) so they benefit from the redirect immediately.

## 5. Auth

Recommend **session cookie**, because reports are served by the cairn server itself
(same-origin SPA/`/plot`/`/embed`), so the browser attaches the HttpOnly cookie to both
the query and the digest request automatically. A teammate opening a shared report link
hits the cairn origin, and if unauthenticated is bounced to `/login?otp=…` (existing OTP)
or logs in with a token → session cookie. Rejected alternatives:

* **Token-in-URL** — leaks via Referer, browser history, server logs. Reject.
* **Cross-origin cookie** — blocked today (`allow_credentials=False`, `allow_origins=[]`
  under auth). Keep reports same-origin.
* **Signed short-lived URLs** — worthwhile *later* for embedding a live view in an
  external origin (Confluence/Notion); out of scope for local/team use.

For `--no-auth` dev, everything is open — matches today's UI feature-dev flow.

## 6. Freshness semantics

* The query endpoint **re-resolves on every request** and returns
  `Cache-Control: no-store` (never cached) so `run=latest` is always current on report
  open. The digest endpoint returns `Cache-Control: public, max-age=31536000, immutable`
  (content-addressed → safe forever).
* A report **opts into pinning** either by adding `at=<iso8601>`/`run=id:…`, or by baking
  the resolved `/api/artifacts/{digest}` URL at generation time (fully static, offline,
  content-addressed).
* "Latest" therefore re-resolves exactly once per open in the browser; within a session,
  digest-keyed caches keep the resolved bytes and update naturally if a later resolve
  yields a new digest.

## 7. The "always a server" implication

Query URLs need a **running server only when the URL is fetched**. What is "local-only"
(serverless) today:

* **Write path**: `LocalTransport` (`sdk/local.py`, ~309 LOC) — direct-DB or WAL writes to
  `.cairn/` with no server.
* **Read path**: `_LocalBackend` (`reader.py:753`) — reads DuckDB + `BlobStore` directly,
  draining WALs.
* Selected via `config.resolve_target` (`config.py:175`) `local` vs `server`.

Removing local-only would delete `sdk/local.py`, `_LocalBackend`, and the dual-mode
branching — but **WAL infrastructure (`sdk/wal.py`, `server/wal_ingest.py`) stays**: it is
the SDK→server bridge for NFS/Slurm, used by the server's ingestion loop (`app.py:111`),
not part of the serverless-only surface.

**Recommendation: do NOT remove local-only.** Query URLs are a server-mode feature; offline
reports keep using baked `cp.Report` (self-contained HTML) or local mode. Removing local
tracking is an orthogonal simplification with its own cost (loses zero-server single-machine
UX) and is **not required** for query URLs. The user's willingness to drop it is
unnecessary here.

## 8. Work breakdown

| # | Task | Size |
|---|------|------|
| 1 | `GET /api/query` route: parse params, resolve, 302 to digest (+ `format=json`). Read-role router, `no-store` header. | M |
| 2 | Selector→query compiler: **port the existing `QueryRunSelector` schema** (`card_spec.py`) + `RunQuery`/`_find_artifact` step logic to a server-side resolver against the DB (`newest-per-name` GROUP BY); this is the schema's first Python home and unifies it with the client resolver. | S–M |
| 3 | cairn-plot: capture `res.url`, thread final digest URL into pane props so caches key on it; route live query URLs via `kind:"image"`. | S |
| 4 | Python sugar: `cairn.query_url(selector, tag, …)` / `reader.runs(...).latest()[tag].url`; accept in `cp.Image(url=…)`. | S |
| 5 | `Cache-Control` headers on query + digest endpoints. | XS |
| 6 | Docs + one live-report example. | S |

## 9. Open decisions for the user

1. **Primary grammar** — confirm query-params over `/api/q/<…>` path segments.
2. **`step=best`** — ship now (needs `metric:goal`) or defer.
3. **Shared-link auth** — session-cookie only for v1, or also add signed short-lived URLs?
4. **Python emission** — should `cairn.query_url(...)` emit the *live* query URL, or resolve
   once and emit the baked digest URL? (Recommend a `live=True/False` toggle.)
5. **cairn-plot cache keying** — key on `res.url` globally (also fixes registry
   `name:latest` refs), or only for query URLs?
6. **cp.Report default** — live vs. baked by default (recommend baked default, explicit
   `live=True` for freshness-on-open).
7. **Selector unification** — once `QueryRunSelector` resolves server-side, should the
   existing client-side `resolveRunSelectorFromRuns` be retired in favor of the query
   endpoint (one resolver), or kept for the in-app card path?
