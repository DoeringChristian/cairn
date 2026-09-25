# Sweeps

A sweep searches a hyperparameter space. You describe the space once. cairn
then hands out one set of parameters per **trial**, each trial trains in its
own run, and the sweep keeps track of the best result.

There are two ways to drive a sweep. Both work on the same sweep object, so you
can mix them:

| Driver | What runs a trial | Use it when |
|---|---|---|
| `cairn.sweep(...).run(fn)` | A Python function, in this process or in `workers` subprocesses | Your training code is importable Python |
| `cairn sweep create` + `cairn agent` | A shell command, with the parameters appended as `--key=value` | Your training is a script, or you want agents on several machines |

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
| `count` | The maximum number of trials. `None` (the default) runs until the sweep hands out no more trials, i.e. until a grid is exhausted or the sweep is paused or cancelled. `random` and `bayes` sweeps never run out, so set `count` for them. |
| `workers` | Run trials in this many processes, started with `spawn`. A process holds only one active run, so `fn` must be picklable: define it at module level. `count` is split between the workers. |
| `**run_kwargs` | Passed to `cairn.Run`, e.g. `tags=[...]`, `capture_source=False` or `repo=...`. Each run is named after its trial unless you pass `name=`. |

`Sweep.run` returns the trials it ran, as the server reported them.

### Working with an existing sweep

```python
sw = cairn.Sweep("5c3da7160449efc4", project="mnist")
sw.info()     # the sweep, trial counts by status, the best trial, all trials
sw.trials     # trial dicts: index, name, params, status, value, run_id, ...
sw.best       # the best completed trial by metric and goal, or None
sw.pause(); sw.resume(); sw.cancel()
```

`cairn.sweep()` and `Sweep` both take `repo=`, which resolves like
`cairn.Run(repo=...)` (see [Configuration](../reference/configuration.md)).

## Quick start from the command line

Write a sweep file in the style of wandb's `sweep.yaml`:

```yaml
project: mnist
name: lr-search              # optional; used in trial run names
method: bayes                # grid | random | bayes (default: random)
metric: {name: val_loss, goal: minimize}
command: python train.py
parameters:
  lr: {min: 0.0001, max: 0.1, distribution: log_uniform}
  layers: {values: [2, 4, 8]}
```

Create the sweep, then start one or more agents:

```bash
cairn sweep create sweep.yaml
# created sweep 5c3da7160449efc4 (bayes, project mnist)
# run it with:  cairn agent 5c3da7160449efc4

cairn agent 5c3da7160449efc4             # run trials until the sweep is done
cairn agent 5c3da7160449efc4 --count 5   # or stop after 5 trials
```

`metric` can also be a plain string, with `goal:` as a separate top-level key.
`--project` on `cairn sweep create` overrides the file's `project`.

For each trial, the agent:

1. claims a trial;
2. runs `command` with the parameters appended as `--key=value` arguments
   (`python train.py --lr=0.0031 --layers=4`), with the environment variables
   `CAIRN_SWEEP_ID` and `CAIRN_TRIAL_ID` set;
3. reports the trial as `completed` if the command exits with 0, and as
   `failed` otherwise. The trial's value is read from the run's `metric`.

Strings and numbers are passed as Python prints them. Lists and dicts are
passed as JSON.

Your script needs no sweep-specific code. It parses its own arguments and opens
a run as usual:

```python
# train.py
import argparse
import cairn

p = argparse.ArgumentParser()
p.add_argument("--lr", type=float)
p.add_argument("--layers", type=int)
args = p.parse_args()

run = cairn.Run("mnist")  # joins the trial through CAIRN_SWEEP_ID / CAIRN_TRIAL_ID
for step in range(100):
    run.track(..., name="val_loss", step=step)
```

When `cairn.Run()` finds `CAIRN_SWEEP_ID` and `CAIRN_TRIAL_ID`, it links itself
to the trial, records the trial's parameters as its config, and takes the
trial's name unless you gave it a `name`. A trial keeps the first run that
joins it.

### Agents on several machines

Claiming a trial is atomic, so any number of agents can work on one sweep. Point
every agent at the same repo, either a shared filesystem path or a server:

```bash
cairn agent 5c3da7160449efc4 --repo cairn://tracking-host:4300
```

`--repo` also sets `CAIRN_REPO` for the command, so the trial's run writes to
the place the agent reads from. While a sweep is paused, agents wait and check
again every `--poll` seconds (default 5). When the sweep is cancelled or
finished, they exit.

A sweep created without a `command` (from Python, for example) cannot be run by
`cairn agent`. Use `cairn.Sweep(id).run(fn)` for it.

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
| `bayes` | Asks Optuna's TPE sampler for the next parameters, based on the completed trials that have a value. Never finishes on its own. | A `metric`, and the `[sweep]` extra: `pip install 'cairn-track[sweep]'` |

`goal` is `minimize` (the default) or `maximize`. It decides which trial is the
best one and which direction `bayes` optimizes in.

## Trials and runs

Trials are numbered from 1 in the order they are claimed. A trial's run is
named `<sweep name>-<n>`, or `<first 6 characters of the sweep id>-<n>` when the
sweep has no name, for example `lr-search-3` or `5c3da7-3`.

A trial's status is `running`, `completed`, `failed` or `killed`. Only
`completed` trials with a value count towards the best trial and towards the
`bayes` sampler.

## Sweep lifecycle

| Status | Hands out trials? | How it gets there |
|---|---|---|
| `running` | Yes | Created, or resumed |
| `paused` | No; agents wait | `pause` |
| `cancelled` | No; agents exit | `cancel`. Cannot be resumed. |
| `finished` | No; agents exit | A grid sweep ran out of combinations. Cannot be resumed. |

You can pause, resume and cancel a sweep from the CLI
(`cairn sweep pause|resume|cancel ID`), from Python (`Sweep.pause()` and so on),
or from the sweep's page in the web UI.

!!! note "No early termination"
    cairn has no scheduler that stops unpromising trials (such as Hyperband).
    A trial runs until your function returns or your command exits. If you stop
    a trial early yourself, its value is whatever the run logged.

## Commands

| Command | What it does |
|---|---|
| `cairn sweep create FILE [--project P] [--repo R]` | Creates a sweep from a YAML file |
| `cairn sweep ls [--project P] [--repo R]` | Lists sweeps, newest first, with status, method, trial count and best value |
| `cairn sweep pause\|resume\|cancel ID [--repo R]` | Changes a sweep's status |
| `cairn agent ID [--count N] [--poll S] [--repo R]` | Runs a sweep's trials |

Without `--repo`, these commands use `./.cairn` if it exists, and otherwise your
environment or config file. See the [CLI reference](../reference/cli.md) for
every option.

## In the web UI

Each project has a **Sweeps** page that lists every sweep with its status,
method, metric, best value and trial count. A sweep's own page shows the best
trial and one row per trial (status, value, parameters and a link to its run),
plus Pause, Resume and Cancel buttons.

## Distributed training without a sweep

If a scheduler already picks the parameters for you (Ray Tune, submitit/Slurm,
Dask, Kubernetes Jobs, Fabric), you do not need a cairn sweep. Open one
`cairn.Run` per job and point every job at the same repo: either a shared
directory (use `local_wal=True` there, see
[Server, auth and deployment](server.md#wal-mode)) or a `cairn://` server. The
[examples](../examples.md#distributed-and-parallel-training) show each setup.
