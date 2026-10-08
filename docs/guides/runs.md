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

The project is the only positional argument; `run.project` returns its id,
the normalised name (`"My Project"` becomes `"my-project"`). Everything else is
a keyword:

| Keyword | Default | Purpose |
|---|---|---|
| `name` | `None` | Display name. Names need not be unique; the ID is. |
| `tags`, `notes` | `None` | See [tags and notes](logging.md#tags-and-notes). |
| `group` | `None` | Groups related runs, such as the seeds of one configuration or the workers of one job. |
| `job_type` | `None` | What kind of work the run does, such as `"train"` or `"eval"`. |
| `repo` | resolved | Where to log. See [how cairn picks a destination](../getting-started.md#how-cairn-picks-a-destination). |
| `mode` | resolved | `"disabled"` makes the run a no-op. See [disabled runs](#disabled-runs). |
| `resume`, `rewind_to`, `fork_from` | `None` | [Continue or branch an existing run](#resume-rewind-and-fork). |
| `run_id` | `CAIRN_RUN_ID`, else fresh | The new run's ID. See [several processes, one run](#several-processes-one-run). |
| `label`, `primary` | `None`, `True` | This process's name within a shared run, and whether it creates the run or joins it. See [several processes, one run](#several-processes-one-run). |
| `total_steps` | `None` | The steps the run will take; shown as [progress](#progress-and-eta). |
| `stop_mode`, `on_stop` | `"interrupt"`, `None` | [Stopping from the UI](#stopping-a-run-from-the-ui). |
| `capture_source`, `capture_stdout`, `capture_env`, `capture_system_metrics` | `True` | [Automatic capture](#system-metrics-logs-and-code). |
| `system_metrics_interval` | `10.0` | Seconds between system-metric samples. |
| `system_metrics_include_per_core` | `False` | Also record per-core CPU utilisation. |
| `source_root`, `source_include`, `source_exclude`, `source_max_file_size_mb` | auto, defaults, defaults, `1.0` | What the source snapshot contains. |
| `created_at` | now | Override the creation time, for example when importing historical runs. |
| `timeout` | `10.0` | HTTP timeout in seconds (server mode), also how long `finish()` keeps sending what is left (see [Server mode](server.md#server-mode-and-connection-loss)). |

`group` and `job_type` are shown in the runs table, where you can filter and group by them. They
are also available in [expressions](../reference/expressions.md) and on
[`Reader`](reading.md) runs (`run.group`, `run.job_type`).

## Finishing a run and its status

A run is `running` until it finishes. It ends with one of these statuses:

| Status | When |
|---|---|
| `completed` | `run.finish()`, leaving a `with` block normally, or a normal interpreter exit |
| `failed` | an exception leaves the `with` block, or an unhandled exception ends the script |
| `killed` | the process receives SIGINT (Ctrl+C) or SIGTERM, or a run logged to a server stops sending heartbeats |
| `crashed` | a run on a local repo whose log got no new record for 5 minutes without finishing (the process died, e.g. `kill -9` or a node failure); it is `running` again if records arrive later |
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
heartbeat every 10 seconds. On a local repo the ingester marks a run `crashed` when its log has had
no new record for 5 minutes and no finish, which covers `kill -9` and lost nodes; a later record
makes it `running` again. A `cairn server` that runs log to over HTTP marks one `killed` when it
hasn't heard from it for 2 minutes.

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
    On a local repo, resuming, rewinding or forking first catches up on the run's log (through
    the `cairn ui`/`cairn server` serving the repo, or by itself), so a run that just finished
    in another process can be continued at once.

## Versions

Runs that share a name form a **series**: the runs of one project with the
same group and the same name (`cairn.Run(..., group=..., name=...)`; a run
without a group is in the ungrouped series of its name). The server numbers
every named run in its series when it creates the run: the first `train` is
version 1, the next 2, and so on. The number is the run's `version` field; it
is never written into the name, and the client never chooses it.

```python
run = cairn.Run("mnist", name="train")
run.version   # 3: the third "train" of the project
```

- **Never reused.** Each series keeps its highest number, so deleting `train`
  v3 does not make the next `train` v3 again: it is v4.
- **Rename or regroup: a new number.** A run whose name or group changes takes
  the next number of its new series; its old number stays taken in the old
  one (renaming back gives yet another new number).
- **Resume and shared runs keep it.** `resume=`, `rewind_to=`, and processes
  joining a run (`primary=False`, `cairn.attach`) continue the same run, with
  the same version.
- **A fork is a new run**, so it takes the next number of its series.
- **No name, no version**: an unnamed run's `version` is `None`.
- **Imported runs** ([run archives](import-export.md#run-archives)) take the
  next number of their series in the repo they are imported into; the number
  they had where they were exported is not kept.

Over HTTP the server returns the version when the run is created. On a local
repo the number is assigned when the run's log is ingested: the first read of
`run.version` catches up on the repo's logs (like `ArtifactVersion.wait()`),
and it is known from then on. Repos from before versions are numbered once,
per series in creation order, when a newer cairn first opens them.

The UI shows the version after a run's name (`train  v2`), and labels runs
that share a name `train v1`, `train v2` in charts and legends (adding the
group, `train v1 · exp-1`, when two groups both have a `train v1`). `cairn list`
has a `VERSION` column and `--sort version`; the [Reader](reading.md) has
`Run.version`.

## Several processes, one run

A distributed job (one process per GPU or node) can log into a single run, like wandb's
"shared" mode. Every process gets the same run ID. One process, the **primary**, creates the
run; the others are **workers** that join it with `primary=False` and a `label`:

```python
run = cairn.Run("llm", label="rank0")                          # primary: creates the run
run = cairn.Run("llm", label=f"rank{rank}", primary=False)     # workers: join it
run = cairn.attach(run_id, label="rank1")                      # the same as the line above
```

The ID comes from `run_id=` or the `CAIRN_RUN_ID` environment variable. Make one with
`cairn.new_run_id()` (32 hex characters; a hand-picked ID may use `A-Z a-z 0-9 _ -`, up to 64
characters). For the primary it is the ID of a new run: a run with that ID must not exist yet
(continue an existing one with [`resume`](#resume-rewind-and-fork) as usual). Workers require an
ID and a label.

What each process may do:

- **Everything a worker records lands in the run**: metrics and media, `config` and `summary`,
  artifacts it logs or uses, alerts.
- **Only the primary sets the status.** A worker's `finish()`, its exception or its exit only
  detaches it; the run stays `running` until the primary finishes, then has the primary's
  status (`completed`, `failed`, `killed`, `stopped`), whatever the workers do before or after.
- **Only the primary keeps the run alive.** A run whose primary went silent becomes `crashed`
  (or `killed`, over HTTP), however busy its workers are; a silent worker changes nothing.
- **A stop request reaches every process**: `run.should_stop`, `on_stop` callbacks and
  `stop_mode` work in workers as in the primary.
- **Labels name the processes.** A labelled process's [system metrics](#system-metrics-logs-and-code)
  are `system.<label>.*` (e.g. `system.rank1.gpu.0.util_percent`); an unlabelled primary keeps
  `system.*`.
  Each captured console line carries its process's label, and line numbers count per process.
  Labels use `A-Z a-z 0-9 _ -` and must be unique among the run's live processes: on a local repo
  a second live process with a taken label raises `ValueError` (checked with a file lock, so it
  is reliable on one machine but not on every network filesystem); over HTTP they are not checked.
- **Two processes logging the same series at the same step**: the point that is stored first
  wins and the other is dropped, with a [run alert](#alerts). Give per-process metrics their own names (`rank1.loss`) and log
  run-wide metrics from rank 0 only; synchronising them is up to your code.
- Workers do not upload a source snapshot or record their environment: those are the primary's.
  Integrations log from rank 0 only, as before.

`label="auto"` takes the label and the role from the launcher's rank, read from the first of
these variables that is set:

| Variable | Set by |
|---|---|
| `RANK` | `torchrun`, `accelerate`, DeepSpeed |
| `SLURM_PROCID` | SLURM (`srun`) |
| `SKYPILOT_NODE_RANK` | SkyPilot |
| `OMPI_COMM_WORLD_RANK` | Open MPI (`mpirun`) |
| `PMI_RANK` | MPICH, Intel MPI |

Rank 0 becomes the primary labelled `rank0`, rank N a worker labelled `rankN`. With none of them
set, the process is an ordinary primary without a label. An explicit `primary=` still wins over
the detected role.

**Launch with `CAIRN_RUN_ID`.** Make the ID before launching and let every process read it:

```bash
export CAIRN_RUN_ID=$(python -c "import cairn; print(cairn.new_run_id())")
srun python train.py        # or: torchrun --nproc-per-node 8 train.py
```

```python
with cairn.Run("llm", label="auto") as run:     # rank 0 creates, the others join
    for step in range(steps):
        loss = train_step()
        run.track(loss, f"rank{rank}.loss", step)
        if rank == 0:
            run.track(lr, "lr", step)
```

**Broadcast the ID with `torch.distributed`.** Rank 0 creates the run and sends its ID to the
other ranks:

```python
import torch.distributed as dist

ids = [None]
if dist.get_rank() == 0:
    run = cairn.Run("llm", label="rank0")
    ids = [run.id]
dist.broadcast_object_list(ids, src=0)
if dist.get_rank() != 0:
    run = cairn.attach(ids[0], label=f"rank{dist.get_rank()}")
```

**Add to a finished run from a later job.** An evaluation job can attach to a run that has
already finished; its status stays what the primary left:

```python
with cairn.attach(train_run_id, label="eval") as run:
    run.track(evaluate(model), "test.acc", last_step)
    run.summary(test_fid=fid)
```

To publish figures for a finished run, and replace them when you fix the script that makes
them, put them in the summary: see [Media in the summary](#media-in-the-summary).

A worker may start before its primary. On a local repo it starts logging at once; its records
wait until the primary's run exists, then apply in order. Over HTTP, and on a local repo when
you leave out `project`, a worker waits up to two minutes for the run to appear, then raises
`LookupError`.

On a local repo every process writes its own log: `.cairn/wals/<run_id>.wal.jsonl` for an
unlabelled process and `.cairn/wals/<run_id>~<label>.wal.jsonl` for a labelled one. A worker's
log ends with a *detach* record instead of a finish, and is deleted once ingested.

| wandb | cairn |
|---|---|
| `WANDB_RUN_ID` / `wandb.init(id=...)` | `CAIRN_RUN_ID` / `cairn.Run(run_id=...)` |
| `Settings(mode="shared")` | nothing to set: every run can be shared |
| `Settings(x_label="rank1")` | `label="rank1"` |
| `Settings(x_primary=False, x_update_finish_state=False)` | `primary=False`, or `cairn.attach(run_id, label)` |
| `Settings(x_primary=True)` | the default (`primary=True`) |

## Progress and ETA

Declare how many steps the run will take, and the UI shows how far it is: a bar and an ETA while
it runs (runs table, run page header, comparison overview), the percentage reached once it ended.

```python
run = cairn.Run("cifar10", total_steps=50_000)
run.total_steps = 60_000     # any time; None clears it
```

The **step-based progress** is the number of steps done, divided by `total_steps`: the highest
step the run logged so far, plus one (a loop counting from 0 has done `k + 1` steps at step `k`;
the count stops at `total_steps`, so a loop counting from 1 also ends at 100%). Every series counts
except `system.*` (whose steps are the sampler's counters). A rewind or fork recomputes it from the
history that is left.

When steps are not what you count, report progress yourself:

```python
for epoch in range(epochs):
    train_one_epoch()
    run.progress(epoch + 1, total=epochs)
```

`run.progress(i, total=None)` stores `i` and `total`; `total` defaults to the run's `total_steps`
(as it is when the run is read). Once a run called it, its value wins over the step-based one.
It is cheap to call every iteration: at most one value per second is sent, always the newest (a
held value goes out with the next heartbeat or at `finish()`). A disabled run accepts both as
no-ops. Both work on a local repo (records in the run's log) and against a server.

**The ETA rule.** Progress is sampled with the client's wall times: for steps, each point batch
gives (the newest wall time of its points, the highest step so far); for `run.progress`, each call
gives (its time, `i`). Samples are kept about 5 s apart, over the last 5 minutes (plus the newest
older sample, so a run whose steps are minutes apart still has two). Then

```text
rate = (value of newest sample - value of oldest kept sample) / (seconds between them)
eta  = max(0, (total - current) / rate)
```

The ETA is empty ("—") until the kept samples span at least 10 s with the value increasing, and
only a `running` run has one. It is the estimate as of the newest sample, without counting the
time since then.

Over the API, run rows (`/api/runs`, `/api/runs/{id}`, the Reader's local rows) carry
`progress: {fraction, current, total, unit, eta_seconds}` (`unit` is `"step"` or `"progress"`,
`fraction` is capped at 1), or `null` when the run has no total. The
[integrations](integrations.md#progress) set the total themselves.

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

cairn also raises a `warn` alert when it drops points, once per run and series, naming the
series and the step:

- **A duplicate step.** A series keeps one point per step: the first one written. Tracking a
  second, different point at a step the series already has (`run.track(x, "loss", 5)` twice,
  two processes logging one series, a resumed run logging steps again) drops the later point.
  The alert (also a warning in the log of the process that ingests the run) names the first step
  that was dropped; later duplicates of that series are not reported again. A copy of a point
  the client re-sent after a network error is not a duplicate.
- **Points of a summary media key** that another process tracked (see
  [Media in the summary](#media-in-the-summary)).

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
at 2 MB) is stored with the source snapshot; the run's overview links it as **Diff**.

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

## Media in the summary

A summary value can be media: any cairn wrapper (`cairn.Image`, `cairn.Figure`, `cairn.Video`,
`cairn.Audio`, `cairn.Html`, `cairn.Markdown`, `cairn.Text`, `cairn.Table`, `cairn.Tensor`,
`cairn.Data`, the 3D types, `cairn.Volume`, ...) or a list of them, which is a
[gallery](media.md#captions-and-galleries) under the same rules as in `track`. Media and plain
JSON values mix freely, at any depth:

```python
run.summary(showcase={
    "loss_landscape": cairn.Figure(fig),
    "samples": [cairn.Image(x) for x in samples],
    "seed": 0,
})
```

Each media value is ONE value with no step, named by its key's dotted path
(`showcase.loss_landscape`, `showcase.samples`):

- **Writing the key again replaces it.** The run keeps only the newest value; the old bytes are no
  longer referenced and [`cairn gc`](server.md#garbage-collection) frees them.
- **Deleting the key removes it**: `reader.run(id).edit().delete_keys("summary", ["showcase"])`.
- **Cards show it like a tracked series** of that name: it gets an automatic panel, the add-card
  flow offers it, comparisons and reports pick it up. Its card has no step slider. The run's
  Overview lists it in the summary tree by kind (`figure`, `6 images`), with a link to its card in
  Metrics & Media; media renders only there. The runs table has no column for it.
- **A name is either a tracked series or a summary media value.** `run.summary` with media under a
  name that has tracked points, or `run.track` under a summary media key, raises `ValueError`.
  (A write that slips past that check from another process at the same time is dropped at
  ingestion and raises a run [alert](#alerts).)
- `Reader(...).run(id).summary` returns a `MediaRef` for each media value (a gallery: a list of
  them), and so does `run.media("showcase.loss_landscape")`. `RunEditor.set_summary` takes media
  too.

**Re-run a showcase without re-training.** Make the figures in their own script that attaches to
the finished training run. Attaching never changes the run's status or its training data, and
each re-run replaces the figures:

```python
# showcase.py: run it again after fixing a bug; the figures are replaced
run = cairn.attach(train_run_id, label="showcase")
model = load_model(train_run_id)
run.summary(showcase={
    "loss_landscape": cairn.Figure(plot_landscape(model)),
    "samples": [cairn.Image(x) for x in sample(model, n=8)],
})
run.finish()
```

This is wandb's `run.summary["fig"] = wandb.Image(...)`.

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
    weights = run.use_artifact("resnet18-weights:best")      # records the lineage edge
    run.config(split="test", tta=True)
    run.track(evaluate(weights.file("model.pt")), "test.acc", 0)
```

`group` puts the training and evaluation runs together in the runs table, and `job_type="eval"`
lets you filter the evaluations. [`use_artifact`](artifacts.md) records exactly which model
version was evaluated, which appears on the lineage page.
