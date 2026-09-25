# Cairn Roadmap

Open ideas and known issues. Anything already built is documented in
[`docs/`](docs/index.md), not here.

## Current status

Cairn tracks runs locally (`./.cairn`, SQLite), through per-run WAL files for
many concurrent writers on shared storage, or over HTTP to `cairn server`
(token auth with read/write/admin roles, on by default). Built so far:

- **Logging**: scalars with `summary=`/`x=` metric rules, config and summary,
  images (boxes, masks, galleries, colormaps, EXR/npy encodings), figures,
  audio, video, histograms, tensors, tables with media cells, text, HTML,
  Markdown, point clouds, meshes, box hierarchies, volumes (download only),
  confusion matrices and PR/ROC curves; components that log themselves through
  `__cairn_track__` and `cairn.Scope`.
- **Run lifecycle**: resume, rewind, fork with lineage, group/job type, tags and
  notes, stop from the UI, alerts with webhooks, model watching, git, source,
  environment, stdout and system-metric capture, disabled mode.
- **Artifacts**: a versioned registry with aliases, directory and
  external-reference artifacts, `use_artifact` lineage.
- **Sweeps**: grid, random and Bayesian (Optuna), from YAML with `cairn agent`
  or in process with `cairn.sweep`.
- **Reading**: `cairn.Reader` with Django-style filters, expression filters,
  histories as DataFrames and post-hoc edits; exported ZIPs; live query URLs.
- **Integrations**: Hugging Face, Lightning, Keras, XGBoost; TensorBoard import;
  JSON/CSV/Parquet export.
- **Web UI** (cairn-ui): runs table with filter trees, multi-sort, computed and
  frozen columns, nested group-by and baseline deltas; synced workspaces, saved
  views and a defaults cascade; comparisons and templates; a lineage page;
  reports with notebook cells, math, comments, PDF/LaTeX export and share links.
- **Notebooks**: `cairn.plot` (cairn-plot) reports and `cairn.ui` card embeds.

## Ideas

### Storage / concurrency

- **WAL compaction** — ingested WAL files are renamed to `.done` and kept until
  deleted by hand. Add a `cairn gc` command.
- **Cloud blob backends** — artifacts live on the server's filesystem only;
  S3/GCS backends would let the database and the blobs scale separately.
- **DuckDB for analytics** — SQLite stays the index; a read-only DuckDB view
  could speed up analytical queries over large sequence tables.

### SDK

- **`async with cairn.Run(...)`** for asyncio training loops.
- **Handler registration via entry points** — third-party packages register
  handlers (and, eventually, card types) without importing cairn first.
- **Figure source accessor** — the Reader returns a logged figure as its PNG;
  the stored Plotly JSON source has no accessor.
- **Hydra multirun example** — `--multirun` with the joblib launcher.

### Data types vs views

`cairn.Tensor`, `cairn.Image` and friends fix both how data is stored and which
card shows it. Separating the two would let one logged value offer several
compatible views (a 2-D tensor as stats, histogram, heatmap, image or surface):

- cards declare an `accepts(meta)` predicate; the user picks a view per card;
- composite "inspector" cards that show one value several ways at once;
- optional derived representations computed server-side on demand and cached;
- a schema version per data type so cards can declare what they understand.

### UI

- **Server-side downsampling of scalar series** — a series is fetched with
  every point, which gets slow for runs with millions of points.
- **Configurable WAL ingestion latency** — live preview of WAL-mode runs lags
  by the ingestion poll interval (about 2 s), with no setting in the UI.

### Server / deployment

- **Per-project access control** — token roles apply to the whole server.
- **TLS / reverse-proxy recipe** — running `cairn server --ui` behind nginx
  or Caddy for a shared team server.

### Performance

- **Ingestion benchmarks** — measured points per second for local, WAL, HTTP
  and NFS setups, documented as expected throughput.

## Known issues / quirks

- Only one `cairn.Run` can be active per process at a time (stdout capture
  guards against nested runs), so threads in one process must run their runs
  one after another.
- `finish()` waits up to two minutes for the source snapshot upload on large
  repositories.
- `Run.add_note` replaces the run's notes rather than appending to them.

## Far-future ideas

- **Federated search** across several repos ("runs where loss < X" team-wide
  without consolidating data).
- **Delta storage for checkpoints** that change little between versions.
- **`cairn best --project P --metric loss`** and other analysis commands.
