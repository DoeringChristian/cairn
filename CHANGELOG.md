# Changelog

## 0.5.0 — unreleased

### Added

- **Run versions.** Runs that share a project, group and name form a series;
  the server numbers each named run in it when it creates the run (`version`
  1, 2, ...). Numbers are never reused, also after a run is deleted. A rename
  or group change takes the next number of the new series; resume and
  processes joining a run keep it; a fork takes the next one; an unnamed run
  has none. Existing repos are numbered per series by creation time on first
  open, and imported runs take the next number of their series.
  `run.version` (on a local repo it catches up on the logs first),
  `Reader` `Run.version`, a `version` field on every API run row, a `VERSION`
  column and `--sort version` in `cairn list`, and `group` on
  `PATCH /api/runs/{id}`.
- **Run-to-run lineage.** `run.use_run(run_or_id, role=None)` and
  `cairn.Run(..., uses=[...])` record that a run used another run without an
  artifact between them (`run_links` table; local logs and
  `POST/GET /api/runs/{id}/uses`). Lineage graphs show it as a `used` edge;
  the Reader has `Run.uses()` / `Run.used_by()`.
- **Group graph.** `GET /api/projects/{id}/groups/{group}/graph`: a group's
  non-archived runs and the edges among them (through artifacts or direct
  links); `GET /api/projects/{id}/groups` lists groups by last activity.
- **Project workspace** (UI, replaces the Compare page): a runs sidebar
  (the runs table with its toolbar, the Name column and eyes per group and
  run) next to the current view's cards; grouped, line charts draw one
  mean line with a min–max band per group. The run state is saved in the
  current view. The runs table's **Compare** becomes **Show in workspace**.
- **Filter to a group** (UI): clicking a run group's name in the workspace
  sidebar adds `group = <name>` to the workspace's filter (a removable
  chip); the group's name in the runs table, the run page header and the
  lineage panel opens the workspace filtered that way. The workspace
  sidebar gains a show/hide-all eye, a sort
  control, pinned runs listed first, and a hover highlight between rows
  and chart lines; **Show in workspace** shows exactly the selected runs.
- UI: a muted `v2` after the run's name in the run header and the runs table
  (not grouped, a grouped run reads `exp-44 · train v2`);
  runs that share a name are labelled `train v1`, `train v2` in charts and
  legends (grouped runs read `exp-1 · train v1` when the runs shown span
  groups) instead of their start times.

### Changed

- **A group is a namespace: a run's series is (group, name).** `train` in
  `exp-43` and in `exp-44` are two series everywhere a run is matched by
  name: the runs table's and the workspace's **Latest only** (and its
  highlight; the higher version wins, else the later start), **Archive
  old** / **Delete old**, the `newest-per-name` run selector of reports and
  share links (UI and server), the query URL's `run=newest-per-name`, and
  run labels (two series never collide on their name).

### Removed

- Saved comparisons: the Compare page, the comparison kind of
  `project_docs` and its `/api/projects/{id}/comparisons` routes (existing
  comparisons are dropped on first open).

## 0.4.0 — 2026-10-07

### Breaking

- **One local mode: every run writes its own log.** A `cairn.Run` on a local
  repo always appends to `.cairn/wals/<run_id>.wal.jsonl` (plus blobs) and
  never writes the SQLite database. Direct mode and `local_wal=` are removed.
  A run on a repo that a `cairn ui`/`cairn server` serves writes its log too;
  the server ingests it within ~2 s.
- **One writer per repo: the ingest lease** (`.cairn/ingest.lease`, replaces
  `repo.lock`). `cairn ui`/`cairn server` hold it for their lifetime; a
  Reader, CLI command, sweep agent or run that needs an answer now takes it
  briefly when no server holds it. Only the holder writes SQLite. A second
  `cairn ui` on a served repo refuses to start and names the running one.
- **New run status `crashed`**: a running local run whose log got no record
  for 5 minutes and no finish (back to `running` if records arrive). Runs
  logged over HTTP still become `killed` after 2 minutes without a heartbeat.
