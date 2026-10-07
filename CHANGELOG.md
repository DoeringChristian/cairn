# Changelog

## 0.4.0 — unreleased

### Breaking

- **One local mode: every run writes its own log.** A `cairn.Run` on a local
  repo always appends to `.cairn/wals/<run_id>.wal.jsonl` (plus blobs) and
  never writes the SQLite database. Direct mode and `local_wal=` are removed;
  a run on a repo that a `cairn ui`/`cairn server` serves no longer switches
  to HTTP (the server ingests its log within ~2 s).
- **One writer per repo: the ingest lease** (`.cairn/ingest.lease`, replaces
  `repo.lock`). `cairn ui`/`cairn server` hold it for their lifetime; a
  Reader, CLI command, sweep agent or run that needs an answer takes it
  briefly when no server holds it. Only the holder writes SQLite. A second
  `cairn ui` on a served repo refuses to start and names the running one.
- **New run status `crashed`**: a running local run whose log got no record
  for 5 minutes and no finish. It turns `running` again if records arrive.
  (Runs logged over HTTP still become `killed` after 2 minutes without a
  heartbeat.)
- `log_artifact` on a local repo returns a pending version (number assigned
  at ingestion), as before in WAL mode; `use_artifact`, resume/fork/rewind
  and sweeps now work on local repos without a server.
- `examples/test_wal.py` is removed (covered by the test suite).

### Added

- Artifacts: `add_file` / `add_dir` take wandb's `policy`: `"mutable"`
  (default) copies the files when added, `"immutable"` reads them at log
  time (the old behaviour). `run.log_model(path, name=None, aliases=None)`
  and `run.use_model(ref)` as in wandb.
- `cairn gc [--dry-run]` (and `POST /api/gc`): deletes blobs nothing
  references that are older than 24 h, and their `artifacts` rows; reports
  the count and bytes freed. A server runs it in the background after runs
  are deleted.
- `ArtifactVersion.wait(timeout=None)`: blocks until a pending version is
  registered, then fills in `version`, aliases and the rest.
- `POST /api/ingest/pending`: a lease-holding server ingests pending logs now.
- **Run progress.** `cairn.Run(total_steps=N)` / `run.total_steps = N`
  (progress = highest non-`system.*` step ÷ N) and `run.progress(i,
  total=None)` (explicit, wins over steps). Over HTTP (`POST
  /api/runs/{id}/total-steps`, `/progress`) and as run-log records. Run rows
  carry `progress: {fraction, current, total, unit, eta_seconds}`; the ETA
  is the rate over the last 5 minutes of client wall times.
- The UI shows progress in the runs table's status cell, a line under the
  run page header and a Progress row on comparison run cards: a bar and ETA
  while running, the percentage reached once ended.
- Integrations set the total: Lightning (`estimated_stepping_batches`),
  HuggingFace (`max_steps`), Keras and Ultralytics (epochs, via
  `run.progress`).
