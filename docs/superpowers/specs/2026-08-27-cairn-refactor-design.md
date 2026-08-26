# cairn refactor — robustness, one type vocabulary, modular cards

Status: v1 DRAFT (2026-08-27), grounded in three code surveys (client/
ingest, UI data layer, card/type system) + the scrapped split spec's
adversarial round (its salvage list is absorbed here). User rulings §2.
Supersedes the salvage list in `2026-08-26-cairn-split-design.md`.

Owner: cairn. Companion: cairn-plot Host API v4.2 (unaffected; the card
manifest builds toward it).

## 1. Principles

1. **No deployment split.** UI + server stay bundled (`cairn ui` as
   today; W&B self-hosted does the same). HTTPS serving on the bundled
   server restores the secure context → WebGPU (the original problem).
2. **Logical separation instead**: the server is TYPE-AGNOSTIC and
   lightweight. It knows two nouns — tracking ROWS and content-addressed
   BLOBS — plus `object_type` as an opaque, filterable string it stores
   and groups by but never interprets. Generic ROW operations (range/window
   queries, series alignment) stay server-side; DOWNSAMPLING IS REMOVED
   (ruling 2026-08-27) — sequences ship raw, and any thinning for render
   performance is a client/renderer concern, not the server's. ENFORCED invariant: server code never imports
   handlers or card definitions (boundary lint, like cairn-plot's).
   Payoff: new card types require zero server changes.
3. **Log-first ingest** (W&B's shape): one write path, always durable.
4. **One type vocabulary, one central definition per type** (the Card
   Manifest), replacing ~15 independent declarations.
5. **Plugins are removed** (an RCE surface); the manifest is the
   sanctioned extension path — compile-time code in the repo, no
   user-injected execution.

## 1b. Package boundaries (ruling 2026-08-27 — the split's good half)

Four packages in the monorepo, bundled at DEPLOYMENT (the server hosts
the UI on the same origin — no CORS/token/signed-url machinery needed),
separated in CODE with a one-way dependency chain:

- **cairn-track** — the python interface: logging (`Run`, handlers,
  wrappers, the transaction log) AND reading (`Reader`, `RunQuery`,
  `DataRef`). Depends on no other cairn package; never imports
  cairn-server (lint-enforced — kills today's sdk→server imports).
- **cairn-server** — FastAPI app, storage (SQLite + blob store), ingest
  (the log tail), query resolver, auth. Type-agnostic (§1.2). Depends
  on NO other cairn package either — **no code dependency in either
  direction** (ruling follow-up 2026-08-27): the server OWNS the query
  grammar's authoritative implementation (decode + evaluate — it is the
  endpoint); cairn-track carries only the small client mirror (operator
  vocabulary + the kwargs→param encoder), cairn-ui the TS mirror, and
  all three are pinned by shared CONFORMANCE VECTORS — a committed data
  artifact, not an import. Each mirror site carries a NOTE naming the
  authoritative source and the vector fixture (ruling: duplication is
  fine when marked) — e.g. `# MIRROR of cairn-server's query grammar;
  pinned by schema/query-vectors.json — change all three together`. Today's server→sdk `_OPERATORS` reach-in is
  removed by moving the table server-side, not by legalizing it. The
  ingest-log op vocabulary gets the same treatment (track produces,
  server consumes, the fixture pins both). Serves the cairn-ui dist.
- **cairn-ui** — the react app. Talks HTTP to cairn-server only;
  same-origin. Its type knowledge comes from the Card Manifests (§5),
  conformance-bound to cairn-track's handlers via the generated type
  manifest.
- **cairn-cli** — the `cairn` command: run management from the shell
  (list/ping/sync/rm/export/…) via cairn-track, plus `cairn server` and
  `cairn ui` (which serve cairn-server with the bundled UI).

The cross-package CONTRACTS are exactly two artifacts, both drift-gated:
the HTTP API (OpenAPI + conformance suite, §6.4) and the type manifest
(§5.2). Everything else is private to its package.

## 2. Rulings (user, 2026-08-27)

- Fix the WAL data-loss + `cairn sync` fundamentally; match W&B
  robustness. Client-side logging STAYS (local modes kept).
- Fix the drift bugs and assert them in tests.
- The storage schema is v2 (SQLite); scrub v1 (DuckDB) remnants; audit
  that no concept carries two names. Now is the window for API breaks —
  first sanctioned break: `run["config"] = …` → `run.config(...)`.
- `--no-auth` stays (debugging); its CORS hole gets closed anyway.
- SSH keys authenticate MACHINES (cairn-track/server side), never the
  UI; keys are manageable THROUGH the UI (GitHub-style keys page); both
  directions supported (keys via UI, temporary tokens to machines).
- TLS serving: yes.
- Plugin system: removed.
- Cards become modular: central per-type definitions covering multi-run
  MERGE behavior (overlay for scalars, grid for images), exposed
  SETTINGS (dialog + quick edits), what data flows to cairn-plot, and
  how the data is uploaded (the log-side handler).
- Data model: ARTIFACTS (heavy, content-addressed store, referenced by
  the database) vs TRACKING DATA (scalars, text, references into the
  artifact store).

## 3. Data model (confirming the ruling, sharpened)

Two STORAGE CLASSES, one reference rule:

- **Rows** — small, queryable, hot: sequences (`(run, name, step,
  context)` → scalar | blob-ref), params/config (step-less rows), logs
  (high-volume append rows), tags/notes/metadata.
- **Blobs** — heavy, immutable, content-addressed (SHA256, deduped,
  Range-served, `immutable` cache headers): images, checkpoints,
  meshes, audio/video, serialized tables/tensors.
- **The rule**: rows may reference blobs by digest; nothing else links
  the classes. `object_type` tags rows and blobs opaquely.
- Threshold rule (new, explicit): text above a size threshold (default
  16 KB) is stored as a blob with a row reference; below, inline in the
  row. One documented knob instead of per-handler folklore.
- A handler may emit MULTIPLE blobs per tracked value (first-class —
  today the figure handler smuggles a second blob through an
  underscore-prefixed metadata side-channel that `track()` special-
  cases; that hack dies, §6).

## 4. Log-first ingest (fixes salvage #1 and #2 structurally)

Today three write modes exist (direct-DB, repo-dir WAL + 2s server
ingest loop, HTTP + dropout-WAL), and the dropout-WAL both loses data
(single-integer checkpoint marks failed sends delivered) and cannot be
replayed by `cairn sync` (wrong transport, wrong directory).

**The redesign: the transaction log IS the write path — always.**

- Every `Run` appends every op to a local, per-run, seq-numbered log
  (fsync-batched), regardless of connectivity. The log carries a
  `log_epoch` (minted at creation, so seq can never alias across
  recreations) and a header recording the target (server URL or data
  dir).
- **Consumers tail the log**:
  - HTTP mode: a sender tails and ships; server acks advance a
    low-water mark OVER THE LOG. Nothing is ever marked sent except by
    advancing past an acked record — the M-04 data-loss class becomes
    unrepresentable. Send discipline: never ship op N+1 while N is
    unacked (batching lives inside ops).
  - Local mode (client-side logging KEPT, unified): the repo-dir
    ingest loop already tails `.cairn/wals/` — it becomes the ONE
    local mode. The direct-DB immediate-write transport is retired;
    "local" = log + the in-process/`cairn ui` ingester tailing it.
    One code path for local and remote; offline is just "the tail is
    behind".
- **Server-side idempotency**: `(run_id, log_epoch, seq)` ledger,
  checked-and-inserted in the same transaction as the op's effects
  (log rows get the missing uniqueness key); content-addressed blob
  uploads dedupe by digest and are exempt.
- **Offline start**: run ids become CLIENT-AUTHORITATIVE (the client
  already mints one and discards it); `create_run` is log op #1 and an
  idempotent registration server-side. `Run.__init__` never fails on
  an unreachable target — the run is `buffered` until first ack.
- **`cairn sync` is rebuilt as log catch-up**: scan the log dir(s),
  reconstruct, resolve each log's recorded target, drain. `--prune`
  GCs drained logs + artifact spill files. `CAIRN_WAL_DIR` env/config
  for HPC scratch; a size bound with a loud disk-full policy.
- Ops covered: create, batch, params/config, logs, artifact,
  artifact-meta, tags, notes, use_artifact, finish (heartbeat is
  send-only, never logged/replayed).

## 5. One type vocabulary + the Card Manifest (the centerpiece)

### 5.1 The problem, measured

The type vocabulary is declared ~15 independent times (handlers ×17,
wrappers ×17, `card_spec.py` ×3, `card-spec.ts`, `MULTI_RUN_CARD_TYPES`
+ labels, `CardRenderer`'s 17-arm switch + separate multi-run if-chain,
`TYPE_LABELS`, `TYPE_ORDER`, `CARD_MIN_SIZES`, `MEDIA_TYPES`,
viewport-registry (1 entry + 4 bypassing 3D modules), ~20 per-card
settings interfaces, 13 cairn-plot renderer ids, `DataSpec.objectType`'s
4-member literal, and a dead server-side `scalar_plot/image_gallery`
map). Only the names ride a drift gate; settings shape, merge behavior,
labels, sizes, sections do not. Concrete casualties: `MEDIA_TYPES`
misses 8 types (mis-sectioning); `object_type` is cast to `CardType`
unchecked in 3 places; two contradictory type guards coexist; the
`/api/workspaces` endpoint speaks a vocabulary of components that no
longer exist.

### 5.2 The design: one manifest per type, two conformance-bound halves

The in-tree precedent is cairn-plot's `ViewportModule` + declarative
`ViewportCapabilities` — a plain record selected by `object_type` via a
registry, with `VisualContentCard` interpreting capabilities. It is
registered for 1 of 21 types and bypassed by 4; this design finishes
that promise and extends it beyond rendering.

**TS half — `CardManifest` (one file per type, one registry):**

```ts
interface CardManifest<TSettings> {
  id: ObjectType | MultiRunCardId;    // THE name (see 5.3)
  label: string; section: Section; minSize: CardMinSize;
  tier: "series" | "multi-run";
  /** Multi-run composition — the ruling's merge concept, declarative: */
  merge: "overlay"      // one plot, N series (scalar)
       | "grid"         // one pane per run (image/media/3D)
       | "join"         // one table/plot joined across runs (table, parallel)
       | "none";        // single-run only
  /** Settings: schema + defaults + exposure. Keys reuse cairn-plot's
   *  namespaced ViewportSettings vocabulary where the card wraps a
   *  cairn-plot surface; card-only keys live in a `card.*` namespace.
   *  `quickEdit` lists the keys surfaced outside the dialog. */
  settings: { schema: SettingsSchema<TSettings>; defaults: TSettings;
              quickEdit: (keyof TSettings)[] };
  /** What to fetch for a run set (rows? artifacts-at-step? params?) —
   *  consumed by one shared data layer; replaces per-card fetch code. */
  dataPlan(runs: RunSet, series: SeriesSel): DataRequest[];
  /** Render: data + settings → a cairn-plot descriptor (preferred) or a
   *  Pane component (ViewportModule absorbed here as the media case). */
  render: DescriptorBuilder<TSettings> | { module: ViewportModule };
}
registerCard(manifest);   // ONE registry; every table derives from it
```

Derived (deleted as hand-written tables): `TYPE_LABELS`, `TYPE_ORDER`,
`CARD_MIN_SIZES`, `MEDIA_TYPES` (→ `section === "media"`), the
`CardRenderer` switch (→ one lookup + one generic shell), the multi-run
if-chain (→ `tier`/`merge`), the settings-interface sprawl (→
`settings.schema`), both type guards (→ registry membership with the
forward-tolerant behavior `isComparisonCard` wanted).

**Python half — `TypeHandler` v2 (one file per type, one registry):**

```python
@dataclass
class TrackedValue:
    rows: RowFields                  # scalar_value | blob ref | inline text
    blobs: list[Blob] = ()           # MULTI-BLOB first-class (kills _source_blob)
    metadata: dict = field(default_factory=dict)

class TypeHandler(Protocol):
    object_type: str
    wrapper: type[_TypeWrapper]      # the join is a class, not a parallel string
    def serialize(self, obj, **kw) -> TrackedValue: ...
    def deserialize(self, data, metadata) -> Any: ...   # in the protocol now
    auto_dispatch: ClassVar[Matcher | None]  # only the 6 auto types define one
```

Dispatch: wrapper-first (explicit types), then the ordered
auto-dispatch list (scalar/text/image/audio/video/figure — the only 6
whose `can_handle` is live today; the other 11 dead `can_handle`s are
deleted). The scalar fork, the figure dual-blob special case, and the
plugin special case all leave `run.track()` — `track()` becomes:
unwrap → handler → `TrackedValue` → rows + blob uploads. ~40 lines.

**The bridge**: a generated TYPE MANIFEST artifact (extending the
existing TS → JSON-schema → pydantic conformance chain) carrying per
type: id, label, tier, merge, settings schema, renderer mapping. The
python registry and the TS registry are both conformance-tested against
it — the same drift-gate pattern as the descriptor schema and
`KNOWN_SETTINGS_KEYS`. Extension = add one TS manifest + one python
handler; the conformance test fails until both halves agree.

### 5.3 Vocabulary rules (the naming audit, enacted)

- `object_type` is THE id for the 16 loggable types (17 minus plugin).
  The 4 multi-run card kinds (`parallel/scatter/bar/tile`) are card
  ids with no log-side half — the manifest's `tier` makes the split
  explicit instead of a cast.
- Renderer-id alignment: `Line`/`scalar`/`ScalarPlot` and
  `Boxes`/`boxes3d`/`Boxes3D`/`BoxesVisualCard` style multi-naming is
  resolved by the manifest's explicit `render` mapping; where a rename
  is cheap (cairn-plot component labels) do it, where not, the mapping
  IS the record. `DataSpec.objectType`'s 4-member literal widens to the
  vocabulary. `Octree`/`BVH` become a declared `kind` variant of
  `boxes3d` in the manifest (today the sub-type exists only as a
  wrapper class attr and a UI label).
- **Deleted**: the `/api/workspaces` auto-layout endpoint (dead
  vocabulary, zero UI consumers, maps 10 types to `scalar_plot`) — if
  auto-layout returns, it derives from manifests, server stays
  agnostic.
- The 8 stale DuckDB references (comments/tests) + the
  `test_create_run_writes_to_duckdb` name are scrubbed with the schema
  already at v2.

### 5.4 Multi-run coverage becomes a property, not an accident

Today: scalar overlays; 8 media types have six near-verbatim copies of
the pane-grid branch; 4 types (histogram/tensor/text/artifact) cannot
compare at all. Under the manifest, `merge` is declared per type and
implemented ONCE per strategy in the shared shell — the 4 gaps become
one-word fixes (`merge: "grid"`), and the six copies collapse.

## 6. API changes (the sanctioned breaks, all in one release)

1. `run.config(...)` replaces `run["config"] = …`: accepts a mapping
   and/or kwargs, merges (nested dicts flatten to dotted keys as
   today); `run.config` also readable (returns the flat dict). The
   dead-branch `__setitem__` is removed (one deprecation release with a
   warning shim). Reader's `Run.params` gains a `config` alias; the
   `params` noun remains on wire/storage.
2. `log_artifact`: the `type=`-shadows-builtin bug (a live
   `TypeError` on one branch) is fixed by renaming the parameter to
   `artifact_type`; the duplicated dispatch inside
   `_log_versioned_artifact` is replaced by the one `TypeHandler` v2
   path; versioned artifacts get their `object_type` recorded (today
   NULL, breaking `use_artifact` round-trips).
3. The four `plot_spec/plot_components/plot_elements/_plot_bundle`
   compat shims and `card_spec.py`'s double re-exports are deleted
   (import sites updated in-repo; it's the breaks window).
4. The six drift bugs from the salvage list are fixed AND asserted: the
   client↔server conformance suite (OpenAPI-generated routes + a
   live-server test exercising every client method) lands with them —
   route drift becomes a CI failure, per the ruling "assert in tests".
5. **Downsampling removed** (ruling): the server's LTTB module and the
   `max_points`/`method` params on the sequences endpoint are deleted;
   `step_from`/`step_to` windowing stays (generic row filtering).
6. `RunQuery` predicates move server-side (`/api/runs` grows the
   grammar; the silent 1000-row cap dies). The reserved-name rule
   (`params__limit=…` escape) comes along from the split
   investigation.

## 7. Auth & transport

- **TLS**: `--tls-cert/--tls-key` on the bundled server; docs bless
  `tailscale serve` / `mkcert` / `ssh -L`; self-signed + interstitial
  click-through is documented as sufficient for WebGPU (secure context
  follows transport, not cert validity).
- **Cookie** gets `Secure` when TLS is on.
- **`--no-auth` stays** (debugging) but its CORS `*` is scoped: the
  wildcard only when bound to loopback; any non-loopback bind requires
  the explicit `--allow-origin` list even with auth off.
- **SSH = machine auth only** (cairn-track / CLI): never a UI login
  method. UI/browser auth = sessions/tokens as today.
- **Keys managed through the UI** (GitHub-style): a settings page
  listing authorized public keys (comment, role, fingerprint, added-by,
  last-used), add/revoke; the server persists them (the
  `authorized_keys` file becomes a bootstrap/import source rather than
  the live store). Both provisioning directions: paste a cluster's
  pubkey in the UI, or mint a temporary token for a machine.
- **SSH-minted tokens**: default TTL (30d, `--ttl`), record the minting
  fingerprint, `cairn token revoke --key <fp>`, and per-use
  re-validation that the fingerprint is still authorized.
- Rate limits on the unauthenticated auth endpoints.

## 8. Plugin removal (full extent, from the survey)

Deleted: `sdk/plugins.py` (233), `handlers/plugin.py` (51),
`server/routes/plugin_ws.py` (551), `plugin_webrtc.py` (152),
`PluginCard.tsx` (530), `lib/stream-mode.ts`, the App-chrome stream
control, the `plugins` extra (mss/aiortc), the examples, and the
`"plugin"` entry across the vocabulary (16 types remain). Bonus wins:
the `track()` plugin special case leaves the SDK; the WS auth
carve-out (the only router outside the `require_role` loops, with its
bespoke 4401 close handshake) disappears entirely; the
content-address-defeating hash-header hack in `PluginHandler` goes
with it. Test churn ≈ zero (only one WS-handshake auth test touches
plugins). The extension story is §5's manifest: in-repo, typed,
conformance-gated code — no runtime code injection anywhere.

## 9. Migration plan

R0. **Fix-now bugs** (no design dependencies): the six drift bugs +
    conformance suite; `log_artifact` TypeError; `__setitem__` dead
    branch (+ `run.config` introduction with shim); DuckDB scrub;
    `MEDIA_TYPES`/section fixes (hand-fixed now, derived later);
    delete `/api/workspaces`.
R1. **Auth/transport** (§7): TLS, cookie flag, CORS scoping, SSH TTL/
    fingerprint revocation, keys-in-UI page, rate limits.
R2. **Plugin removal** (§8).
R3. **Log-first ingest** (§4): log format (epoch/seq/header), tail
    senders, ack low-water, idempotency ledger, client-authoritative
    ids + buffered start, unified local mode, `cairn sync` rebuild +
    `--prune`, `CAIRN_WAL_DIR`. Gate: a kill-and-replay harness
    (kill -9 at random points; assert zero loss, zero duplication).
R4. **TypeHandler v2** (§5 python half): `TrackedValue`, multi-blob,
    wrapper-first dispatch, `track()` de-special-cased, versioned-
    artifact object_type fix.
R5. **Card Manifest** (§5 TS half): the registry + generic shell;
    migrate types in waves (scalar + image first — they exercise
    overlay + grid + ViewportModule absorption), derive the tables,
    delete the switch; the generated type-manifest conformance chain.
R6. **Server-side predicates** (§6.5) + the type-agnostic boundary
    lint.
Each stage gates on: typecheck, unit, conformance, harness suite, and
R3 additionally on the kill-replay harness.

## 10. Open questions

1. `run.config(...)`: also allow attribute-style reads
   (`run.config.lr`)? (Proposal: no — dict semantics only.)
2. The 4 multi-run card ids: keep bare (`parallel`) or namespace
   (`card:parallel`) in the shared vocabulary? (Proposal: bare, with
   `tier` disambiguating — the wire already uses bare.)
3. Text inline-vs-blob threshold value (proposal 16 KB) and whether
   markdown/html follow text's rule.
4. Does the unified local mode keep a zero-server in-process READ path
   for `Reader` (today's `_LocalBackend`), or does local reading also
   go through a served endpoint? (Proposal: keep `_LocalBackend` —
   reading is not ingest; the log-first change doesn't require
   touching it.)
5. Keys-in-UI: per-user key ownership once multi-user arrives, or a
   flat server-wide list now? (Proposal: flat now, schema-ready for
   owners.)


## Appendix A — reference manifests (drafted 2026-08-27)

### A.1 scalar (the `overlay` archetype)

```ts
export const scalarCard = defineCard({
  id: "scalar", label: "Scalar", section: "metrics",
  minSize: { w: 3, h: 2 }, tier: "series", merge: "overlay",
  settings: {
    schema: {
      "card.yScale":    { type: "enum",   values: ["linear", "log"], default: "linear" },
      "card.smoothing": { type: "number", min: 0, max: 0.99, step: 0.01, default: 0 },
      "card.xAxis":     { type: "enum",   values: ["step", "wall_time"], default: "step" },
      "series.promoted.<seriesId>": { type: "boolean", dynamic: true },
    },
    quickEdit: ["card.smoothing", "card.yScale"],
  },
  dataPlan: (runs, series) => [
    sequences({ runs, name: series.name, context: series.context }),
  ],
  render: descriptor(({ data, settings }) =>
    cp.line(data.series.map((s) => ({ id: s.runId, label: s.runLabel, points: s.points })),
            { yScale: settings["card.yScale"], smoothing: settings["card.smoothing"] })),
});
```

```python
class ScalarHandler:
    object_type = "scalar"
    wrapper = None
    auto_dispatch = matches(bool, int, float, np.number)
    def serialize(self, obj, **kw) -> TrackedValue:
        return TrackedValue(rows=Row(scalar=float(obj)))
    def deserialize(self, row, metadata):
        return row.scalar
```

Notes: smoothing/yScale are `card.*` (card concerns, prop-driven chart);
promoted series move from component-local useState to persisted dynamic
keys; dataPlan names the GENERIC sequences endpoint (server stays
type-blind).

### A.2 image (the `grid` + ViewportModule archetype)

```ts
export const imageCard = defineCard({
  id: "image", label: "Image", section: "media",
  minSize: { w: 4, h: 4 }, tier: "series", merge: "grid",
  settings: {
    schema: {
      ...cairnPlotSettings("image.*", "compare.*", "panel.*"),  // imported, not redeclared
      "card.step":               { type: "step", default: "latest" },
      "card.pixelValueNotation": { type: "enum", values: ["auto", "raw", "srgb"], default: "auto" },
      "card.paneWidths":         { type: "layout", advanced: true },
      "card.externalBaseline":   { type: "seriesRef", advanced: true },
    },
    quickEdit: ["card.step", "compare.mode", "image.encoding"],
  },
  dataPlan: (runs, series, settings) => [
    artifactsAtStep({ runs, name: series.name, step: settings["card.step"] }),
  ],
  render: { module: imageViewportModule },   // → cp descriptor once Host API M-phases land
});
```

```python
class ImageHandler:
    object_type = "image"
    wrapper = Image
    auto_dispatch = matches(PILImage) | array_image(ndim=(2, 3))
    def serialize(self, obj, *, mode=None, **kw) -> TrackedValue:
        # RULING (2026-08-27): images are logged as EXR, ALWAYS — one
        # encode path, one mime, float end-to-end (the viewer engine is
        # float-native; u8 sources are exact in half precision).
        arr = to_float_array(obj)
        return TrackedValue(rows=Row(blob_ref=0),
                            blobs=[Blob(encode_exr(arr), "image/x-exr")],
                            metadata={"shape": arr.shape, "source_dtype": str(arr.dtype)})
```

Notes: pane-semantics settings come from cairn-plot's namespaced
vocabulary per type (unbundling VisualCompareSettings' image-only fields
from the shared media type); `Row(blob_ref=0)` indexes `blobs` — the
multi-blob shape that lets figure declare `blobs=[png, source]` +
`metadata={"source_ref": 1}` instead of the `_source_blob` smuggle;
mesh/pointcloud/boxes3d/volume become near-copies with their module and
`scene3d.*` keys, finally flowing through the registry. Contrast cases:
histogram = this shape + `merge: "grid"` (comparison support becomes one
word); parallel = `tier: "multi-run"`, `merge: "join"`,
`dataPlan → params(runs)`, NO python half — the object_type/CardType
split made explicit.
