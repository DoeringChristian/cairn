# Sweeps

A sweep searches a hyperparameter space. You describe the space once. cairn
then hands out one set of parameters per **trial**, each trial trains in its
own run, and the sweep keeps track of the best result.

Drive a sweep with `cairn.sweep(...).run(fn)`. Each trial calls a Python
function in this process or in spawned worker processes. Workers can also run
on several machines against one remote server.

## Quick start from Python

```python
import cairn

def train(config, run):
    for step in range(100):
        loss = ...  # train with config["lr"] and config["layers"]
        run.track(loss, name="loss", step=step)
    return loss  # optional: the trial's value

sw = cairn.sweep(
    {
        "lr": {"min": 1e-4, "max": 1e-1, "distribution": "log_uniform"},
        "layers": {"values": [2, 4, 8]},
    },
    project="mnist",
    metric="loss",
    goal="minimize",
    method="bayes",
)
sw.run(train, count=20)
print(sw.best)  # the best completed trial: params, value, run_id, name, ...
```

`fn` can take `(config)` or `(config, run)`:

- `config` is the trial's parameters. They are also recorded as the run's config.
- `run` is an open `cairn.Run` that is already linked to the trial.
  `Sweep.run` finishes it for you.

If `fn` returns a number, that number is the trial's value. Otherwise the value
is the run's final value for the sweep's `metric`, which is the number the runs
table shows (see [Final values and metric rules](metric-rules.md)).

If `fn` raises an exception, the trial and its run are marked `failed` and the
sweep moves on to the next trial. A `KeyboardInterrupt` marks both `killed` and
stops the loop.

### `Sweep.run` options

| Argument | Meaning |
|---|---|
| `count` | The maximum number of trials. `None` (the default) runs until the sweep is stopped, cancelled or finished (a grid is exhausted). `random` and `bayes` sweeps never finish on their own, so set `count` for them. While the sweep is paused, the workers wait and check again every 5 seconds. |
| `workers` | Run trials in this many processes, started with `spawn`. A process holds only one active run, so `fn` must be picklable: define it at module level. `count` is split between the workers. |
| `**run_kwargs` | Passed to `cairn.Run`, e.g. `tags=[...]`, `capture_source=False` or `repo=...`. Each run is named after its trial unless you pass `name=`. |

`Sweep.run` returns the trials it ran, as the backend reported them. When the
sweep is cancelled, a trial's run is asked to stop like the UI's Stop button
does; the run ends `stopped`, the trial is `killed`, and the worker returns at
its next claim.

### Working with an existing sweep

```python
sw = cairn.Sweep("5c3da7160449efc4", project="mnist")
sw.info()     # the sweep, trial counts by status, the best trial, all trials
sw.trials     # trial dicts: index, name, params, status, value, run_id, ...
sw.best       # the best completed trial by metric and goal, or None
sw.pause(); sw.resume(); sw.stop(); sw.cancel()
```

`cairn.sweep()` and `Sweep` both take `repo=`, which resolves like
`cairn.Run(repo=...)` (see [Configuration](../reference/configuration.md)).

## Workers on several machines

Each worker opens the same sweep ID and server URL, then calls `run` with the
same importable training function:

```python
sw = cairn.Sweep(
    "5c3da7160449efc4", project="mnist", repo="https://tracking.example.org",
)
sw.run(train, count=5)
```

Claiming a trial is atomic, so workers receive distinct trials. `count` limits
this worker's calls, not the total across all workers. For multiple processes
on one machine, use `workers=N` and guard the entry point with
`if __name__ == "__main__":`.

## The search space

Each parameter is one of:

| Spec | Meaning |
|---|---|
| `{values: [a, b, c]}` | Categorical: one of the listed values |
| `{min: 0.0, max: 0.1}` | A uniform float in `[min, max]` |
| `{min: 1, max: 4}` | Both bounds are integers, so a uniform integer (`int_uniform`) |
| `{min: 1e-5, max: 1e-1, distribution: log_uniform}` | A log-uniform float; needs `min > 0` |
| `{min: …, max: …, distribution: uniform}` | Sets the distribution explicitly (`uniform`, `log_uniform` or `int_uniform`) |
| `{value: 32}`, or just `32` | A constant |

