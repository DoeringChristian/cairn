# Run lifecycle

This page covers everything about a run apart from what you log into it: how it starts, how it
ends, how to continue or branch it, how to stop it from the UI, and what cairn captures
automatically.

## Starting a run

```python
run = cairn.Run(
    "cifar10",                      # project, created on first use
    name="resnet18-baseline",
    tags=["baseline"],
    notes="lr sweep winner",
    group="resnet18",               # e.g. all seeds of one configuration
    job_type="train",               # e.g. "train", "eval", "preprocess"
)
```

The project is the only positional argument. Everything else is a keyword:

| Keyword | Default | Purpose |
|---|---|---|
| `name` | `None` | Display name. Names need not be unique; the ID is. |
| `tags`, `notes` | `None` | See [tags and notes](logging.md#tags-and-notes). |
| `group` | `None` | Groups related runs, such as the seeds of one configuration or the workers of one job. |
| `job_type` | `None` | What kind of work the run does, such as `"train"` or `"eval"`. |
| `repo` | resolved | Where to log. See [how cairn picks a destination](../getting-started.md#how-cairn-picks-a-destination). |
| `local_wal` | `False` | WAL mode for many concurrent writers. See [WAL mode](../getting-started.md#wal-mode-many-writers-on-a-shared-filesystem). |
| `mode` | resolved | `"disabled"` makes the run a no-op. See [disabled runs](#disabled-runs). |
| `resume`, `rewind_to`, `fork_from` | `None` | [Continue or branch an existing run](#resume-rewind-and-fork). |
| `stop_mode`, `on_stop` | `"interrupt"`, `None` | [Stopping from the UI](#stopping-a-run-from-the-ui). |
| `capture_source`, `capture_stdout`, `capture_env`, `capture_system_metrics` | `True` | [Automatic capture](#system-metrics-logs-and-code). |
| `system_metrics_interval` | `10.0` | Seconds between system-metric samples. |
| `system_metrics_include_per_core` | `False` | Also record per-core CPU utilisation. |
| `source_root`, `source_include`, `source_exclude`, `source_max_file_size_mb` | auto, defaults, defaults, `1.0` | What the source snapshot contains. |
| `created_at` | now | Override the creation time, for example when importing historical runs. |
| `timeout` | `10.0` | HTTP timeout in seconds (server mode). |

`group` and `job_type` are shown in the runs table, where you can filter and group by them. They
are also available in [expressions](../reference/expressions.md) and on
[`Reader`](reading.md) runs (`run.group`, `run.job_type`).

## Finishing a run and its status

A run is `running` until it finishes. It ends with one of these statuses:

| Status | When |
|---|---|
| `completed` | `run.finish()`, leaving a `with` block normally, or a normal interpreter exit |
| `failed` | an exception leaves the `with` block, or an unhandled exception ends the script |
| `killed` | the process receives SIGINT (Ctrl+C) or SIGTERM, or the run stops sending heartbeats |
| `stopped` | a stop was requested from the UI (see below) |

```python
with cairn.Run("cifar10") as run:     # finish() is called for you
    train(run)

run = cairn.Run("cifar10")
try:
    train(run)
finally:
    run.finish()                      # or finish(status="failed", exit_code=1)
```

If you never call `finish()`, cairn finishes the run when the interpreter exits. The run sends a
heartbeat every 10 seconds. A server running on the repo (`cairn ui` or `cairn server`) marks a
run `killed` when it hasn't heard from it for 2 minutes, which covers crashes and `kill -9`.

After `finish()` the run is closed. Tracking into it raises `RuntimeError`, so to add data later,
[resume it](#resume-rewind-and-fork).

## Resume, rewind and fork

There are three ways to build on an existing run:

```python
# Continue the same run under its own ID. It is running again and keeps its history.
run = cairn.Run("cifar10", resume="3f9a…")

# Continue it, but first drop everything it recorded after step 5000.
run = cairn.Run("cifar10", resume="3f9a…", rewind_to=5000)

# Start a NEW run that copies the history up to step 5000 and links to the original as its parent.
run = cairn.Run("cifar10", name="lower-lr", fork_from=("3f9a…", 5000))
```

- **Resume** keeps the run's ID, name, tags and other creation metadata. The creation keywords
  you pass (`name`, `tags`, …) are ignored.
- **Rewind** (`rewind_to=k`, only with `resume`) deletes every point with `step > k`, then
  resumes. Use it to restart from a checkpoint without leaving the discarded steps in the
  charts.
- **Fork** creates a new run with its own ID and your creation keywords. It copies the parent's
  history up to step `k`, plus its config, summary and [metric rules](metric-rules.md). The UI's
  lineage view shows the parent link.

"History up to step `k`" means every point with `step <= k`. The exception is `system.*` series,
whose steps are sampler counters: those are cut at the time of the last kept point instead.

To resume later, keep the run ID with your checkpoint:

```python
torch.save({"model": model.state_dict(), "step": step, "cairn_run": run.id}, "ckpt.pt")
...
ckpt = torch.load("ckpt.pt")
run = cairn.Run("cifar10", resume=ckpt["cairn_run"], rewind_to=ckpt["step"])
```

!!! note
    In WAL mode, a resumed or forked run must already be ingested into the database. Let a
    `cairn ui`/`cairn server` or a `cairn.Reader` drain the WAL first.

## Stopping a run from the UI

A running run has a **Stop** button in the UI. The request reaches the run on its next heartbeat,
so it can take up to 10 seconds. What happens next depends on `stop_mode`:

- **`"interrupt"`** (default): cairn raises `KeyboardInterrupt` in your main thread. The run ends
  with status `stopped` (not `killed`), including when the exception propagates out of a `with`
  block.
- **`"flag"`**: nothing is interrupted. `run.should_stop` becomes `True`, and your loop decides
  when to exit.

```python
run = cairn.Run("cifar10", stop_mode="flag")

@run.on_stop
def save_checkpoint(run):
    torch.save(model.state_dict(), "stopped.pt")

for step in range(total_steps):
    if run.should_stop:
        break
    ...
run.finish("stopped")
```

Callbacks registered with `run.on_stop` (as a decorator, or `Run(on_stop=fn)`) run on the
heartbeat thread *before* the main thread is interrupted. Keep them short.

## Alerts

```python
run.alert("Loss diverged", f"loss={loss:.3g} at step {step}", level="error")
```

`level` is `"info"`, `"warn"` or `"error"`. Alerts appear in the UI (the project's bell and a
banner on the run page). If the server was started with `--alert-webhook URL` (or
`CAIRN_ALERT_WEBHOOK`), each alert is also posted to that URL. Supported targets are ntfy topics,
Slack and Discord webhooks, and any endpoint that accepts JSON. Runs that end `failed` or
`killed` raise an alert automatically. Alerts written while no server is running are delivered
when one next starts on the repo.

## Gradient and parameter histograms

```python
run.watch(model, log="gradients", every=100, bins=64)
```

`run.watch` hooks a torch module. On every `every`-th forward pass it records a histogram per
parameter: `gradients/<param>` from that pass's backward, `parameters/<param>`, or both
(`log="gradients"|"parameters"|"all"`). Histograms are binned on the tensor's device, and a
background thread uploads them, so training doesn't wait. Each histogram is recorded at the most
recent step you passed to `run.track`.

`run.unwatch(model)` removes the hooks for one model, and `run.unwatch()` removes them for all.
`finish()` also removes them.

## System metrics, logs and code

By default a run captures the following automatically. Turn any part off with the matching
`capture_*=False` keyword.

**System metrics** (`capture_system_metrics`): sampled every `system_metrics_interval` seconds
(default 10) into `system.*` series. They cover CPU utilisation and load, memory and swap, disk
and network throughput, the process's CPU, memory and thread count, and, for NVIDIA GPUs,
per-GPU utilisation, memory, temperature and power (`system.gpu.<i>.*`).

**Console output** (`capture_stdout`): stdout and stderr are captured and shown in the run's log
view, and still printed to your terminal.

**Environment** (`capture_env`): Python version, platform, hostname, user, command-line arguments,
CUDA availability and GPU names, and a hash of the installed packages.

**Git state** (with `capture_source` or `capture_env`): the commit, branch, dirty flag and
`origin` remote of the working directory, with credentials stripped from the URL. If the tree is
dirty and `capture_source` is on, the diff against `HEAD` plus a list of untracked files (capped
at 2 MB) is stored as the text attachment `_cairn/git.diff`.

**Source snapshot** (`capture_source`): cairn walks up from the working directory to the project
root, marked by `.git`, `pyproject.toml`, `pixi.toml`, `setup.py` and similar files, and uploads
an archive of its source files in the background. By default it includes Python files,
configuration files (`*.yaml`, `*.toml`, `*.json`, …) and lock files. It excludes virtualenvs,
caches, build output, `.git` and `.cairn`, skips files over 1 MB, and respects the top-level
`.gitignore`. Override this with `source_root`, `source_include`, `source_exclude` (glob
patterns that replace the defaults) and `source_max_file_size_mb`.

The snapshot appears on the run's *Source* page. `cairn diff RUN_ID` compares your current
working directory with it.

## Disabled runs

```python
run = cairn.Run("cifar10", mode="disabled")
```

A disabled run accepts every call and does nothing: no repo is opened, no server is contacted and
no threads start. `run.url` is `None`. It is still an instance of `cairn.Run`, so type checks and
`isinstance` keep working. Use `cairn.configure(mode="disabled")` or `CAIRN_MODE=disabled` to
disable tracking without touching the code, for example in tests or debugging sessions.

## Heavy evaluation at the end of training

A common question is where to put an expensive final evaluation (a full test set, FID, human-eval
samples) so that its numbers appear next to the training run. In order of preference:

### 1. Log it into the same run, at the final step

If the evaluation runs in the same process, log its results into the training run before it
finishes. Use the last training step, so the points line up with the training curves:

```python
with cairn.Run("cifar10", name="resnet18") as run:
    for step in range(total_steps):
        run.track(train_step(), "train.loss", step)
        if step % 1000 == 0:
            run.track(quick_val(), "val.acc", step, summary="max")

    last = total_steps - 1
    results = full_test_eval(model)
    run.track(results["acc"], "test.acc", last)
    run.track(cairn.ConfusionMatrix(results["y"], results["pred"]), "test.confusion", last)
    run.summary(test_fid=results["fid"])
```

Periodic metrics get a [rule](metric-rules.md) such as `summary="max"`, so the runs table shows
their best value. A metric logged only once needs no rule, since its only point is its final
value. `run.summary` is for numbers that are not series.

### 2. Resume the run later

If the evaluation happens later or in another job, for example on a different machine after
training finished, resume the training run and log into it:

```python
ckpt = torch.load("final.pt")
run = cairn.Run("cifar10", resume=ckpt["cairn_run"], capture_source=False)
results = full_test_eval(load_model(ckpt))
run.track(results["acc"], "test.acc", ckpt["step"])
run.summary(test_fid=results["fid"])
run.finish()
```

The run keeps its ID, config and history, so everything stays in one row of the runs table.

!!! tip
    Pass `capture_source=False` when resuming for evaluation. Otherwise the evaluation script's
    source snapshot replaces the one captured during training.

### 3. A separate run, only when it is genuinely separate

Use a new run when the evaluation is its own experiment: it evaluates several checkpoints, it
compares models from different runs, or it is repeated with different evaluation settings. Link
it to the training run instead of duplicating its data:

```python
with cairn.Run("cifar10", name="eval-resnet18", group="resnet18", job_type="eval") as run:
    model_file = run.use_artifact("resnet18-weights:best")   # records the lineage edge
    run.config(split="test", tta=True)
    run.track(evaluate(model_file), "test.acc", 0)
```

`group` puts the training and evaluation runs together in the runs table, and `job_type="eval"`
lets you filter the evaluations. [`use_artifact`](artifacts.md) records exactly which model
version was evaluated, which appears on the lineage page.