- `log_artifact` on a local repo returns a pending version (its number is
  assigned at ingestion; `.wait()` returns it).
- The `hf` extra is now `huggingface` (transformers only).
- Artifact `add_file` / `add_dir` copy the files when added (wandb's default
  `policy="mutable"`); `policy="immutable"` keeps the old read-at-log-time
  behaviour.
- A step slider that was never moved starts at the newest step and follows
  new ones (it used to start at the first).
- `examples/test_wal.py` is removed.

### Added

- **Several processes, one run** (wandb's shared mode): a shared id
  (`run_id=` or `CAIRN_RUN_ID`, `cairn.new_run_id()`), `label=`,
  `primary=False`, `cairn.attach(run_id, label)` (also to a finished run) and
  `label="auto"` from `RANK` / `SLURM_PROCID` / `SKYPILOT_NODE_RANK` /
  `OMPI_COMM_WORLD_RANK` / `PMI_RANK`. Workers never change the run's status;
  labelled processes log `system.<label>.*` and their own log file. The Logs
  tab gets a process filter and a label column (search matches labels).
- **Media in the summary** (wandb's `run.summary["fig"] = wandb.Image(...)`):
  any cairn media or gallery, at any depth; a later write replaces it, so a
  showcase script re-run with `cairn.attach` replaces its figures without
  re-training. Summary media are cards like logged series (automatic panels,
  the add-card flow, comparisons, reports; no step slider, "summary" in the
  header). The Overview lists them by kind with a link that jumps to their
  card. A name is either a tracked series or a summary media value.
- **Run progress**: `cairn.Run(total_steps=N)` / `run.total_steps` (steps done
  = highest logged step + 1) and `run.progress(i, total=None)`; an ETA from
  the last 5 minutes. Shown in the runs table, the run header and comparison
  cards. Lightning, HuggingFace, Keras and Ultralytics set the total.
- **Integrations**: Lightning `CairnLogger(log_model=True|"all")` and
  `logger.watch(...)`; HuggingFace `CairnCallback(log_model="end"|"checkpoint")`
  (the final model in both modes, as wandb); Keras `CairnModelCheckpoint`;
  a new Ultralytics (YOLOv8+) integration `add_cairn_callbacks(model)`.
  Checkpoints are versions of `model-<run id>` with `latest` / `best`.
- `run.log_model(path, name=None, aliases=None)` and `run.use_model(ref)`.
- `cairn gc [--dry-run]`: deletes unreferenced blobs older than 24 h; a server
  runs it after deleting runs. `ArtifactVersion.wait()`.
- A dropped point (a second point at a step its series already has) raises a
  `warn` run alert naming the series and step.
- `CAIRN_CACHE_DIR` moves cairn's per-user caches.
- 2D Plotly figures sync live across a card's panes while panning or
  wheel-zooming (box zoom on release), like 3D cameras.
- Long config and JSON values fold to one line of their column with **more**;
  the comparison's parameter table no longer grows sideways.
- Distributed-runner examples: torchrun (shared id and `cairn.attach`),
  accelerate, DeepSpeed, SkyPilot (one node, multinode, managed spot), Modal,
  SageMaker, AzureML, a later evaluation attaching to a finished run; a runner
  table in the server guide.
- `cairn ping` reports `crashed_runs`; `POST /api/ingest/pending`.

### Fixed

- Log ingestion: read offsets are stored with the ops they cover (exactly
  once, restart-safe; no full re-drain of finished logs); only the lease
  holder ingests (no concurrent ingesters); completion is the ingested finish
  record, not a `.lock` file a killed writer left behind; finished logs and
  old `.done` / `.lock` files are deleted; a log with a torn last line is
  resumed cleanly.
- The sticky key column of the comparison tables is opaque: values no longer
  scroll visibly under the keys.
- `run.summary` with a non-JSON value no longer says "config values".
- Resuming or forking a missing run is `LookupError` over HTTP too (was a raw
  404).
- Tests no longer open browser tabs or write into the user's cairn cache.

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
