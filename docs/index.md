# cairn

cairn is an open-source, local-first ML experiment tracker. You log metrics, media, configs and
artifacts from Python, then browse, compare and report on them in a web UI. There is no account
and no required server: by default a run writes straight into a `./.cairn/` directory next to
your code.

```python
import cairn

run = cairn.Run("image-classification", name="baseline")
run.config(lr=3e-4, batch_size=32)

for step in range(100):
    loss = train_step()
    run.track(loss, "train.loss", step, summary="min")

run.finish()
```

```bash
cairn ui      # opens the viewer on http://localhost:4301
```

## Highlights

- **Local-first.** A repo is a directory with a SQLite database and a content-addressed blob
  store. You don't need a server to log, and a repo you log to locally can be served later
  without migration.
- **Cluster-safe.** WAL mode (`local_wal=True`) gives each run its own append-only log file.
  Hundreds of jobs can write to one repo on NFS without contending for the database.
- **Cross-device.** Run `cairn server` on one machine and log to it from others with
  `repo="cairn://host:4300"`.
- **Rich media.** Images (with boxes, masks, colormaps and HDR/EXR), galleries, audio, video,
  tables with media cells, histograms, Plotly and matplotlib figures, confusion matrices and
  PR/ROC curves, point clouds, meshes and box hierarchies.
- **Final values you control.** `summary="min"|"max"|"mean"|"last"` picks the number each
  metric shows in the runs table. `x="epoch"` picks the axis its charts start on.
- **Self-logging components.** Objects that implement `__cairn_track__(self, scope)` log
  themselves. `run.track(model, "model", step=it)` walks the whole component tree.
- **Run lifecycle.** You can resume, rewind or fork runs, stop them from the UI, raise alerts,
  record gradient histograms, and capture system metrics, stdout, source code and the git
  state.
- **Artifacts and lineage.** Versioned artifacts with aliases, multi-file directory artifacts
  and external references. Every `use_artifact` is recorded, and the project's lineage graph is
  built from those records.
- **Sweeps and integrations.** Grid, random and Bayesian sweeps, plus callbacks for Hugging Face,
  Lightning, Keras and XGBoost.
- **A full web UI.** A runs table with filters, grouping and computed columns, run workspaces,
  multi-run comparisons, notebook-style reports and share links.

## Where to go next

| If you want to… | Read |
|---|---|
| Install cairn and log your first run | [Getting started](getting-started.md) |
| Log scalars, configs and results | [Logging metrics](guides/logging.md) |
| Log images, audio, 3D and other media | [Media and rich types](guides/media.md) |
| Control what the runs table shows | [Final values and metric rules](guides/metric-rules.md) |
| Resume, fork, stop or evaluate runs | [Run lifecycle](guides/runs.md) |
| Make your models log themselves | [Components and scopes](guides/scopes.md) |
| Version datasets and models | [Artifacts and lineage](guides/artifacts.md) |
| Run hyperparameter sweeps | [Sweeps](guides/sweeps.md) |
| Read runs back into Python | [Reading data back](guides/reading.md) |
| Use the browser UI | [Web UI](ui/index.md) |
| Look up an API | [Python API](reference/python.md), [CLI](reference/cli.md) |
