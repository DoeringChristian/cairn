# Sweeps

A sweep searches a hyperparameter space. You describe the space once. cairn
then hands out one set of parameters per **trial**, each trial trains in its
own run, and the sweep keeps track of the best result.

There are two ways to drive a sweep. Both work on the same sweep object, so you
can mix them:

| Driver | What runs a trial | Use it when |
|---|---|---|
| `cairn.sweep(...).run(fn)` | A Python function, in this process or in `workers` subprocesses | Your training code is importable Python |
| `cairn sweep create` + `cairn agent` | A command (wandb's `program` and `command`), with the parameters where its args macros are | Your training is a script, or you want agents on several machines |

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
| `count` | The maximum number of trials. `None` (the default) runs until the sweep is stopped, cancelled or finished (a grid is exhausted, or `run_cap` is reached). `random` and `bayes` sweeps never finish on their own, so set `count` for them. While the sweep is paused, the workers wait and check again every 5 seconds. |
| `workers` | Run trials in this many processes, started with `spawn`. A process holds only one active run, so `fn` must be picklable: define it at module level. `count` is split between the workers. |
| `**run_kwargs` | Passed to `cairn.Run`, e.g. `tags=[...]`, `capture_source=False` or `repo=...`. Each run is named after its trial unless you pass `name=`. |

`Sweep.run` returns the trials it ran, as the server reported them. When the
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

## Quick start from the command line

Write a sweep file in the style of wandb's `sweep.yaml`:

```yaml
project: mnist
name: lr-search              # optional; used in trial run names
program: train.py
method: bayes                # grid | random | bayes (default: random)
metric: {name: val_loss, goal: minimize}
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
`project` is required, in the file or as `--project`, which overrides the
file's `project`.

For each trial, the agent:

1. claims a trial;
2. runs the sweep's `command` with its macros expanded (see
   [Program and command](#program-and-command)); the default command gives
   `/usr/bin/env /path/to/python train.py --lr=0.0031 --layers=4`. The
   environment variables `CAIRN_SWEEP_ID` and `CAIRN_TRIAL_ID` are set;
3. reports the trial as `completed` if the command exits with 0, and as
   `failed` otherwise. The trial's value is read from the run's `metric`.

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
again every `--poll` seconds (default 5). When the sweep is stopped, cancelled
or finished, they exit once they have no trial running.

A sweep created without a `command` (from Python, for example) cannot be run by
`cairn agent`. Use `cairn.Sweep(id).run(fn)` for it.

## The sweep file

These top-level keys are supported. Any other key is an error that names it,
both in `cairn sweep create` and when a sweep is created through the API.

| Key | Meaning |
|---|---|
| `project` | The project the trial runs go to. Required here or as `--project`. |
| `name` | Display name; used in trial run names. |
| `description` | Free text, stored with the sweep. |
| `method` | `grid`, `random` (the default) or `bayes`. See [Methods](#methods). |
| `metric` | `{name: ..., goal: ...}`, or a plain metric name with `goal` beside it. |
| `goal` | `minimize` (the default) or `maximize`, when `metric` is a plain name. |
| `parameters` | The search space. See [The search space](#the-search-space). |
| `program` | The training script, used by the `${program}` macro. |
| `command` | What the agent runs per trial. See [Program and command](#program-and-command). |
| `run_cap` | The maximum number of trials. See [Run cap](#run-cap). |

`cairn sweep create` needs a `program` or a `command`.

!!! note "Not supported"
    `early_terminate` (Hyperband) is not supported yet; a file that sets it
    fails with an error saying so. wandb's other keys, such as `entity`, are
    not supported either.

## Program and command

`command` is a list of arguments, as in wandb, or a string, which is split like
a shell would split it. Without a `command`, a sweep with a `program` runs
wandb's default:

```yaml
command:
  - ${env}
  - ${interpreter}
  - ${program}
  - ${args}
```

The agent expands these macros for each trial:

| Macro | Expands to |
|---|---|
| `${env}` | `/usr/bin/env`; nothing on Windows |
| `${interpreter}` | The Python the agent runs on (`sys.executable`) |
| `${program}` | The sweep's `program` |
| `${args}` | One `--key=value` argument per parameter |
| `${args_no_hyphens}` | One `key=value` argument per parameter (Hydra's override syntax) |
| `${args_no_boolean_flags}` | Like `${args}`, but a `True` parameter becomes `--key` and a `False` one is left out |
| `${args_json}` | The parameters as one JSON argument |
| `${args_json_file}` | The path of a temporary JSON file holding the parameters, deleted when the trial ends |

How they are substituted:

- A list item that is exactly a macro is replaced by its arguments: one per
  parameter for the three `args` forms, one for the others (none for `${env}`
  on Windows).
- Inside a longer item, `${env}`, `${interpreter}`, `${program}`,
  `${args_json}` and `${args_json_file}` are substituted as text, so
  `--config=${args_json_file}` works. The `args` forms are left as written
  there, as is any unknown `${...}`.
- The parameters appear only where an args macro is. A `command` without one
  passes no parameters on the command line; the trial's run still gets them as
  its config through `CAIRN_TRIAL_ID`.
- A `command` that uses `${program}` needs a `program`.

In `key=value` arguments, strings and numbers are written as Python prints
them (`True`, `0.001`); lists and dicts as JSON. A dotted parameter name such
as `optim.lr` keeps its dots (`--optim.lr=0.01`). Nested `parameters:` blocks
are not supported; use dotted names instead.

For example, this Hydra sweep passes `dataset=mnist` or `dataset=cifar10` to
`main.py`:

```yaml
program: main.py
method: bayes
metric:
  goal: maximize
  name: test/accuracy
parameters:
  dataset:
    values: [mnist, cifar10]
command:
  - ${env}
  - python
  - ${program}
  - ${args_no_hyphens}
```

## Run cap

`run_cap: N` stops a sweep from handing out trials once N have been claimed,
whatever their outcome. The next claim then marks the sweep `finished`, as an
exhausted grid does.

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

The lifecycle follows wandb's:

| Status | Hands out trials? | Running trials | How it gets there |
|---|---|---|---|
| `running` | Yes | Run | Created, or resumed |
| `paused` | No; agents wait | Run on | `pause` |
| `stopped` | No; agents exit | Finish normally | `stop` |
| `cancelled` | No; agents exit | Ended: each is marked `killed` and its run is asked to stop | `cancel` |
| `finished` | No; agents exit | Finish normally | A grid sweep ran out of combinations, or `run_cap` trials were claimed |

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

You can change a sweep's status from the CLI
(`cairn sweep pause|resume|stop|cancel ID`), from Python (`Sweep.pause()`,
`Sweep.resume()`, `Sweep.stop()`, `Sweep.cancel()`), or from the sweep's page
in the web UI.

!!! note "No early termination"
    cairn has no scheduler that stops unpromising trials (such as Hyperband).
    A trial runs until your function returns or your command exits. If you stop
    a trial early yourself, its value is whatever the run logged.

## Commands

| Command | What it does |
|---|---|
| `cairn sweep create FILE [--project P] [--repo R]` | Creates a sweep from a YAML file |
| `cairn sweep ls [--project P] [--repo R]` | Lists sweeps, newest first, with status, method, trial count and best value |
| `cairn sweep pause\|resume\|stop\|cancel ID [--repo R]` | Changes a sweep's status |
| `cairn agent ID [--count N] [--poll S] [--repo R]` | Runs a sweep's trials |

Without `--repo` (or `--server`), these commands use `CAIRN_REPO` or
`CAIRN_SERVER`, then the config file, then `./.cairn`, like every other data
command. See the [CLI reference](../reference/cli.md) for
every option.

## In the web UI

Each project has a **Sweeps** page that lists every sweep with its status,
method, metric, best value and trial count. A sweep's own page shows the best
trial and one row per trial (status, value, parameters and a link to its run),
plus the actions its status allows: Pause, Stop and Cancel while running;
Resume, Stop and Cancel while paused; Cancel when stopped.

## Distributed training without a sweep

If a scheduler already picks the parameters for you (Ray Tune, submitit/Slurm,
Dask, Kubernetes Jobs, Fabric), you do not need a cairn sweep. Open one
`cairn.Run` per job and point every job at the same repo: either a shared
directory (see [Clusters / SLURM](server.md#clusters-slurm)) or a `cairn://` server. The
[examples](../examples.md#distributed-and-parallel-training) show each setup.