- `cairn ping` reports `crashed_runs`.
- **Several processes, one run** (wandb's shared mode). Every process gets
  the same id (`cairn.Run(run_id=...)` or `CAIRN_RUN_ID`; `cairn.new_run_id()`
  makes one); the primary creates the run and workers join it with
  `cairn.Run(..., label="rank1", primary=False)` or
  `cairn.attach(run_id, label)`, also to a finished run. Workers record
  everything into the run but never change its status or liveness; stop
  requests reach every process. `label="auto"` takes the label and role from
  `RANK`, `SLURM_PROCID`, `SKYPILOT_NODE_RANK`, `OMPI_COMM_WORLD_RANK` or
  `PMI_RANK`. A labelled process logs `system.<label>.*` and writes its own
  log, `.cairn/wals/<run_id>~<label>.wal.jsonl`, which waits at the ingester
  until the run exists. Two processes logging a series at the same step:
  the first point stored wins.
- Console lines carry the label of the process that printed it
  (`log_lines.label`); `GET /api/runs/{id}/logs` returns it per line, takes
  `label=` (empty: unlabelled lines) and lists the run's `labels`.
  `Reader` log lines have `label`.
- Distributed-runner examples: `torchrun_ddp.py`, `torchrun_attach.py`,
  `accelerate_ddp.py`, `deepspeed_ddp.py`, `skypilot/` (one node, multinode,
  managed spot job), `modal_app.py`, `sagemaker_job.py`, `azureml_job.yml`
  and `cluster_eval_attach.py`, with a runner table in the server guide.
- Over HTTP, `POST /api/runs` with `primary: false` joins an existing run
  (404 while it does not exist), and a finish or heartbeat with
  `primary: false` changes nothing; creating a run (or a fork) with a taken
  id is a 409.
- **Media in the summary** (wandb's `run.summary["fig"] = wandb.Image(...)`):
  `run.summary`, `cairn.attach(...).summary` and `RunEditor.set_summary`
  take any cairn media wrapper or a gallery list of them, at any depth,
  next to JSON values. Each is one stepless value under its dotted key: a
  later write replaces it, `delete_keys` removes it, `cairn gc` frees the
  replaced bytes. Re-run a showcase script with `cairn.attach` to replace
  its figures without re-training. The catalogue lists it as a series with
  `"summary": true` (one point at step 0), so automatic panels, the add-card
  flow, comparisons and reports show it with its kind's card, without a
  step slider; the Overview's summary tree shows a thumbnail with an "open"
  link; the runs table has no column for it. `Reader` returns `MediaRef`s
  for it (`run.summary`, `run.media(key)`; `SequenceInfo.summary`). A name
  is either a tracked series or a summary media value (`ValueError`).
- A dropped point is no longer silent: a point at a step its series already
  has (the first one written is kept) raises a `warn` run alert naming the
  series and step, once per run and series, and a log warning at ingestion.

### Fixed

- `run.summary` with a non-JSON value said "config values must be JSON"; it
  names the summary now (and mentions cairn media).

- Log read offsets were kept in memory: a server restart re-read active logs
  from the start. They are now stored (`wal_progress`) in the same
  transaction as the ops they cover: exactly once, restart-safe.
- A finished log was drained again in full after being ingested
  incrementally. Each record is now applied once.
- The server and any Reader/CLI process ingested concurrently and raced on
  renaming logs. Only the lease holder ingests now.
- Liveness was guessed from `.lock` files, which a `kill -9`ed writer left
  behind forever. Completion is now the ingested finish record; idle logs
  make the run `crashed`. Old `.lock` files are deleted.
- Logs grew until the run ended and `.done` copies were kept forever. A
  finished log is deleted once ingested; old `.done` files are deleted.
- A writer resuming a log whose last line was torn by a crash no longer
  merges its first record into the torn fragment.

## 0.3.1 — 2026-10-06

### Breaking

- **Workspace views replace saved views.** The run page is always in one of
  the project's views (the current view is stored on the server); edits save
  into it. The project workspace became the view "Default" and saved views
  became views. Switching views clears the undo history.
- **Sweeps use wandb's lifecycle terms.** `cairn sweep stop` takes over the old
  `cancel` (no new trials, running trials finish); `cairn sweep cancel` now also
  ends the running trials (through the run Stop mechanism). Repeating an action
  (pausing a paused sweep) is an error.
- **Sweep commands.** `program:` and `command:` (list or string) with wandb's
  macros (`${env}`, `${interpreter}`, `${program}`, `${args}`,
  `${args_no_hyphens}`, `${args_no_boolean_flags}`, `${args_json}`,
  `${args_json_file}`) and wandb's default command. Params are no longer
  appended automatically: they appear where an args macro is. Unknown keys in
  a sweep file are an error.
- `BlobStore.put(data)` / `get(digest)` take and return bytes only.

### Added

- `run.project`.
- Sweeps: `run_cap`; Python `Sweep.run()` waits while the sweep is paused;
  `Sweep.stop()`; the sweep page shows Pause/Resume, Stop and Cancel.
- Workspace view switcher with layout previews, + New view (copy or empty),
  rename, duplicate, delete.

### Fixed

- Card resize: a grey preview shows the new size; the section resizes on
  release instead of reflowing (and moving the card) during the drag.
- A step slider at the last position follows new steps as they arrive.
- The runs list shows new and deleted runs even when no run is running.
- Media cards: setting Max runs no longer hides the Max runs control.
- Unknown URLs show a not-found page instead of `[object Object]`.
- Blob store: a writer killed right after writing a blob, or a read in that
  moment, no longer leaves the bytes unreadable (`meta.json` is gone; the
  database row describes the bytes).

## 0.3.0 — 2026-10-06

The first tagged release. cairn-track and cairn-ui are released together at
the same version; `cairn-track[ui]` pins the matching cairn-ui commit.

### Breaking

- **cairn-plot is gone**: no `cairn.plot`, no `[plot]` extra, no
  `vendor/cairn-plot` submodule. The viewer draws with uPlot, Plotly and three.js.
- **Artifacts v2**: one versioned artifact model (entries, versions, aliases,
  tags, lineage, `download()` to a directory); data from the old artifact
  tables is not read.
- **Config is nested** (`run.config` is a nested dict) and `summary` is a
  separate channel; metric rules live on `run.track(summary=, x=)`
  (`define_metric` is gone).
- **No contexts**: a sequence is `(run, name)`; use name prefixes.
- **Comparisons are workspaces**: a comparison copies the project workspace
  layout; old comparison tables are dropped.
- **Images map by dtype**: float `[0, 1]`, uint8 `[0, 255]`, clipped; PNG by
  default (`encoding=` for EXR/npy); sRGB conversion only with `linear=True`.
- **Tokens are per server** (`cairn login URL`, `cairn logout`, `[tokens]` table).
- **CLI reshaped**: every data command takes `--repo` / `--server` and works
  on local repos; `cairn artifact …` and `cairn report …` groups.
- **Viewer manifests**: the setting tab `data` is now `values`.
- `Run.url` is the URL `cairn open` prints (the UI), also for local repos.
- Back-compat paths removed throughout the SDK (`log_artifact(type=)`,
  `wal.checkpoint()`, bare-int checkpoints, `value_range`, `run[key] = value`).

### Added

- **Custom data and viewers**: `cairn.Data(payload, kind=…)`;
  browser-only viewers in a sandboxed iframe (`cairn:sdk`, vendored imports),
  `cairn viewer init | add | dev | publish | ls`, `Run.use_viewer`,
  one default viewer per kind, built-in `cairn.volume` ray marcher.
- **Galleries for every media kind** (a list of media is one gallery point).
- **Artifacts**: directory and multi-file artifacts, external references,
  explorer and draggable lineage graph, whole versions download as a zip.
- **Run selection** shared with the UI (`RunQuery.where(expr)`, `Run.eval`),
  `Run.final`, `reader.run(id).edit()`, bulk history.
- **Runs**: resume, fork and rewind; stop from the UI; alerts with webhooks;
  git remote and working-tree diff; disabled mode.
- **Sweeps**: server API, `cairn sweep` / `cairn agent`, `cairn.sweep`.
- **Integrations**: Lightning, Keras, XGBoost, Hugging Face; `run.watch` for
  torch gradients/parameters; `cairn import-tb`.
- **CLI**: archive/unarchive, `export-runs` / `import-runs` (run archives),
  `cairn diff`, `configure --repo`, reports by id and across projects.
- Reports with share links (scoped, default-deny), comments and assets.

### Web UI

- **Workspaces**: the run page is the project workspace; sections, drag & drop,
  include unlisted metrics, saved layouts.
- **One card editor**: add a card from a section's ghost card
  (Data → Type with live previews → the editor); tabs
  `Data | Type | Values | Display | Expr`, title in the header.
- **Unified card header** on every card: screenshot (what you see),
  download, add to report, reset view, settings, duplicate, close.
- Images and videos: no flicker on stepping, prefetch and caching, split
  compare against a reference, zoom that survives resizes, video loop.
- Plotly figures on WebGL with a page-wide WebGL budget; 3D figures rotate
  and sync.
- Markdown is GFM + Pandoc with inline math everywhere.
- Runs table: resizable columns, grouping that follows the sort.
- Logged HTML is served as its own sandboxed document.

### Performance and reliability

- `metric_stats` summary index maintained at ingest: the runs list and
  workspaces load without scanning series.
- Batched, column-wise `/series` reads; gzipped JSON; the UI bundle is served
  gzipped and immutable (5.9 MB → 0.4 MB on the wire).
- Reads on a pool of read-only connections; bounded ingest transactions off
  the event loop; the SDK backs off to the local WAL and `finish()` is bounded.
- Concurrent processes opening a fresh repo no longer race on the WAL switch.
- Panels mount as they come near the screen.

### Security

- Custom viewers and logged HTML run in opaque-origin sandboxed frames;
  the app's shells set `frame-src 'self' blob:`; artifact blobs are served
  with `nosniff` and `Content-Security-Policy: sandbox`.

### Docs

- New documentation site (MkDocs Material, GitHub Pages): getting started,
  guides, web UI guide, Python/CLI references, custom viewers guide.

### Known issues

- Reset view does not reset the step slider or hidden series.
- A custom viewer's `setHeight()` has no effect.
- Downloading an empty card yields a CSV with headers only.
- With a custom viewer as a kind's default, a single card cannot switch back
  to the built-in renderer.
- The local write-ahead log grows until the run finishes.
- Very heavy parallel series reads are served one at a time.
- `npm audit` reports 9 advisories in build-time dependencies that need
  major upgrades (tailwindcss 4, vite 8, react-router 7).
