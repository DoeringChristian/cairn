# Final values and metric rules

A metric is a whole series, but the runs table, the run overview and the comparison views need
one number per run. This page explains which number that is and how you control it.

## The final value

Each scalar metric has exactly one final value per run. cairn resolves it in this order, and the
first match wins:

1. An explicit **summary key** with the metric's name: `run.summary({"val.loss": 0.21})`.
2. The metric's **rule**, set with `run.track(..., summary="min")`.
3. The **last logged point**, meaning the one with the highest step.

Rules are applied when the data is read. They never change the logged points, so you can always
see the full series.

## `summary=`: how a metric is summarized

```python
run.track(val_loss, "val.loss", step, summary="min")   # report the best loss
run.track(val_acc, "val.acc", step, summary="max")     # report the best accuracy
run.track(reward, "episode.reward", step, summary="mean")
```

| Rule | Final value |
|---|---|
| `"last"` (default) | the point with the highest step |
| `"min"` | the smallest value in the series |
| `"max"` | the largest value in the series |
| `"mean"` | the mean of all points in the series |

A rule also tells the UI which direction is better: with `"min"`, lower values count as better
when runs are compared.

## `x=`: the default x-axis

`x=` names another scalar series to plot this metric against. The two series are joined on step:

```python
for step in range(total_steps):
    run.track(step / steps_per_epoch, "epoch", step)
    if step % eval_every == 0:
        run.track(val_loss, "val.loss", step, summary="min", x="epoch")
```

Charts of `val.loss` then start with `epoch` on the x-axis. You can still switch the axis in the
UI. `x` is always the **full** name of the other series. It is never prefixed by a
[scope](scopes.md), so a component can write `scope.track(loss, "loss", x="epoch")` and plot
against the run's top-level `epoch` series wherever the component is mounted.

## How rules behave

- **Scalars only.** `summary=` and `x=` apply to scalar metrics. Passing them with an image,
  table, gallery or component raises `ValueError`.
- **Exact name.** A rule belongs to one metric name in one run. Inside a component,
  `scope.track(v, "loss", summary="min")` sets the rule for the full, prefixed name, such as
  `model.loss`.
- **Fields merge.** A keyword you pass replaces that part of the rule, and a keyword you leave out
  keeps its earlier value. `summary="min"` on one call and `x="epoch"` on a later call gives both.
- **Cheap to repeat.** The SDK sends a rule only when it changes, so passing it on every `track`
  call costs nothing.
- **Set by tracking.** A rule is set by passing the keyword with a point. Rules can't be removed
  once set, but you can switch to another kind, including `"last"`.
- **Carried along.** Rules persist when you resume a run and are copied when you fork one.

## Overriding with `summary`

An explicit summary key beats any rule. Use it when the number you want to report isn't a simple
function of the series. For example, you might report the accuracy of the checkpoint you actually
kept:

```python
run.track(val_acc, "val.acc", step, summary="max")
...
run.summary({"val.acc": acc_of_selected_checkpoint})   # the runs table shows this
```

Nested dictionaries are flattened, so `run.summary({"val": {"acc": 0.9}})` sets `val.acc`.

## Reading final values in Python

`Run.final` on a [`cairn.Reader`](reading.md) run returns every metric's final value, resolved
exactly as the runs table resolves it:

```python
import cairn

run = cairn.Reader().run(run_id)
run.final      # {"val.loss": 0.21, "val.acc": 0.93, "epoch": 9.0, "test.acc": 0.91, ...}
run.summary    # only the keys you set with run.summary(...)
```

`Run.final` also includes summary keys that are not metrics, and system metrics
(`system.*`).
