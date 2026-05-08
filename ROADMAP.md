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
