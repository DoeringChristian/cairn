# Import and export

cairn moves data in three ways:

| You want to… | Use |
|---|---|
| Move runs, with everything they logged, to another cairn repo | A [run archive](#run-archives) (ZIP), through the UI or HTTP API |
| Analyse metrics in pandas, a spreadsheet, or another tool | [`history()` and pandas](#exporting-metrics) |
| Bring in TensorBoard logs | [`import_tensorboard()`](integrations.md#importing-tensorboard-logs) |

cairn has no importer for other experiment trackers.

## Run archives

A run archive is a ZIP file that holds selected run data: metadata, config,
summary, every sequence, the artifacts they reference, logs, source snapshots,
metric rules and alerts. It also carries the runs' sweeps and the
[artifact registry](artifacts.md) entries they produced or used. Archives are
for sharing selected runs, not a complete repository backup: report workspaces,
publication history and retained revisions are not included. See
[Backup and recovery](storage-architecture.md#backup-and-recovery).

### In the web UI

- **Export:** in a project's runs table, select runs and click **Export**. The
  browser downloads `cairn_export_<date>.zip`.
- **Import:** click **Import** on the projects page or in a runs table, and
  pick a `.zip`. The dialog lists the imported runs.

### Over the HTTP API

```bash
# export: POST the run ids, get a ZIP back
curl -X POST http://localhost:4300/api/export \
     -H "Authorization: Bearer $CAIRN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"run_ids": ["FULL_RUN_ID_1", "FULL_RUN_ID_2"]}' \
     -o runs.zip

# import: upload the ZIP as multipart field "file"
curl -X POST http://localhost:4300/api/import \
     -H "Authorization: Bearer $CAIRN_TOKEN" \
     -F file=@runs.zip
```

Both endpoints use the server's single token when authentication is enabled
(see [Server and authentication](server.md)). Supply full run IDs in the export
request. `POST /api/import?project=P` imports into project `P`. To use these
endpoints with a local repo, explicitly start `cairn ui --repo PATH` and use its
loopback URL.

### What an import does

- Every run gets a **new id**, so importing the same archive twice gives two
  copies. The response lists `original_id`, `new_id` and `name` for each run.
- Every run takes the next [version](organising-runs.md#versions) of its series (project,
  group, job type, name) in this repo; the version it had in the exported repo is not
  kept.
- References between runs follow the new ids: a fork's parent, a run's
  sweep, and [run links](artifacts.md#runs-that-use-runs) (`uses=` /
  `use_run`) in both directions. A reference to a run or sweep that is
  neither in the archive nor already in the repo is dropped (a run link with
  it).
- Registry entries merge by name. A family with the same project and name is
  reused, and a version whose content that family already has is reused.
  Anything else is appended. Existing aliases are never moved.

### Reading an archive without importing it

`cairn.Reader` opens an archive directly, keeping the original run ids:

```python
with cairn.Reader("runs.zip") as reader:
    for run in reader.runs():
        print(run.id, run.name, run.final)
```

See [Reading data back](reading.md). Runs read from an archive cannot be
edited.

### Archive layout

```text
manifest.json                  {cairn_export_version, exported_at, run_ids}
sweeps.json                    the runs' sweeps and their trials
artifact_registry.json         registry families, versions, entries, aliases and input records
artifacts/<hash><ext>          artifact bytes
artifacts/<hash>.meta.json     artifact metadata
<run_id>/run.json              {run}: the runs row, with its config and summary documents
<run_id>/sequences.json        logged metric and media projections
<run_id>/records.json          structured log records
<run_id>/metric_defs.json      summary= / x= metric rules
<run_id>/alerts.json           alerts
<run_id>/logs.json             captured console rows
<run_id>/logs/...              additional captured log files
<run_id>/source/...            the source snapshot
```

## Exporting metrics

`history()` returns scalar metrics as pandas DataFrames, from a local repo, a
server or an archive. It needs the `[export]` extra.

```python
import cairn

reader = cairn.Reader("./.cairn")
df = reader.runs("mnist").filter(status="completed").history()
# long format: run_id, run_name, name, step, wall_time, value
df.to_parquet("mnist.parquet")

wide = reader.run(run_id).history(["loss", "val.loss"])
# wide format: one row per step, one column per metric
wide.to_csv("run.csv")
```

Final values, config and summary are plain dicts on each run, so a results
table takes a few lines:

```python
import pandas as pd

rows = [{"run": r.name, **r.config, **r.final} for r in reader.runs("mnist")]
pd.DataFrame(rows)
```

## Importing TensorBoard logs

```bash
pip install 'cairn-track[tb] @ git+https://github.com/DoeringChristian/cairn@v0.7.0'
```

```python
from cairn.sdk.import_tb import import_tensorboard

run_ids = import_tensorboard(
    "runs/", project="my-experiments", repo="./.cairn",
)
```

Each directory with event files becomes a run, with its scalars, images and
histograms. See [Integrations](integrations.md#importing-tensorboard-logs) for
the details.
