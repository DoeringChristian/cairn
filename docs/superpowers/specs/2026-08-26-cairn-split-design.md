# cairn split — SCRAPPED (retained as investigation record)

Status: SCRAPPED (user ruling, 2026-08-26). After comparing with W&B's
architecture the user reversed the premise: live-updating reports are
dropped (removing the url-based access scheme), the UI stays bundled
with the server (HTTPS serving — even self-signed with click-through —
restores the secure context and therefore WebGPU, which was the
original motivation), and the current client-side logging stays as is.
The refactor is cancelled. This document is retained because its two
code surveys and the adversarial round (87 findings) uncovered REAL
defects in the CURRENT system, listed below; the v2 design that follows
is historical.

## SALVAGE LIST (fix-now candidates against the current architecture)

1. Client WAL checkpoint silently marks failed sends as delivered
   (single advancing integer) — live data loss in HTTP mode [M-04].
2. `cairn sync` cannot drain the client WAL (no WAL on its transport;
   scans the legacy spill dir, a different directory) [G-2].
3. Six client/server drift bugs: four artifact-registry route
   mismatches (resolve/versions/inputs/outputs), two `_LocalBackend`
   op-name errors, + the unread `server` config key / nonexistent env
   var in error text [G-8, G-17].
4. `RunQuery` silent 1000-row client-side cap — push predicates into
   `/api/runs` server-side [M-11 context].
5. auth-off mode ships CORS `*` with write routes — close with an
   explicit `--allow-origin` allowlist [S-2].
6. SSH-minted tokens never expire; key removal revokes nothing — add
   TTL + fingerprint revocation [S-8].
7. **HTTPS serving on the existing server** (`--tls-cert/--tls-key` +
   docs: tailscale serve / mkcert / ssh -L) — THE WebGPU fix; secure
   context follows the transport, so even self-signed-with-interstitial
   restores `navigator.gpu`.
8. Cookie `Secure` flag once TLS exists [S-9].
9. Cheap process win: OpenAPI generation + a client↔server conformance
   test in CI (kills drift class 3 with no split).
10. Back pocket (not now): W&B-style log-FIRST ingest (always write the
    local transaction log, online or not) is strictly more robust than
    WAL-on-dropout and fits the current architecture.

Unaffected by the reversal: the cairn-plot Host API v4.2 spec (it
concerns cards consuming cairn-plot, not servers); today's
`query_url`/`DataRef` machinery stays as-is (no expansion).

---

# HISTORICAL: the v2 design as reviewed (do not implement)


Owner: cairn. Companion spec: cairn-plot Host API v4.2 (its Tier-2
data-source seam consumes this spec's reference URLs; one delta to it is
flagged in §7).

## 1. Motivation

1. **WebGPU is `[SecureContext]`-gated.** A UI served over plain HTTP from
   another machine has no `navigator.gpu`. A statically-hosted HTTPS UI
   connecting to a user-chosen server fixes this — subject to
   mixed-content: an HTTPS page cannot fetch a plain-HTTP remote origin.
   Blessed remote paths: `ssh -L` to localhost (exempt), or HTTPS on the
   server.
2. **Independence — the fundamental goal.** UI and server are SEPARATE
   THINGS; server, UI, and experiments run and version independently.
   GitHub Pages is ONE hosting option for the static UI, not the goal:
   running it locally (`cairn ui`, any static file server) is equally
   first-class. Today one wheel carries all three, the server always
   serves the UI, and the SDK imports server internals.

## 2. Rulings (user, 2026-08-26 — unchanged in v2)

- **cairn-track**: python client pushing to the server. SERVER-ONLY
  ingest; the only local file writing is the client WAL.
- **cairn-server**: ingestion + dynamically-addressable query endpoints;
  HTTPS-capable; tokens (UI) + SSH-key auth (track); OAuth later.
- **cairn-ui**: static react app connecting to a chosen server; the
  server does not always spawn the UI.
- **cairn-plot**: separate repo; REFERENCES ARE URLS — the accessor
  chain is `cairn.Repo` in cairn-track; cp accepts url-or-bytes only;
  view-time resolution, `.pin()`, `.get()` (arrays for selectors).
