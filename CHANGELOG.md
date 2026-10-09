# Changelog

## 0.5.0 — unreleased

Run management as in wandb: runs organised by name, group and job type, a
project workspace in place of the Compare page, wandb's run page, report
blocks with several live run sets, parallel coordinates and parameter
importance, and notebook embeds.

### Breaking

- **Saved comparisons are dropped** when a repo is first opened: the Compare
  page, the comparison kind of `project_docs` and the
  `/api/projects/{id}/comparisons` routes are gone. The project workspace
  replaces them, and the runs table's **Compare** is now **Show in
  workspace**.
- **Report cells from before run sets are not read.** A ```` ```cairn ````
  fence with `runs:` (fixed `ids`, or the dynamic `selector` with `latest-n` /
  `newest-per-name`) shows empty with a notice and is kept as written until
  the cell is edited; there is no migration. Give the cell a run set.
- **Run versions are numbered per (group, job_type, name).** Existing repos
  are renumbered once per series, in creation order, on first open.
- **A metric's summary rule is the project's**, not each run's own: the
  newest run that logged one, or a project override, decides every run's
  value. `run.stats[...].rule` is gone from the API, and the runs table's
  per-column **Better** setting and a computed column's better direction are
  dropped (with their stored state).
- **Run page URLs**: the bare `/p/<project>/r/<run>` is the Workspace tab,
  Overview moved to `…/overview`, and `…/workspace` is gone.
- `cairn.sweep(goal=None)` is the new default: a sweep without a goal takes
  the metric's goal in the project (see Changed).

### Added

- **Run versions** (deduplication when a run's identity collides). Runs that
  share a project, group, job type and name form a series; a missing group or
  job type is part of the key. The server numbers each named run in its
  series when it creates it (`version` 1, 2, ...), so a re-run is v2 while
  runs with distinct names (fine-tune siblings, seeds) are each v1. Numbers
  are never reused, also after a run is deleted. A rename, group or job type
  change takes the next number of the new series; resume and processes
  joining a run keep it; a fork takes the next one; an unnamed run has none;
  imported runs take the next number of their series. `run.version` (on a
  local repo it catches up on the logs first), `Reader` `Run.version`, a
  `version` field on every API run row, `VERSION`, `GROUP` and `JOB_TYPE`
  columns and `--sort version` in `cairn list`, and `group` / `job_type` on
  `PATCH /api/runs/{id}`. The UI shows a muted `v2` after a run's name and
  labels runs of one series `train v1`, `train v2` (grouped runs
  `exp-44 · train v1` when the runs span groups; a name used under several
  job types adds the job type, `finetune · ft`).
- **Project workspace** (`/p/<project>/workspace`): a runs sidebar that is
  the runs table (status, search, filter, group, **Latest only**, sort; eyes
  per run and group, a show/hide-all eye, pinned runs first, hover linking
  rows and chart lines) next to the current workspace view's cards. The run
  state is saved in the view. By default the 10 newest groups (or runs) are
  visible. **Show in workspace** in the runs table shows exactly the selected
  runs.
- **Nested grouping as wandb**: group rows read `Field: value`
  (`Group: exp-44`, `Job Type: train`); an outer group shows a hollow circle
  with its sub-group and run counts, an innermost group the filled dot of its
  chart line. In the workspace, line charts draw one mean line with a min–max
  band per innermost group, labelled `group: exp-44, jobType: train`. A line
  card's **Group runs** setting is **Workspace** (the default), **Off** or
  **By key**. The runs table gains **Group** and **Job Type** columns, shown
  when a listed run has one.
- **Filter to a group**: clicking a group's name in the workspace sidebar adds
  `group = <name>` to the workspace's filter (a removable chip); the group's
  name in the runs table, the run page header and the lineage panel opens the
  workspace filtered that way.
- **Summary section**: the workspace and the run page start with two
  automatic cards, the new `scalars` and `config` types. **Scalars** is one
  table of every scalar logged at a single step, the runs' `summary` values
  and run info (status, duration, created, user, host), sortable; **Config**
  lists config keys, tags and notes per run with **only diffs**. Grouped, both
  show one row / column per group (a mean, or `mixed`).
- **Metric rules per project.** Per project and metric, a `summary`
  (`min | max | mean | last`) and a `goal` (`lower | higher | none`) override
  what `run.track(..., summary=)` logged (`GET /api/projects/{p}/metric-rules`,
  `PUT` / `DELETE .../metric-rules/{metric}` with the write role;
  `Reader.metric_rules(project)`). One resolver, in Python and the UI with
  shared test vectors, gives the effective rule: the override, else the newest
  run's logged rule; the goal from the override, else from the summary's
  direction. The runs table, Summary cards, `Run.final`, `metrics.<name>`
  sorting, baseline deltas, the run comparer, the scatter card's Pareto
  default and a sweep's default goal all read it. There is no separate
  `define_metric`.
- **Metric column menu**: a metric column's ▾ on the runs table and the
  Scalars card sorts, sets the project's **Summary** and **Goal**, shows the
  logged rule, **Reset to logged** and **Hide column**. The Scalars card
  colours each goal metric's best row green and worst red; the Config card
  tints the rows that differ.
- **Parallel coordinates card** (`parallel`, as wandb): axes default to the
  config keys that vary across the runs, then a metric (its final value under
  the project's rule); add, remove and reorder axes, log scale per axis,
  categorical axes. Lines coloured by the last axis or by run/group colours;
  drag along an axis to brush (not saved); hover a line for its values and its
  sidebar row. Grouped: one line per innermost group. The sweep page uses it.
- **Parameter importance card** (`importance`, as wandb):
  `Parameter importance for [metric ▾]`, one row per varying config key with
  its importance (a seeded 100-tree random forest, impurity-based, summing
  to 1) and correlation (Pearson r, green towards the metric's goal, red
  away); sortable by either; needs 5 runs with the metric.
- **Report cells with several run sets** (wandb's panel grids). A cards cell
  holds `runSets`: 1..n frozen copies of the workspace's runs table state
  (filter, group-by, Latest only, sort, eyes) whose runs are resolved live;
  the cards draw the union, each set in its own colour family. The server
  resolves them with a Python port of the runs table's model (shared test
  vectors), so a share link's scope is exactly the runs its cells show. The
  cell's run view is `view: {hidden, pinned, baseline}`.
- **Report run set editor**: a cell's **Runs** dialog lists its sets (colour
  dot, name, live run count, **Edit**, **✕**), **+ Add run set** and
  **⤓ Insert from workspace** (copies the workspace view's filter, grouping,
  Latest only, sort and eyes; in a cell without cards also its cards).
  **Edit** is the set's name and the workspace's runs sidebar scoped to the
  set.
- **Run-to-run lineage.** `run.use_run(run_or_id, role=None)` and
  `cairn.Run(..., uses=[...])` record that a run used another run without an
  artifact between them (`POST/GET /api/runs/{id}/uses`). Lineage graphs show
  it as a `used` edge; the Reader has `Run.uses()` / `Run.used_by()`; run
  archives carry the links (remapped on import).
- **Run page Overview: Inputs / Used by.** The Run block lists
  `Inputs ← pretrain v2 · data-exp-44:v1 · other-proj/model:v3 (other project)`
  (the runs it used, its fork parent, the producers of the artifacts it used,
  then those versions) and `Used by → eval-ft v1 · diff v1`, each a link;
  another project's artifacts are marked; long lists collapse to **+N more**.
  New `GET /api/runs/{id}/relations`.
- **Notebook embeds** (Jupyter and marimo): a `cairn.Run` or a `Reader` run as
  the last expression of a cell shows its run page inline (Workspace tab,
  live, 720 px); `run.display(tab=, height=)` picks the tab and height;
  `cairn.ui.workspace(project, filter=None, height=)` shows the project
  workspace (the filter, an expression or a filter tree, applies to the embed
  only) and `cairn.ui.report(project, report_id, height=)` a report,
  read-only. They are the viewer's `/embed/run/<id>?tab=`,
  `/embed/workspace/<project>?filter=` and `/embed/report/<project>/<id>`
  pages, read-gated like the app; without a reachable viewer the output says
  how to start one. Example: `examples/notebook_embeds.py` (marimo).

### Changed

- **job_type is first-class (wandb)**: the run's role. The run page shows it
  next to the group; the runs table and the workspace group by group, then
  job type; in lineage graphs runs are siblings only within one job type
  (`12 finetune runs`).
- **Latest only, Archive old / Delete old, the newest-run highlight and run
  labels match runs by series** (group, job type, name): `train` in two groups
  or under two job types is two series. Latest only prefers the higher
  version, else the later start. The query URL's `run=newest-per-name` is per
  series too.
- **Run page as wandb's.** Tabs: **Workspace** (the default; the project's
  current view without `system.*` series, hiding cards and sections with no
  data for the run), **Overview** (one **Run** block with notes, tags, state
  and exit code, group, job type, version, times, author, host, OS / Python,
  git with `(dirty)` and a diff download, command and run path; searchable
  **Config** and **Summary** tables; **Artifacts** as Outputs / Inputs),
  **System** (the same view over `system.*`), Logs, **Files** (Source and
  Environment merged), Artifacts. A run opened from the workspace sidebar has
  a **← Workspace** link back to the workspace as it was left.
- **A scalar logged at a single step gets no automatic card**: it is a column
  of the Summary section's Scalars card. A card for it can still be added.
- **A sweep without a `goal`** takes the metric's goal in the project (higher
  is better: maximize), else minimize.
- The run comparer colours only metrics with a goal; baseline deltas follow
  the metric's goal in the project.

### Removed

- Saved comparisons and the Compare page (see Breaking).
- The report-only dynamic run selector (`runs.selector` with `latest-n` /
  `newest-per-name`, the auto badge, the static/auto toggle) and fixed
  `runs.ids` cells; `examples/demo_run_selector.py`. The query URL's `run=`
  selection is unchanged.
- The runs table's per-column **Better** setting and a computed column's
  better direction.
- The run page's **Metrics & Media**, **Source** and **Environment** tabs
  (now Workspace and Files).

### Fixed

- Editing one automatic card (a setting, its title, type, a duplicate) wrote
  every automatic card before it, and every section, into the view. Now only
  that card is written; the cards around it keep their place.
- A grid sweep (or one with a `run_cap`) stayed **running** after all its
  trials ended when no worker asked for another trial (`sweep.run(fn,
  count=len(grid))`). The last trial to end now finishes it.

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
