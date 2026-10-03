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
reader.projects()            # [Project(id, name, created_at, run_count, active_run_count, last_run_at)]
reader.run("40b0f87d69...")  # one run by id (archived runs too)
reader.runs()                # a query over all runs
reader.runs("mnist")         # a query over one project (a name or id: "My Project" works)
```

`reader.runs(...)` returns a lazy `RunQuery`. Nothing is fetched until you
iterate it or call `list()`, `first()`, `last()`, `get()` or `len()`. Each
method below returns a new query, so you can chain them:

```python
q = (reader.runs("mnist")
     .filter(status="completed", optim__name="adam")
     .where("min(val.loss) < 0.2")
     .sort("metrics.val.acc", desc=True)
     .limit(10))

runs = q.list()
best = q.first()                            # the best val.acc
newest = reader.runs("mnist").last()        # the newest run
base = reader.runs("mnist").filter(name="base", status="completed").last()
only = reader.runs("mnist").filter(name="base").get()   # exactly one, else LookupError
```

A query is evaluated by one evaluator, the server's, so it returns the same
runs in the same order on a local repo and on a server (a local repo runs the
same code in-process).

### Order

- The default order is **chronological**: `created_at` ascending. Iteration,
  `list()` and `history()` follow it.
- `sort(key, desc=False)` replaces the order. `key` is `created_at`,
  `ended_at`, `duration`, `name`, `status`, `id`, `config.<path>`,
  `summary.<path>` or `metrics.<name>` (the final value, as `Run.final`; a
  dotted metric name is written as is, `metrics.val.acc`). An unknown key
  raises `ValueError`.
- Ties break by `created_at`, then by run id, in the sort's direction, so
  `desc=True` is the exact reverse of `desc=False` among runs that have the
  key.
- Runs **missing** the key sort after all others, in both directions: no such
  config key or metric, the `ended_at` of a running run, NaN, or a value whose
  type differs from that of most runs (a string among numbers).

### `first()`, `last()`, `get()`

- `first()` is the first run of the query's order and `last()` the last; both
  return None when nothing matches. With the default order that is the oldest
  and the newest run; `sort("metrics.val.acc", desc=True).first()` is the best
  one (a run without the metric never wins).
- With `limit(n)`, `last()` is the last of the first `n`.
- `get()` returns the one matching run, or raises `LookupError` when none or
  several match. Names are not unique (a resume keeps its name, re-runs reuse
  names), so `filter(name=...)` can match several runs: use `.last()` for the
  newest, or `.get()` when a duplicate would be a bug.

### Archived runs

Archiving a run (from the UI) hides it without changing its status.
`reader.runs(project)` leaves archived runs out; `reader.runs(project,
archived=True)` lists only them, `archived=None` both. `Run.archived` tells.

## Filtering with `filter()`

`filter()` takes Django-style `field__operator=value` keywords. Several keywords
must all match.

```python
reader.runs("mnist").filter(
    status="completed",              # exact match (the default operator)
    name__startswith="lr-search",
    tags__contains="best",           # the run has this tag
    lr__gt=1e-4,                     # a config key
    optim__lr__lte=3e-4,             # the config path optim.lr
    optimizer__in=["adam", "sgd"],
    summary__test_acc__gte=0.9,      # a run.summary(...) value
    metrics__val__loss__lt=0.3,      # the final value of the metric val.loss
)
```

**Operators:** `exact`, `iexact`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`,
`icontains`, `startswith`, `endswith`, `isnull`.

**Fields:**

| Field | Compares |
|---|---|
| `name`, `status`, `project`, `id`, `hostname`, `user`, `notes`, `group`, `job_type` | That run attribute |
| `tags` | The tag list. Use `tags__contains="best"`. |
| `config__<path>` | A config path: `config__optim__lr__lt=1e-2` is `optim.lr`; so is `**{"config.optim.lr__lt": 1e-2}` |
| `summary__<path>` | A summary path |
| `metrics__<name>` | The metric's **final value**, exactly as `Run.final` (and the runs table) shows it |
| anything else | A config path: `optim__lr__gt=1e-3` compares `optim.lr` |

A path that names a sub-document compares the whole dict
(`config__optim={"lr": 1e-3}`). Lists are values: `layers__contains=64`. A run
whose value cannot be compared (missing under `gt`, a string under `gt=5`) does
not match.

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
| `id`, `name`, `project`, `status`, `archived` | Identity and status |
| `created_at`, `ended_at`, `duration` | `datetime` / `timedelta`. `duration` runs to now for a live run. |
| `tags`, `notes`, `group`, `job_type`, `hostname` | Metadata |
| `git` | `GitInfo(sha, branch, dirty, remote)`, or `None` |
| `config` | The config, the nested document exactly as logged: `{"optim": {"lr": 0.001}, ...}` (a copy) |
| `summary` | The summary, nested the same way |
| `final` | Every metric's final value, exactly as the runs table shows it (flat metric names) |