- **Ephemeral local server** for zero-setup local workflows (track stays
  HTTP-only). **Signed URLs** for browser tags. **Packaging**:
  cairn-track keeps its pip name; new cairn-server, cairn-cli (owns the
  `cairn` command), cairn-ui wheels; monorepo. **Plugins dropped** for
  now. **Multi-run**: one url per cp component; selector `.get()` →
  array; dynamic-N = cairn-ui cards. **mDNS**: not in the connect
  screen; `cairn ui --server|--discover` locally.

## 3. Current state (v2-corrected survey digest)

**The grammar** exists in three mirrored places: `RunQuery` kwargs over
`_OPERATORS` + `_RUN_FIELDS` (client-side evaluation, silent 1000-row
cap); `/api/query` → `QuerySpec` (imports `_OPERATORS`; predicates
`field[.sub][__op]=value`; run selectors `latest|latest:N|
newest-per-name|id:<id>`; 302 → digest); `query_urls.py` (ONE-WAY
serializer). v2 corrections: the operator TABLE is shared but the
encoder is lossy for list-valued ops and the two sides coerce values
differently — "no drift by construction" holds for the table only
[G-9]; the weak selector dialect has THREE implementations (TS
run-selector, card-spec pydantic, server `resolve_run_ids` — the last
is unrouted dead code implementing the WEAK dialect, not the predicate
grammar) [G-16]; `/api/compare` is POST-only, hence not URL-addressable
today [G-15].

**Accessor nouns** as v1 (Reader → RunQuery → Run → sequence/artifact/
params/logs/source; `DataRef`). The zip-archive read path
(`Reader("run.zip")`) and explicit local-path Readers exist and must
survive the split somewhere [G-10, W-10].

**Ingest**: three modes (direct-DB, repo-dir WAL, HTTP). v2 corrections
to v1's overclaims:
- **Offline start is impossible today**: `Run.__init__` calls
  `create_run` unguarded and keys the WAL on the SERVER-returned id;
  the client-generated id is discarded; `create_run` is not a WAL op.
  [G-1]
- **`cairn sync` cannot drain the client WAL**: it constructs a
  Transport with no WAL and scans the legacy spill dir, a different
  directory; nothing anywhere discovers orphaned client WALs. [G-2]
- **The client WAL is not replay-safe as-is**: single-integer
  checkpoint (one failed send followed by one success marks the
  failure delivered) [M-04]; seq restarts on file recreation [M-16];
  not concurrency-safe; several ops are never WAL'd (tags, notes,
  heartbeat, artifact-meta, use_artifact) [G-13]; location fixed to
  the user cache dir, growth unbounded [W-6].
- **The lock/advertisement substrate does NOT do what v1 claimed**: no
  SDK process ever acquires `repo.lock`; `servers.json` is written
  only by `cairn ui` and read only for notebook banners; the
  HTTP-upgrade path triggers only on a `mode=="server"` holder; no
  spawn-race arbitration exists. [G-3, W-8]

**Auth**: Bearer (SDK) + HttpOnly cookie (browser, `secure=False`);
SSH-key login exists (`cairn login --ssh`, `authorized_keys` with role
comments) but mints NEVER-EXPIRING tokens and key removal revokes
nothing [S-8]. CORS: auth-on ⇒ `[]`; **auth-off ⇒ `*` with write routes
— any web page can hit an auth-off loopback server cross-origin**
[S-2]. No HTTPS anywhere. Token admin is local-DB-only CLI.

**UI**: one api client; `artifactUrl` is a SYNC pure formatter with ~51
call sites across 20 files (10 are browser tags; 4 feed cairn-plot's
`createEndpointDataSource`, whose resolver type is sync) [G-4]; cookie
auth; polling freshness; zero build-time config. Static-build blockers
as v1 (base/basename, 404 trick, endpoint config, CORS/cookies,
embed/plot routes, CDN deps).

