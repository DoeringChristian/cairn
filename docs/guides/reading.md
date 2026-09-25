# Reading data back

`cairn.Reader` reads runs back into Python: to analyse results in a notebook,
pick the best checkpoint, or build a report. It reads a local repo, a server,
or an exported run archive, and it can also edit existing runs.

```python
import cairn

reader = cairn.Reader()  # resolved like cairn.Run: CAIRN_REPO, config file, ./.cairn
for run in reader.runs("mnist").filter(status="completed"):
    print(run.name, run.final.get("val.loss"))
```

## Opening a reader

```python
cairn.Reader()                            # same resolution as cairn.Run
cairn.Reader("./.cairn")                  # a local repo
cairn.Reader("cairn://gpu-server:4300")   # a server (http:// and https:// work too)
cairn.Reader("runs.zip")                  # a run archive exported from the UI
```

| Target | How it reads |
|---|---|
| Local `.cairn/` directory | Opens the SQLite database directly. It first ingests any pending [WAL files](server.md#wal-mode), so runs logged with `local_wal=True` show up without a running server. |
| Server | Reads over HTTP. Sends the token from `CAIRN_TOKEN` or the config file's `token` key, if there is one. Downloaded artifact bytes are cached by hash (see `cache` and `cache_dir` below). |
| `.zip` archive | Unpacks the archive into a temporary repo, which is deleted by `close()`. Runs read this way cannot be edited. |

Keyword arguments:

- `cache` (default `True`): for a server, cache downloaded artifacts by their
  SHA-256 so repeated reads don't download them again.
- `cache_dir`: where that cache lives. By default it is `cache/blobs` inside
  the nearest `.cairn/` above the current directory, else the user cache
  directory.

`Reader` is a context manager. Use `with cairn.Reader(...) as reader:`, or call
`reader.close()` when you are done.

## Projects and runs

```python
reader.projects()          # [Project(id, name, created_at, run_count, active_run_count, last_run_at)]
reader.run("40b0f87d69...")  # one run by id
reader.runs()              # a query over all runs
reader.runs("mnist")       # a query over one project
```

`reader.runs(...)` returns a lazy `RunQuery`. Nothing is fetched until you
iterate it or call `list()`, `first()`, `last()` or `len()`. Each method below
returns a new query, so you can chain them:

```python
q = (reader.runs("mnist")
     .filter(status="completed", optimizer="adam")
     .where("min(val.loss) < 0.2")
     .sort("created_at", desc=True)
     .limit(10))

runs = q.list()
newest = reader.runs("mnist").last()    # newest by creation time
oldest = reader.runs("mnist").first()   # oldest by creation time
```

`sort()` accepts `created_at` (the default), `ended_at`, `display_name` and
`status`.

!!! warning "Sorting over HTTP"
    `sort()` is applied only when the reader opens a local repo. A reader
    connected to a server gets runs newest first whatever you pass, so
    `first()` and `last()` both return the newest run there.

## Filtering with `filter()`

`filter()` takes Django-style `field__operator=value` keywords. Several keywords
must all match.

```python
reader.runs("mnist").filter(
    status="completed",              # exact match (the default operator)
    name__startswith="lr-search",
    tags__contains="best",           # the run has this tag
    lr__gt=1e-4,                     # a config key
    optimizer__in=["adam", "sgd"],
    summary__test_acc__gte=0.9,      # a run.summary(...) value
    metrics__val_loss__lt=0.3,       # a scalar metric (see below)
)
```

**Operators:** `exact`, `iexact`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`,
`icontains`, `startswith`, `endswith`, `isnull`.

**Fields:**

| Field | Compares |
|---|---|
| `name`, `status`, `project`, `id`, `hostname`, `notes`, `group`, `job_type` | That run attribute |
| `tags` | The tag list. Use `tags__contains="best"`. |
| `params__<key>` | A config key |
| `summary__<key>` | A key recorded with `run.summary(...)` |
| `metrics__<name>` | The **last logged point** of that scalar series |
| anything else | A config key. For nested config, join the levels with `__`: `hparams__lr__gt=1e-3` compares the config key `hparams.lr`. |

!!! note
    `metrics__<name>` looks at the last point, not the metric's final value.
    It ignores `summary=` rules and summary keys. To filter on the final value,
    use `where()` with an expression such as `min(val.loss) < 0.3`, or filter
    on `summary__<name>`.

Only `status=` is applied by the database. Every other filter is applied in
Python, after all of the project's runs have been fetched, and a `metrics__`
filter fetches each run's series. On a large project, narrow the query with
`status=` first.

## Filtering with expressions: `where()`

`where()` keeps the runs for which a cairn expression is true. It uses the same
[expression language](../reference/expressions.md) as the UI's filters and
computed columns:

```python
reader.runs("mnist").where("last(val.acc) > 0.9 and config.optimizer == 'adam'")
reader.runs("mnist").where("min(val.loss) < 0.2")
```

The expression must produce a single value. A series is an error: reduce it
with `last(...)`, `min(...)` and so on. A value of `None`, for example a missing
metric, does not match. The expression is parsed and type-checked when you call
`where()`, so a mistake raises `cairn.expr.ExprError` right away.

## What a run holds

A reader `Run` loads its data lazily:

| Attribute | Contents |
|---|---|
| `id`, `name`, `project`, `status` | Identity and status |
| `created_at`, `ended_at`, `duration` | `datetime` / `timedelta`. `duration` runs to now for a live run. |
| `tags`, `notes`, `group`, `job_type`, `hostname` | Metadata |
| `git` | `GitInfo(sha, branch, dirty, remote)`, or `None` |
| `config` (alias `params`) | The config, as flattened dotted keys: `{"hparams.lr": 0.001, …}` |
| `summary` | The keys recorded with `run.summary(...)` |
| `final` | Every metric's final value, exactly as the runs table shows it |

`run.final` resolves each metric in this order: an explicit `run.summary` key,
else the metric's `summary=` rule, else its last logged point (see
[Final values and metric rules](metric-rules.md)). It includes the `system.*`
metrics and every summary key.

```python
run = reader.runs("mnist").last()
run.config["hparams.lr"]
run.final["val.loss"]
```

## Metric history

```python
seq = run.sequence("val.loss")                    # a Sequence
seq = run.sequence("val.loss", step_from=100, step_to=200)
seq.steps, seq.values, seq.timestamps              # parallel lists
seq[-1]                                            # the last SequencePoint
seq[10:20]                                         # a Sequence
seq.dataframe()                                    # pandas: step, value, wall_time, artifact_hash

run.sequences()                                    # [SequenceInfo(name, object_type, min_step, max_step, count)]
```

For pandas DataFrames of scalar metrics, use `history()`. It needs the
`[export]` extra (`pip install 'cairn-track[export]'`).

```python
run.history()                        # wide: one row per step, one column per metric
run.history(["loss", "val.loss"])    # only these metrics

reader.runs("mnist").history(["val.loss"])
# long: run_id, run_name, name, step, wall_time, value (wall_time is tz-aware UTC)
```

## Expressions on one run: `eval()`

`run.eval(expr)` evaluates an [expression](../reference/expressions.md) on one
run:

```python
run.eval("last(val.loss) - min(val.loss)")   # a number
run.eval("ema(loss, 0.9)")                   # a cairn.expr.Series (steps, values)
```

A parse or type error raises `cairn.expr.ExprError`. Joining series that were
logged at different steps emits a `cairn.expr.ExprWarning`.

## Media and artifacts

Everything that is not a scalar (images, tables, tensors, figures, files) is
stored as an artifact:

```python
run.artifacts()                    # [ArtifactInfo(name, hash, step, mime_type, size_bytes, ...)]
img = run.artifact("samples")      # the highest step, decoded
img = run.artifact("samples", step=10)
raw = run.artifact_bytes("samples", step=10)
```

`artifact()` decodes by type:

| Logged as | Returned as |
|---|---|
| `cairn.Image` | `PIL.Image` (PNG), or `numpy.ndarray` for `exr` and `npy` encodings. A gallery (a list of images) returns a list. |
| `cairn.Audio` | `(samples: ndarray, sample_rate: int)` |
| `cairn.Video` | `ndarray` of shape `(T, H, W, C)` |
| `cairn.Tensor` | `ndarray` |
| `cairn.Text` | `str` |
| `cairn.Histogram` | `(counts, edges)` |
| `cairn.Table` | `{"columns": [...], "data": [...]}`. Media cells are `MediaRef` objects. |
| a figure | `PIL.Image`, rasterized. Use `artifact_bytes()` for the source. |
| `cairn.Artifact` | The unpickled object |
| anything else | `bytes` |

A `MediaRef` (an image, audio or video cell of a table) downloads nothing until
you call `.load()` (decoded, as above) or `.bytes()` (raw).

`run[tag]` is a lazy handle, a `DataRef`, that fetches nothing until you ask:

```python
ref = run["samples"]
ref.resolve()          # the artifact (latest step), or the scalar Sequence for a metric
run["samples"][10]     # narrowed to step 10
ref.url                # a live query URL pinned to this run (needs a server)
```

The run's other captured data:

```python
run.logs(stream="stdout", search="error", limit=100)   # [LogLine]
run.source_tree()               # [SourceFile(path, size, sha256)], or None
run.source_file("train.py")     # str, or None for binary files
run.input_artifacts()           # registry versions this run used
run.output_artifacts()          # registry versions this run produced
```

For the versioned artifact registry (`reader.artifact_families`,
`reader.artifact_versions`, `reader.lineage`, `cairn.load_artifact`), see
[Artifacts and lineage](artifacts.md).

## Editing runs

`run.edit()` opens an editor for an existing run. Writes go where a
`cairn.Run` would write: the repo database, or the server that holds the repo,
or the `cairn://` server the reader reads.

```python
with reader.run(run_id).edit() as e:
    e.set_summary(test_acc=0.93)        # merge keys into the summary
    e.set_config(dataset="v2")        # merge keys into the config
    e.delete_keys("summary", ["tmp"])   # "config" or "summary"; also removes nested keys
    e.add_tag("best")
    e.remove_tag("draft")
    e.set_tags(["best", "paper"])       # replace all tags
    e.rename("baseline-v2")
    e.set_notes("Re-evaluated on the v2 test set.")
```

The `Run` you called `edit()` on sees the changes. Editing needs the `write`
role on a server with authentication (see [Server, auth and
deployment](server.md#tokens-and-roles)). Runs read from a `.zip` archive
cannot be edited.

## Live query URLs

A **live query URL** is a stable server URL that always resolves to "the `tag`
artifact of the latest (optionally filtered) run". A report or a web page that
embeds it shows the freshest data every time it opens. The page never changes;
only what the URL resolves to does.

```python
url = cairn.query_url("train/render", project="demo", server="cairn://localhost:4300")
# http://localhost:4300/api/query?run=latest&tag=train%2Frender&project=demo
```

When fetched, `GET /api/query?...` redirects (302) to the immutable artifact
URL `/api/artifacts/<digest>`. The query response is never cached; the artifact
it points to can be cached forever.

`cairn.query_url(tag, *, run, name, project, live, step, server, token, **filters)`:

| Argument | Meaning |
|---|---|
| `tag` | The artifact or sequence name to resolve (required) |
| `run` | `latest` (default), `latest:N` (the N-th newest), `newest-per-name`, or `id:<run_id>` |
| `project` | Restrict to one project |
| `name` | A display-name glob (`exp*`) or case-insensitive substring |
| `step` | `latest` (the highest step, default) or an integer |
| `live` | `True` (default): return the re-resolving query URL. `False`: resolve it once now and return the fixed `/api/artifacts/<digest>` URL. |
| `server` | The server (`cairn://host:port` or `http(s)://…`). Default: the configured target, which must be a server. |
| `token` | The token for the one-time resolve when `live=False`. Default: `CAIRN_TOKEN` or the config file. |
| `**filters` | Predicates: `lr__gt=1e-4`, `tags__contains="best"`, `status="completed"` |

In a query URL, nested fields use a dot: `metrics.loss__lt=0.1`,
`hparams.lr__gt=0.001`. From Python, pass such keys with `**`:

```python
cairn.query_url("render", project="demo", **{"metrics.loss__lt": 0.1})
```

In URL filters, `metrics.<name>` compares the metric's value after its
`summary=` rule is applied (else its last point).

Two shortcuts build the same URLs from reader objects:

```python
reader = cairn.Reader("cairn://localhost:4300")
reader.runs("demo").filter(lr__gt=1e-4).latest_url("render")
# .../api/query?run=latest&tag=render&project=demo&lr__gt=0.0001

run = reader.runs("demo").last()
run["render"].url        # run=id:<run_id>, pinned to this run
run["render"][5].url     # ...and to step 5
```

`latest_url()` turns `filter()` keywords into URL predicates, including nested
ones. It cannot express `where()` filters and raises if the query has one.

Query URLs need a server, both to build them and to fetch them. With a local
repo target, `query_url`, `latest_url` and `DataRef.url` raise `ValueError`. A
server with authentication also needs a token on every fetch: the browser sends
its `cairn_token` login cookie when the page is served from the same origin.
`examples/report_query_url.py` builds a `cairn.plot` report from live query
URLs.