The space is checked when you create the sweep. An empty space, `min > max`,
non-numeric bounds, an unknown distribution, or a range in a grid sweep is an
error.

## Methods

| Method | Behaviour | Needs |
|---|---|---|
| `grid` | Walks the product of every `values` list, in the order the parameters are listed, then marks the sweep `finished`. Ranges are not allowed. | — |
| `random` | Samples every parameter independently. Never finishes on its own. | — |
| `bayes` | Asks Optuna's TPE sampler for the next parameters, based on the completed trials that have a value. Never finishes on its own. | A `metric`, and the `[sweep]` extra: `pip install 'cairn-track[sweep] @ git+https://github.com/DoeringChristian/cairn@v0.7.0'` |

`goal` is `minimize` or `maximize`. It decides which trial is the best one and
which direction `bayes` optimizes in. Without a `goal`, the sweep takes the
metric's goal in the project when it is created: `maximize` when higher is
better (a `track(..., summary="max")` rule or a [project
override](metric-rules.md#project-overrides)), else `minimize`.

## Trials and runs

Trials are numbered from 1 in the order they are claimed. A trial's run is
named `<sweep name>-<n>`, or `<first 6 characters of the sweep id>-<n>` when the
sweep has no name, for example `lr-search-3` or `5c3da7-3`.

A trial's status is `running`, `completed`, `failed` or `killed`. Only
`completed` trials with a value count towards the best trial and towards the
`bayes` sampler.

## Sweep lifecycle

The lifecycle follows wandb's:

| Status | Hands out trials? | Running trials | How it gets there |
|---|---|---|---|
| `running` | Yes | Run | Created, or resumed |
| `paused` | No; workers wait | Run on | `pause` |
| `stopped` | No; workers return | Finish normally | `stop` |
| `cancelled` | No; workers return | Ended: each is marked `killed` and its run is asked to stop | `cancel` |
| `finished` | No; workers return | Finish normally | A grid sweep ran out of combinations |

The actions each status allows; any other is an error:

| Status | Actions |
|---|---|
| `running` | `pause`, `stop`, `cancel` |
| `paused` | `resume`, `stop`, `cancel` |
| `stopped` | `cancel` (to end the trials still running) |
| `cancelled`, `finished` | none |

`cancel` asks each running trial's run to stop the way the run page's Stop
button does: `run.should_stop` turns true, the `on_stop` callbacks run, and the
main thread is interrupted unless the run uses `stop_mode="flag"` (see
[Stopping a run from the UI](runs.md#stopping-a-run-from-the-ui)). The run
ends `stopped`; the trial stays `killed` however its process exits.

Change a sweep's status from Python (`Sweep.pause()`, `Sweep.resume()`,
`Sweep.stop()`, `Sweep.cancel()`) or from the sweep's page in the web UI.

!!! note "No early termination"
    cairn has no scheduler that stops unpromising trials (such as Hyperband).
    A trial runs until your function returns. If you stop
    a trial early yourself, its value is whatever the run logged.

## In the web UI

Each project has a **Sweeps** page that lists every sweep with its status,
method, metric, best value and trial count. A sweep's own page shows the best
trial, a [parallel coordinates](../ui/cards.md#parallel-coordinates) card over the
searched parameters and the metric (log axes for log-scaled parameters) next to a scatter plot
of the first parameter against the metric, and one row per trial (status, value, parameters
and a link to its run), plus the actions its status allows: Pause, Stop and Cancel while running;
Resume, Stop and Cancel while paused; Cancel when stopped.

## Distributed training without a sweep

If a scheduler already picks the parameters for you (Ray Tune, submitit/Slurm,
Dask, Kubernetes Jobs, Fabric), you do not need a cairn sweep. Open one
`cairn.Run` per job and point every job at the same remote server. Keep SQLite
on the server's local disk; do not put its database on a shared network filesystem. The
[examples](../examples.md#distributed-and-parallel-training) show each setup.