**Shipping drift** (v2-corrected): the artifact-registry path mismatches
(resolve, versions, inputs, outputs) are client-vs-server HTTP drift a
conformance suite catches; the two `_LocalBackend` op-name errors are
python-attribute drift killed by S2's deletion instead [G-8]. Plus a
6th of the same class: the CLI persists a `server` config key that
nothing reads, and error text references an env var that doesn't exist
(`CAIRN_REPO=cairn://host:port` is the real spelling) [G-17].

## 4. Target architecture

Layout as v1 (packages/cairn-{core,track,server,cli} + apps/cairn-ui,
the last also built as a `cairn-ui` static wheel), with v2 precision:

- **cairn-core** (dependency-light, stdlib+pydantic at most): the
  grammar (operators, fields, selectors, QuerySpec, URL ENCODER AND
  DECODER), wire models, the WAL op vocabulary + envelope, API-version
  constants, `read_live_servers`/lock-file formats (needed by both
  sides) [M-20]. Plus `schema/`: generated OpenAPI + JSON schemas +
  **the grammar conformance VECTORS** — a committed JSON fixture of
  `{kwargs|params → url → parsed}` cases that the python implementation
  AND a hand-written TS mirror (`apps/cairn-ui/src/grammar/`) must both
  reproduce; the TS mirror is an S0 deliverable, drift-gated by the
  same fixture [M-14].
- **cairn-track**: Run/Reader/Transport/WAL/capture/handlers/discovery +
  the AUTHORING surface (elements, report emitters, card specs,
  `cairn.plot` re-exports) — see the module disposition table below.
  Dependency rule restated honestly [M-21]: **no FastAPI/uvicorn/
  sqlite3 and no cairn-server import**; the media/array deps
  (numpy/pillow/zstandard/psutil/pynvml) stay, split into extras
  (`[media]`, `[system]`) where already optional.
- **cairn-server**: FastAPI app, storage, ingest ops, query resolver,
  auth, `cairn-server` CLI (incl. an `--ephemeral` mode, §6.1).
- **cairn-cli**: the `cairn` entry point; client commands via
  cairn-track; `cairn server`/`cairn ui`/`cairn token *` via the
  `[server]`/`[ui]` extras (token admin opens the DB → server extra)
  [M-22]. TRANSITION RELEASE [W-18]: cairn-track ships one final
  version whose `cairn` shim depends on/points at cairn-cli with the
  exact install line; release notes lead with it.
- **Module dispositions** [M-20]: `elements.py`/`report.py`/
  `card_spec.py`/`plot_*` → cairn-track (authoring; their
  `read_live_servers` import moves to cairn-core; their server-base
  assumptions replaced by the UI-base concept, §8); `wal_ingest.py`
  repo-dir scanner → cairn-server (migration-ingest only, §10);
  plugins → dropped with the ruling.
- Dependency rule: no `track ↔ server` python imports. §6.1 conforms:
  the ephemeral server is spawned as a SUBPROCESS via the
  `cairn-server` console script — presence detected via the
  `[local]` extra's pip dependency — never imported [G-6, M-02].

## 5. The contract

As v1 (cairn-core grammar; predicates server-side; `/api/query` stays
the single-artifact resolver; OpenAPI + conformance suite; version
handshake `{api_version, min_client}` on `/api/health`), with v2
corrections:
- **Reserved-name rule** [M-12]: control params (`limit`, `offset`,
  `project`, `status`, `run`, `tag`, `step`, `format`, `at`, `name`,
  `sort`, …) are a CLOSED reserved set in cairn-core; predicates on
  colliding user params must be written `params__<name>__<op>`; one
  conformance vector per reserved name.
- **`RunQuery.filter` compiles to params** with server-side evaluation
  of ALL roots incl. `metrics.*` (final-scalar predicates are a server
  JOIN, not SQL-trivial — named as real S1 work, not a free rewrite)
  [M-11].
- **`/api/runs/select`** is built on the predicate grammar; the
  existing `resolve_run_ids` is plumbing only (it speaks the weak
  dialect); the weak dialect's THREE sites (TS run-selector, card-spec,
  server) are all re-expressed over the one grammar [G-16].
- The OpenAPI schema cannot express the predicate grammar's open
  key-space — the conformance VECTORS are the grammar's drift gate;
  OpenAPI gates the fixed routes [M-13].
