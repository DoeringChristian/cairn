# WS-EMBED — implementation report

**Scope:** LOCAL / SAME-ORIGIN embedding of ONE cairn card in an iframe,
reusing the existing viewer. Remote cross-origin auth is DEFERRED (see below).

**Branch:** `feature/ws-embed` (STOP-at-branch; no merge to main).
**Base:** `ae86a95b` (main tip; coordinator reset the worktree off the stale
`origin/main` before work began — STEP-0 guard confirmed).

**Commits:**
- `0e8a6332` — embed_specs store + routes + embed vite entry + /embed/card serving + auto-height + route test
- `053004cf` — fix found in browser self-verify: MemoryRouter wrap + error boundary

---

## 1. embed_specs store + routes

`cairn/server/embed_specs.py` — `EmbedSpecStore`, an in-memory, thread-safe
TTL map (NOT DuckDB: specs are throwaway render inputs, no migration/
persistence needed).
- **Content-hash idempotent** — `sid` = first 16 hex of `sha256(canonical
  JSON)`, so re-POSTing the same spec returns the same `sid` and refreshes
  its TTL (no unbounded growth from re-embeds).
- **TTL + GC** — `DEFAULT_TTL_SECONDS = 3600`. Lazy GC on every `put`/`get`
  sweeps expired entries; a hard `max_entries = 1024` cap evicts
  oldest-expiring first. No background thread — access-time GC suffices for
  this small self-cleaning store.

Store is attached once per app on `app.state.embed_specs` in `create_app`.

`cairn/server/routes/embed.py`:
- `POST /api/embed/specs` — body `{spec: {...}}` → `{sid}`.
- `GET  /api/embed/specs/{sid}` — → `{sid, spec}`, 404 if unknown/expired.

Both sit behind the router-level `require_role("read")` dependency attached
in `app.py` (same posture as other `/api` data routes) — `--no-auth`
unaffected, auth-on not weakened. The POST is a read-role, idempotent, TTL'd
render-cache seed (not persistent domain data), so it intentionally does not
carry the write-role override the comparisons/reports mutations use.

Round-trip test: `tests/unit/test_embed_specs_route.py` (POST+GET, content-hash
idempotency, unknown-sid 404). 3 passed.

## 2. Embed vite entry + CardRenderer reuse

`cairn/ui/embed.html` + `cairn/ui/src/embed-main.tsx` — a MINIMAL entry:
`QueryClientProvider` + one `CardRenderer`. NO App chrome/nav.

Reuse approach (no fork of card dispatch, `three` stays lazy): the stored
spec is a viewer `ComparisonCard` (`{type, series:[{runId, name,
context_hash}]}`). The embed renders it exactly like `ReportCardsBlock`'s
`ReportCardRenderer` — synthesizing a **seed `SequenceMeta`** (placeholder
metadata; `CardRenderer` fetches the real sequence by runId+name+context) and
passing `extraSeries`/`controlledSeries` for overlays. Multi-run card types
(parallel/scatter/bar/tile) go through the `kind:"multi-run"` branch with a
`cardSettingsKeyForScope("embed", card)` key.

Layout: single-column CSS grid (`gridTemplateColumns: minmax(0,1fr)`) so
`CardShell`'s fixed-px card (which sets `gridColumn: span N`) is clamped to
one track and renders full-width.

`vite.config.ts`: added `build.rollupOptions.input = { main: "index.html",
embed: "embed.html" }` so `vite build` emits BOTH `index.html` and
`embed.html` into `dist/` with a shared `/assets` chunk graph. (Used relative
paths, not `resolve(__dirname,…)`, because the node tsconfig has no
`@types/node`.)

## 3. /embed/card serving

In `app.py`'s `_mount_spa_or_placeholder`, `embed.html` bytes are read at
startup and served at `GET /embed/card` — registered BEFORE the SPA
`/{path:path}` catch-all so the catch-all cannot swallow it and serve the app
shell instead of the embed bundle. `?sid=` selects the spec. (Server caches
HTML at startup — restart after a dist rebuild.)

## 4. Auto-height

`embed-main.tsx` observes the card container with a `ResizeObserver` and posts
`{type:"cairn:resize", height, protocolVersion:1}` to `window.parent` — the
SAME protocol `HtmlCard`/`PluginCard` emit and `card-kit/use-iframe-auto-height.ts`
consumes host-side. A host iframe sizes to content.

## 5. Fix from browser self-verify (commit 053004cf)

First browser load rendered BLANK. Sourcemap-resolved the minified crash to
react-router's `useNavigateUnstable → invariant`, thrown by
`RunSelectionPanel.tsx`'s `useNavigate()` — viewer cards reuse components that
call react-router hooks deep in the tree, which throw with no Router context
(the SPA supplies one via its RouterProvider; the embed had none). Fix:
- Wrap the embedded card in a `MemoryRouter` (no visible nav/routing) so those
  hooks resolve — preserves the "no app chrome" contract.
- Add `EmbedErrorBoundary` so a render failure shows a readable message inside
  the iframe instead of a blank page (still lets the host size to it).

## Browser evidence (--no-auth, port 4410)

Seeded a run in a fresh repo with a `loss` scalar (10 pts, value = 1/(i+1))
via `POST /api/runs` + `/batch`. POSTed a scalar card spec →
`sid=3eb2ac909395936e`.
- `http://127.0.0.1:4410/embed/card?sid=3eb2ac909395936e` renders the ONE
  scalar card — title "loss", "1 series · 10 pts", the decaying curve — full
  width, NO app chrome/nav.
- In a host `<iframe>` (700px wide), the host logged `cairn:resize heights:
  70, 316` and set `iframe.style.height=316px`, snugly wrapping the card —
  auto-height confirmed.
- Console clean on the post-fix load (0 messages).

## Gates

- `npm run typecheck` → exit 0.
- `vite build` → exit 0, emits BOTH `dist/index.html` + `dist/embed.html`
  (embed.html references its own `embed-*.js` entry chunk).
- `pytest tests/unit` → my 3 embed tests pass. 15 pre-existing failures are
  ENVIRONMENTAL (test_cli connection-refused + config/env-leak from a live
  cairn server on this machine — the coordinator's "~15 baseline"), none
  touch embed code.
- dist committed (per project convention); `node_modules` symlink never
  staged; no `.map` files committed.

## DEFERRED — remote cross-origin embed auth (TODO)

Clearly marked TODO(remote-embed) in `embed_specs.py`, `routes/embed.py`, and
`embed-main.tsx`. For cross-origin hosts this needs:
1. A per-`sid` unguessable **capability token** in the URL (so a leaked short
   `sid` alone can't be read from another origin).
2. A server `--embed-origins` **CORS allowlist**.
3. Narrowing `embed-main.tsx`'s `postMessage("*")` target to the allowed host
   origin.

Left for a later security-reviewed follow-up. This run is LOCAL / SAME-ORIGIN
only and does not weaken existing auth.
