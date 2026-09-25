# Import and export

cairn moves data in three ways:

| You want to… | Use |
|---|---|
| Move runs, with everything they logged, to another cairn repo | A [run archive](#run-archives) (ZIP) |
| Analyse metrics in pandas, a spreadsheet, or another tool | [`cairn export`](#exporting-metrics) or `history()` |
| Bring in TensorBoard logs | [`cairn import-tb`](integrations.md#importing-tensorboard-logs) |

cairn has no importer for other experiment trackers.

## Run archives

A run archive is a ZIP file that holds complete runs: metadata, config,
summary, every sequence, the artifacts they reference, logs, source snapshots,
metric rules and alerts. It also carries the runs' sweeps and the
[artifact registry](artifacts.md) entries they produced or used.

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
     -d '{"run_ids": ["40b0f87d6972...", "a2d74315818b..."]}' \
     -o runs.zip

# import: upload the ZIP as multipart field "file"
curl -X POST http://localhost:4300/api/import \
     -H "Authorization: Bearer $CAIRN_TOKEN" \
     -F file=@runs.zip
```

Both endpoints need the `write` role when authentication is on (see
[tokens and roles](server.md#tokens-and-roles)).

### What an import does

- Every run gets a **new id**, so importing the same archive twice gives two
  copies. The response lists `original_id`, `new_id` and `name` for each run.
- References between runs follow the new ids: a fork's parent, and a run's
  sweep. A reference to a run or sweep that is neither in the archive nor
  already in the repo is dropped.
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
artifact_registry.json         registry families, versions, aliases and input records
artifacts/<hash><ext>          artifact bytes
artifacts/<hash>.meta.json     artifact metadata
<run_id>/run.json              {run, params, summary}
<run_id>/sequences.json        every logged point
<run_id>/run_artifacts.json    named artifacts (run.log_artifact)
<run_id>/metric_defs.json      summary= / x= metric rules
<run_id>/alerts.json           alerts
<run_id>/logs/...              captured stdout/stderr
<run_id>/source/...            the source snapshot
```

## Exporting metrics

### `cairn export`

`cairn export` writes one run, or a whole project, to a local file. It talks to
a **server** over HTTP: the one set by `cairn configure --server`,
`CAIRN_SERVER`, a `cairn://` value of `CAIRN_REPO`, or the config file, falling
back to `http://localhost:4300`. For a local repo without a server, use the
[Python API](#from-python) instead.

**One run:**

```bash
cairn export 40b0f87d6972... --out run.json                  # the run and every point
cairn export 40b0f87d6972... --format csv --out run.csv      # scalar points only
cairn export 40b0f87d6972... --format parquet --out run.parquet
```

| Format | Contents |
|---|---|
| `json` (default) | `{"run": …, "sequences": {name: [points]}}`: the run's metadata and the raw points of every sequence, media included (as artifact references) |
| `csv`, `parquet` | One row per scalar point: `run_id, name, step, wall_time, value` |

**A whole project:**

```bash
cairn export --project mnist --format csv --out mnist.csv
cairn export --project mnist --filter status=completed --filter lr__gt=0.001 \
             --format parquet --out mnist.parquet
```

This writes one table of every scalar point of every matching run:
`run_id, run_name, name, step, wall_time, value`. `--filter KEY=VALUE` takes
the keywords of `RunQuery.filter()` (see
[Filtering with `filter()`](reading.md#filtering-with-filter)), and `VALUE` is
parsed as JSON when it can be (`lr__gt=0.001` compares numbers,
`optimizer__in=["adam","sgd"]` a list). Repeat `--filter` to combine filters.
With `json`, the table is written as a list of records.

!!! note "Extras"
    `parquet` needs pandas and pyarrow, and `--project` needs pandas for any
    format. Both come with `pip install 'cairn-track[export]'`.

### From Python

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
pip install 'cairn-track[tb]'
cairn import-tb runs/ --project my-experiments
```

Each directory with event files becomes a run, with its scalars, images and
histograms. See [Integrations](integrations.md#importing-tensorboard-logs) for
the details.