- The handshake ships WITH the first static-UI release (S4), not after
  [M-18].

## 6. Ingest: server-only + client WAL (v2 — specified as NEW work)

The durability model, stated as the target it is [G-1/2/13, M-04/15/16,
W-3/6]:

- **Client-authoritative run ids**: the client-generated id (already
  minted, currently discarded) becomes THE run id; `create_run` becomes
  idempotent registration and WAL op #1. `Run.__init__` no longer
  fails on an unreachable target: the run starts in `buffered` state,
  everything accumulates in the WAL, and `run.url` is defined once a
  server acknowledges. This is the offline-start story — new work.
- **Every op is WAL'd**: the vocabulary (in cairn-core) covers create,
  batch, params, logs, artifact, artifact-meta, tags, notes,
  use_artifact, heartbeat†, finish (†heartbeat is send-only, never
  replayed). Ops carry `(run_id, wal_epoch, seq)`: `wal_epoch` is
  minted at WAL creation and persisted in the WAL header, so seq reuse
  after cleanup can never alias [M-16].
- **Ack discipline** [M-04]: the sender never transmits op N+1 while op
  N is unacknowledged (per-run pipeline of depth 1 at the OP level;
  batching happens INSIDE ops). The checkpoint records the acked
  low-water mark only. This is the ordering guarantee the server-side
  dedupe is allowed to assume.
- **Server-side idempotency** [M-15]: a `(run_id, wal_epoch, seq)`
  ledger checked-and-inserted in the SAME transaction as the op's
  effects, before any filesystem write; `log_lines` gains the missing
  uniqueness key; content-addressed blob uploads are exempt (their
  digest is the dedupe) and run-less ops carry a synthetic scope.
  Ledger retention: per-run, dropped with the run.
- **WAL location/lifecycle** [W-6]: `CAIRN_WAL_DIR` env + config key
  (HPC: point at node-local scratch); a size bound with a documented
  disk-full policy (fail the run loudly, never silently drop); batch
  fsync policy; `cairn sync --prune` GC for drained/orphaned WALs and
  artifact spill files.
- **`cairn sync` is rebuilt** [G-2]: a WAL-DIR SCANNER that enumerates
  orphaned `{run_id}.wal.jsonl`, reconstructs the log, resolves the
  target server (recorded in the WAL header at creation), and drains —
  including runs the server has never seen (client-authoritative ids
  make that just another replay).
- **`cairn push <data-dir|archive> <server>`** [W-5]: server-side
  import of a whole local data dir/export — the escape path for data
  captured against an ephemeral server that should move to a central
  one.