`run.final` resolves each metric in this order: an explicit `run.summary` key
of the same dotted name, else the metric's `summary=` rule, else its last
logged point (see [Final values and metric rules](metric-rules.md)). It
includes the `system.*` metrics and every summary key.

```python
run = reader.runs("mnist").last()
run.config["optim"]["lr"]
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

## Media

A media point (an image, table, tensor, figure, … logged with `run.track`) is
read with `run.media(name, step=None)`: the point at `step`, or the highest
step. It returns a `MediaRef`, which downloads nothing until you call `.load()`
(decoded) or `.bytes()` (raw):

```python
img = run.media("samples").load()             # the highest step, decoded
img = run.media("samples", step=10).load()
raw = run.media("samples", step=10).bytes()
```

`load()` decodes by type:

| Logged as | Returned as |
|---|---|
| `cairn.Image` | `PIL.Image` (PNG), or `numpy.ndarray` for `exr` and `npy` encodings. |
| `cairn.Audio` | `(samples: ndarray, sample_rate: int)` |
| `cairn.Video` | `ndarray` of shape `(T, H, W, C)` |
| `cairn.Tensor` | `ndarray` |
| `cairn.Text` | `str` |
| `cairn.Histogram` | `(counts, edges)` |
| `cairn.Table` | `{"columns": [...], "data": [...]}`. Media cells are `MediaRef` objects. |
| a figure | `PIL.Image`, rasterized |
| `cairn.Pickle` | The unpickled object |
| anything else | `bytes` |

A [gallery](media.md#captions-and-galleries) (a list of media of one kind
logged at one step) comes back as a list of `MediaRef`s, each with the item's
`caption` and `metadata`:

```python
for item in run.media("samples", step=10):
    print(item.caption, item.mime_type)
    img = item.load()
```

`run[tag]` is a lazy handle, a `DataRef`, that fetches nothing until you ask:

```python
ref = run["samples"]
ref.resolve()          # the media value (latest step), or the scalar Sequence for a metric
run["samples"][10]     # narrowed to step 10
ref.url                # a live query URL pinned to this run (needs a server)
```

The run's other captured data:

```python
run.logs(stream="stdout", search="error", limit=100)   # [LogLine]
run.source_tree()               # [SourceFile(path, size, sha256)], or None
run.source_file("train.py")     # str, or None for binary files
```

## Artifacts

```python
run.logged_artifacts()                     # [ArtifactVersion] this run logged
run.used_artifacts()                       # [ArtifactVersion] this run used
run.used_artifacts(role="dataset")
reader.artifact("base-ckpt:best", project="denoise")    # one version
reader.artifact("denoise/base-ckpt:v3")                  # the project in the ref
reader.artifact_versions("base-ckpt", project="denoise") # oldest first
reader.artifact_families("denoise", type="model")        # [ArtifactFamily]
reader.lineage("denoise")                                # the graph
```

`reader.artifact` records no consumption (that is `cairn.Run.use_artifact`).
See [Artifacts and lineage](artifacts.md).

## Editing runs

`run.edit()` opens an editor for an existing run. Writes go where a
`cairn.Run` would write: the repo database, or the server that holds the repo,
or the `cairn://` server the reader reads.

```python
with reader.run(run_id).edit() as e:
    e.set_summary(test_acc=0.93)        # deep-merged into the summary
    e.set_config(data={"version": 2})   # deep-merged into the config
    e.delete_keys("summary", ["tmp"])   # "config" or "summary": dotted paths, subtree included
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

When fetched, `GET /api/query?...` redirects (302) to the immutable blob
URL `/api/artifacts/<digest>` of that run's media point. The query response is never cached; the artifact
it points to can be cached forever.

`cairn.query_url(tag, *, run, name, project, live, step, server, token, **filters)`:

| Argument | Meaning |
|---|---|
| `tag` | The media sequence to resolve (required) |
| `run` | `latest` (default), `latest:N` (the N-th newest), `newest-per-name`, or `id:<run_id>`. Archived runs are never selected; `latest` is `reader.runs(...).last()`. |
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

In URL filters, `metrics.<name>` compares the metric's final value, as in
`filter()`; any other dotted key is a config path.

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
