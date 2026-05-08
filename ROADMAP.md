# Cairn Roadmap

Long-term plans, ideas, and known issues. Not exhaustive — current
session-level plans live in `~/.claude/plans/`.

## Status legend

- 💭 **Idea** — discussed, not yet planned
- 📋 **Planned** — design agreed, not started
- 🚧 **In progress**
- ✅ **Done** (kept here briefly to mark recent direction; remove once stable)

---

## Current direction

### Storage / concurrency

- ✅ **Per-run WAL architecture** — writers append to `.cairn/wals/{run_id}.wal.jsonl`,
  UI server is sole DB writer, ingestion runs every 2s. NFS-safe for Slurm/Ray clusters.
  Behind `local_wal=True` flag (default off — direct DB for single-machine speed).

- ✅ **Git-style 128-bit run IDs** — client-generated `token_hex(16)`,
  collision-proof. UI shows 6-char prefix with click-to-copy.

- ✅ **Unified `repo=` URL scheme** — `cairn.Run(repo="cairn://host:port")` for
  HTTP server mode. `server=` removed (clean break).

- ✅ **Reader auto-deserialization** — `run.artifact("name")` returns the
  original Python type via handler `deserialize()` methods.
  `artifact_bytes()` is the raw-bytes escape hatch.

- ✅ **Reader can read exported ZIPs** — `cairn.Reader(repo="run.zip")`
  unpacks an exported archive into a tempdir and serves it via the
  local backend. Cleaned up on `close()`.

- 💭 **Per-run baseline branching** — when a run is "forked" from a checkpoint,
  track the lineage so the UI can show parent/child relationships.

- 💭 **WAL compaction** — large runs accumulate huge WAL files. After ingestion,
  the `.done` files are kept until manual GC. Add `cairn gc` CLI.

### Examples / integrations

- ✅ Multi-process, multi-thread, multiprocessing.Pool, Fabric, submitit/Slurm,
  Ray Tune, Dask SSHCluster, Kubernetes Jobs

- 💭 **PyTorch Lightning callback** — `CairnLogger(repo="...")` matching the
  existing `WandbLogger` API.

- 💭 **HuggingFace Trainer** — already in `cairn-track[hf]` extras but
  needs example + tests after WAL changes.

- 💭 **Hydra multi-run** — small example showing `--multirun` with joblib launcher.

### UI

- ✅ Card download buttons (artifacts) + chart export (SVG/PNG/JPG composite)
- ✅ Image comparison with per-run/global ref, split/blend modes, quick diff
- ✅ Shift-select in runs table and comparison sidebar
- ✅ x-axis switching (step / time / wall) on all step-based cards

- 💭 **Run lineage view** — parent/child runs, source diff between runs,
  "what changed?" panel.

- 💭 **Custom dashboards** — save a layout of cards as a named dashboard
  attached to a project (not a run). Useful for recurring sweeps.

- 💭 **Bulk export to CSV/Parquet** — export selected runs' scalars as
  a flat table for analysis in pandas/polars.

- 💭 **Better empty states** — when there are no runs / no metrics, show
  copy-pastable code snippets to get started.

### SDK

- 💭 **`cairn.Run` async context manager** — `async with cairn.Run(...)` for
  asyncio training loops.

- 💭 **Custom handler registration via entry points** — third-party packages
  can register handlers without monkey-patching.

- 💭 **Resume runs** — `cairn.Run(resume="run_id")` re-opens an existing run
  to add more data (not currently supported).

### Decouple data types from view types (major refactor)

Currently `cairn.Image`, `cairn.Tensor`, etc. conflate two concerns: how
data is stored AND how it is rendered in the UI. A 2D tensor logged as
`cairn.Tensor` can only ever render as the tensor stats card. We want
data and views to be independent.

**Goal:** the user logs data with a storage type and tags. The UI offers
multiple compatible cards (heatmap, histogram, raw stats, image-of-tensor)
and the user picks the view per-card-instance. Custom card types can be
registered.

#### API ideas

- 💭 **Storage type vs view type**
  ```python
  run.track(arr, name="weights", type="tensor")     # data + storage tag
  # UI: any card whose `accepts(meta)` returns True can render this
  ```

- 💭 **Multi-view per data type**
  A 2D tensor could render as: stats card, histogram, heatmap, image,
  3D surface. Each card declares its data compatibility predicate.