- **HPC story, stated explicitly** [W-4]: multi-node jobs point at a
  CENTRAL server (the model's purpose); nodes without a network route
  run WAL-ONLY (offline-start) and `cairn sync` from a login node
  later. SQLite on shared filesystems is EXPLICITLY UNSUPPORTED; the
  ephemeral server is single-host by contract (its lock records
  hostname + boot id and cross-host holders are rejected, not reaped).

### 6.1 The ephemeral local server (v2 — mechanics specified)

The ruling stands; the mechanics are new work [G-3, M-06, W-7/9, S-1/2]:

- **Spawn**: a DETACHED SUBPROCESS via the `cairn-server` console
  script (`cairn-server --ephemeral --data <dir>`), never a python
  import (dependency rule intact); availability comes from the
  `cairn-track[local]` extra. Loopback bind on an ephemeral port.
- **Election** [M-06]: an atomic `O_EXCL` claim (a new `repo.lock`
  mode `"embedded"`, stamped with hostname + boot id + pid) taken
  BEFORE binding; losers poll the advertisement with a bounded timeout
  and connect. The advertisement (`servers.json`) is written only
  after bind + self-health-probe. DDP ranks / parallel sweeps therefore
  converge on one server. `cairn ui`/`cairn server` finding an
  `"embedded"` holder connect to it (or take over per §11.1) instead
  of hard-exiting.
- **Auth — NOT auth-off** [S-1/2, W-9]: loopback TCP is not a user
  boundary (any local UID; HPC login nodes). The spawned server runs
  auth-ENABLED with a per-spawn random bearer token written 0600 into
  the data dir (`auth/ephemeral.token`, dir 0700); clients on the same
  account read it from disk. CORS: `allow_origins=[]`; Host/Origin
  checked against loopback literals. The auth-off `*` wildcard is also
  removed GLOBALLY: auth-off servers get the same explicit
  `--allow-origin` list as auth-on (S3) [S-10].
- **Lifetime + failover** [W-7]: the server OUTLIVES its spawner
  (detached), shutting down after an idle timeout (no connected
  clients, no WAL activity; default TBD §11.1). A client losing its
  server re-runs resolve→elect→spawn; the WAL replays into whichever
  server next owns the data dir (replay targets the DATA DIR identity,
  not a URL).
- **Reader coverage** [G-10, W-10]: `Reader(path)` and
  `Reader("run.zip")` route through the same spawn (archives unpack to
  a temp dir first). The `[local]` extra is the requirement; without
  it, the error names it.
- **References** [W-11, M-07]: `cairn.Repo`/reference authoring REFUSES
  an ephemeral loopback base by default (error suggests `.get()`,
  `.pin()`+`cairn push`, or a durable server; `allow_ephemeral=True`
  escape hatch for same-machine experimentation). Live references
  require a durable, addressable server — stated in §9.

## 7. Auth, HTTPS, CORS (v2 — the full model)

- **Origin-bound credentials** [S-7]: client config keys tokens BY
  ORIGIN (`[servers."https://host:4300"] token=…`); `CAIRN_TOKEN`
  applies only to the resolved target; the UI's localStorage keys
  tokens by exact origin and never replays across origins.
- **SSH minting bounded** [S-8]: SSH-minted tokens default to a TTL
  (30d, `--ttl` override), record the minting key fingerprint, and
  `cairn token revoke --key <fp>` revokes by fingerprint; verification
  re-checks the fingerprint against `authorized_keys` per use, making
  key removal a real kill switch.
- **Signed URLs, fully specified** [S-5, G-5, S-11]:
  - Signature: `HMAC(secret, digest ‖ token_id ‖ exp)` — DIGEST-BOUND,
    so a leaked URL grants exactly one immutable blob for its window.
    Secret at `auth/url_signing_key` (0600/0700), stable across
    restarts, shared by co-deployed apps.
  - Minting: `POST /api/artifacts/sign` (batch: digests → signed urls),
    `read` role.
  - **The query-URL reconciliation** [G-5, M-08, S-6]: `/api/query`
    itself accepts `sig`/`exp` (payload: the canonicalized query string
    ‖ token_id ‖ exp) and propagates a FRESHLY-MINTED digest signature
    onto the 302 `Location`. Live references in browser tags therefore
    work; report viewers obtain query-URL signatures through the
    connect/token module at view time (§8).
  - Blob responses get `X-Content-Type-Options: nosniff` and a
    conservative content-type policy (client-supplied types sanitized)
    [S-11].
  - **The UI funnel stays synchronous** [G-4, S-4]: the api layer
    BATCH-MINTS signatures when artifact digests arrive in responses
    (the hooks know every digest they render) into a cache with a
    refresh timer; `artifactUrl(hash)` reads the cache. Cache miss ⇒
    unsigned url + immediate batch re-mint + one re-render (the
    Host-API "flip" pattern). COMPANION-SPEC DELTA: cairn-plot's
    `createEndpointDataSource` resolver must tolerate an async-refresh
    url provider (flagged for Host API v4.2 M2).
- **Transport/auth matrix** [S-9]: cookie sessions get
  `Secure` + `SameSite=Lax` whenever TLS is on; token auth is
  transport-agnostic; the bootstrap OTP link is loopback-or-TLS only.
- **Cross-origin bootstrap** [W-13/14]: `/api/health` allows `*`
  unconditionally (liveness + version + an `allowed_origins` echo so
  the connect screen can say "server reachable but this origin is not
  allowed — restart with --allow-origin …" instead of a blind CORS
  failure); `POST /api/auth/otp` gains a bearer-exchange form
  (OTP → token) for cross-origin first-login; the server banner prints
  the token and a `https://<ui>/?endpoint=<server>` link.
- **No credentials in argv or URLs** [S-12, W-17]: `--token` reads
  stdin/env; the `cairn ui` handoff uses a served 0600 `config.json`
  (same-origin fetch), never URL params; credential params, if ever
  present, are stripped from history on load. Endpoint-config
  precedence (ONE chain): served `config.json` > `?endpoint=` >
  localStorage > connect screen; a CLI-provided endpoint overwrites the
  remembered selection.
- **Abuse controls** [S-14]: rate limits on the unauthenticated auth
  endpoints; constant-time comparisons already in place.
- The plugin WS work is REMOVED (plugins dropped); the `/ws/plugin`
  route ships disabled/removed with the split rather than half-secured
  [S-3, G-7].

## 8. cairn-ui as a static app

As v1 (runtime endpoint config, base/basename + 404 fallback, CDN dep
inventory, degraded-offline behavior, optional server `--ui` mount),
with v2 additions:
- **`cairn ui --server <url>`** runs in PROXY mode [W-16]: the CLI
  serves the UI locally AND reverse-proxies `/api/*` to the target —
  same-origin (no CORS config needed on the target), the token held
  CLI-side (no browser handoff), a stable origin. `--discover` only
  pre-fills the connect screen (never transmits credentials to a
  discovered endpoint) [S-12].
- **Notebook cards** [W-20]: an explicit UI-BASE concept (config key +
  `cairn.configure(ui=…)` + a `servers.json` field); the emitters
  build `<ui-base>/embed.html?endpoint=<server>&sid=…`. Embed
  cross-origin requires the capability-token + `--embed-origins` work
  the code already defers — until that lands (S4 named deliverable),
  `/embed/card` remains a server-served same-origin route and the
  Pages build ships without the embed entry [M-19].
- **Report viewers** [W-12]: live-reference reports are supported from
  http(s) origins (documented; `file://` has a null origin and no
  storage — unsupported for live refs; `.get()`-baked reports work
  anywhere); a SHARE TOKEN primitive (scoped read-only, expiring,
  mintable with `read` role) provisions colleagues; panes render the
  Host API `error`/`stale` states on 401/expiry with a connect prompt.

## 9. References — `cairn.Repo` in cairn-track; cairn-plot takes URLS

As v1 (urls are the whole cp contract; `cairn.Repo` wraps
Reader/RunQuery/DataRef; `.pin()` swaps in the server-provided
`pinned_url` from the `format=json` envelope; `.get()` returns
buffers — arrays for selectors; hand-written urls work; authoring-time
dependency only), with v2 corrections: `/api/compare` is NOT currently
a reference target (POST-only; the GET form stays deferred per the
multi-run ruling) [G-15]; live references REQUIRE a durable server —
ephemeral loopback bases are refused at authoring (§6.1); viewer-side
signature/token acquisition is §7/§8's story.

**Caching model (per-element urls are cheap by construction):**
- BYTES: `/api/artifacts/{digest}` is already `public, max-age=1y,
  immutable` — the browser HTTP cache dedupes repeat blob loads across
  panes, runs, and sessions (digests are perfect cache keys).
- RESOLUTION: `/api/query` stays `no-store` (view-time semantics); it is
  a tiny lookup that 302s into the cached layer. Pinned refs skip it;
  baked refs cost nothing. A batch-resolve endpoint is a compatible
  later add if resolve volume ever matters.
- DECODE/GPU: the Host API RefStore keys decode + upload caches by
  contentKey = the DIGEST, so identical artifacts across different runs
  share one fetch/decode/texture under the LRU byte budget.
- SIGNING × CACHING RULE [v2 addition]: a rotated `sig` is a new HTTP
  cache key, so signatures are minted once per digest per refresh window
  and the url string stays STABLE within it — HTTP-cache granularity
  degrades only to the signing window, never per render.

## 10. Migration plan (v2 — stages carry the new work)

S0. Contract extraction: cairn-core (grammar + encoder/DECODER + wire
    models + WAL vocabulary + conformance VECTORS); the TS grammar
    mirror in cairn-ui, gated by the same vectors [M-14]; OpenAPI
    generation + drift gates; conformance suite; fix the FOUR
    HTTP-drift bugs + the config-key/env-var drift (the two
    `_LocalBackend` op-name drifts die with S2) [G-8, G-17].
S1. Predicates server-side (incl. `metrics.*` evaluation) [M-11];
    reserved-name rule + vectors [M-12]; `/api/runs/select`; the three
    weak-dialect sites re-based [G-16]; UI filters re-based.
S2. Ingest rebuild per §6: client-authoritative ids + offline start;
    full WAL vocabulary + epoch/seq + ack discipline; server
    idempotency ledger + log uniqueness; `cairn sync` scanner +
    `--prune`; `cairn push`; WAL dir/bounds config; THEN retire
    direct-DB/repo-dir modes. UPGRADE MIGRATION [W-19]: the server's
    repo-dir WAL scanner survives as a migration-ingest step so
    pre-split `.cairn/wals/` files are drained, not stranded.
S3. Auth/transport per §7 (origin-bound tokens, SSH TTL/fingerprint
    revocation, signing key + mint endpoints + query-sig propagation,
    CORS allowlist incl. auth-off, TLS flags, secure-cookie matrix,
    OTP bearer exchange, rate limits).
S4. Static cairn-ui per §8 (incl. the version handshake [M-18], the
    signed-url cache funnel, proxy-mode `cairn ui`, the embed
    decision, share tokens); Pages CI deploy; server `--ui` optional;
    wheel slims.
S5. Package split + the `cairn` console-script TRANSITION RELEASE
    [W-18, M-22]; module dispositions per §4 incl. the ephemeral
    subprocess seam; `cairn ui`/`cairn server` preserved behind
    extras.
S6. `cairn.Repo` in cairn-track + plain-https Tier-2 consumption in
    the report runtime — after Host API M2 (RefStore), including the
    async-url-provider delta [G-4].

## 11. Open questions (v2 — the §2 rulings all stand; these are new)

1. Ephemeral-server idle-timeout default, and takeover semantics when
   `cairn server`/`cairn ui` wants a data dir a live embedded server
   holds (proposal: the embedded server drains and exits on a takeover
   request).
2. Share-token scope granularity (per-project? per-report reference
   set?) — decide with the first shared-report user story.
3. Whether `cairn push` also accepts pre-split exports (`.zip`) or
   only data dirs (proposal: both; the archive path already unpacks).

## 12. Review dispositions (round 1: 4 lenses, 87 findings)

All 26 blockers incorporated: the three "existing machinery" overclaims
rewritten as specified new work (offline start G-1/W-1/M-05; sync
G-2/W-2/M-03; ephemeral substrate G-3/W-8/M-06/W-7); the signed-url ×
reference collision reconciled via query-signing + 302 propagation
(G-5/S-6/M-08); the sync artifactUrl funnel respecified as a
batch-mint cache (G-4/S-4/W-15/M-09); the loopback-auth falsehood
replaced with per-spawn tokens + closed CORS (S-1/S-2/W-9/G-11/M-17);
the plugin-WS contradiction resolved by removal (S-3/G-7); WAL
soundness holes closed (M-04/M-15/M-16/G-12/G-13/W-3/W-6); the
HPC/multi-node story stated (W-4/W-5); the dependency-rule conflict
resolved via subprocess spawn (G-6/M-02); packaging/CLI transition +
module dispositions added (M-20/M-21/M-22/W-18); grammar/TS-mirror/
reserved-names/conformance corrections (M-11..M-14, G-8/G-9/G-15/
G-16/G-17); UI bootstrap/config/embed/report-viewer stories added
(W-12/W-13/W-14/W-16/W-17/W-20/M-18/M-19); the reference-vs-ephemeral
collision closed (W-11/M-07). Remaining majors and the 13 minors are
absorbed above or tracked in the archived findings
(`2026-08-26-cairn-split-r1-findings.json`) — none contract-bearing
beyond what is written here.