- 💭 **Card registration with predicate**
  ```python
  @register_card_type({
      "id": "heatmap",
      "name": "Heatmap",
      "accepts": lambda meta: meta["object_type"] == "tensor"
                              and len(meta.get("shape", [])) == 2,
  })
  ```

- 💭 **Tags as orthogonal dimension**
  ```python
  run.track(grad, name="grad.layer0", type="tensor",
            tags=["gradient", "layer0", "training"])
  ```
  Cards can filter by tags — e.g., a "Gradient flow" card aggregates
  everything tagged "gradient" across layers.

- 💭 **User picks view from dropdown**
  When a card is added, the user picks the view from the list of
  compatible cards. Defaults to the most specific match.

- 💭 **Composite / inspector cards**
  An "Inspector" card that internally composes other cards: e.g., shows
  a tensor as image + histogram + stats simultaneously.

- 💭 **Multi-output single track call**
  ```python
  run.track(arr, name="preds", views=["raw_tensor", "argmax_image", "topk_text"])
  ```
  One `track()` call writes multiple derived blobs, UI shows all.
  Trade-off: storage vs compute (derivation could also be lazy).

- 💭 **Server-side derived views**
  Store raw data once. Server generates derived representations
  (histogram of tensor, image of 2D matrix, etc.) on-demand or on
  ingestion. Saves storage; expensive views computed lazily and cached.

- 💭 **View presets**
  Save a card configuration (zoom, colormap, baseline) as a named
  preset that can be applied to any compatible data.

- 💭 **Custom type ↔ card matrix**

  | Data type   | Default view  | Alternative views                  |
  |-------------|---------------|------------------------------------|
  | `tensor`    | stats         | histogram, image (2D), heatmap, 3D |
  | `image`     | image         | pixel histogram, stats             |
  | `audio`     | player        | spectrogram, waveform              |
  | `video`     | player        | frame strip, motion plot           |
  | `histogram` | bar chart     | line, kde estimate                 |

- 💭 **Plugin discovery via entry points**
  Third-party packages can register both data handlers AND card types
  via `cairn.cards` and `cairn.handlers` entry points. UI fetches the
  list of registered cards from the server at startup.

- 💭 **Schema versioning per type**
  Card declares a min/max compatible schema version for a data type.
  Lets data types evolve without breaking existing card code.

### Server / deployment

- 💭 **Auth** — currently v1 explicitly skipped this. Eventually need
  basic auth or token-based access for shared servers.

- 💭 **TLS / reverse proxy guide** — docs on running behind nginx/Caddy.

- 💭 **Multi-project namespaces** — separate ACLs per project (depends on auth).

- 💭 **Cloud blob backends** — S3/GCS for artifacts (current is local FS only).

### Performance

- 💭 **Sequence ingestion benchmarks** — measure points/sec for various
  scenarios (local, WAL, HTTP, NFS) and document expected throughput.

- 💭 **DuckDB vs SQLite revisit** — we migrated SQLite for cluster safety,
  but DuckDB is faster for analytical queries on large sequence tables.
  Could use both: SQLite for the index, DuckDB read-only for analytics.

- 💭 **Plot card downsampling** — current LTTB at fetch time works but
  could be more aggressive for very long runs (>1M points).

---

## Known issues / quirks

- Multi-thread `cairn.Run` calls in the same process must be sequential
  (single-active-run guard for stdout capture). Documented in examples.

- Source capture thread can take up to 120s on large repos; finish() blocks
  until it completes (was 5s, caused "closed database" errors).

- Live preview in WAL mode has ~2s latency (ingestion poll interval).
  Configurable but no UI hook yet.

- Plotly figures stored as PNG + Plotly JSON source; UI uses PNG, but the
  Reader's `artifact()` returns PNG. Need a `figure_source()` accessor
  for the editable Plotly JSON.

---

## Far-future ideas

- **Distributed search index** — federated reader across multiple repos
  (e.g., team-wide "find runs where loss < X" without consolidating data).

- **Diff-aware artifact storage** — for large checkpoints that change
  slightly between runs, store deltas instead of full copies.

- **Run derivation graph** — explicit edges between runs (resumed, forked,
  finetuned, evaluated). Visualize in the UI.

- **Notebook integration** — `from cairn import nb` exposing inline
  scalars/plots in Jupyter without leaving the notebook.

- **Cairn CLI for analysis** — `cairn diff run_a run_b`, `cairn best
  --project foo --metric loss`, etc.
