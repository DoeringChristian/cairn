"""Demo for metric rules — ``run.track(..., summary=..., x=...)``: which value
a run reports for a metric, and which series a metric is plotted against.

Every metric has one *final value*: the number the runs table, the run
overview, the comparison table and query filters (``final_metric``) show.
It is resolved, per run, in this order:

1. an explicit ``run.summary(name=...)`` key;
2. the metric's rule, ``run.track(value, name, step, summary="min"|"max"|"mean"|"last")``;
3. otherwise the metric's last logged point.

A ``"min"`` rule also tells the comparison table that lower is better, so
the lowest value is green. Rules are applied when values are read, so they
never change the logged data.

``run.track(..., x="epoch")`` makes charts of the metric start on the
``epoch`` series as their x-axis (joined on step). ``x`` is always a full
series name, even inside a component's ``__cairn_track__``.

Rules match exact names and are only sent when they change, so passing
them on every call costs nothing. A call without the keywords leaves the
metric's rule as it is.

**Local mode**::

    uv run cairn init /tmp/cairn-metric-rules
    CAIRN_REPO=/tmp/cairn-metric-rules/.cairn uv run python examples/demo_metric_rules.py
    uv run cairn ui --repo /tmp/cairn-metric-rules/.cairn --port 4316

    # browse http://localhost:4316/
    #   - Runs table: loss / val.loss / val.acc / model.weight_norm columns
    #     show min / min / max / min.
    #   - A run's Overview → Metrics: the "From" column says min, max, last
    #     or summary for each metric.
    #   - Select all three runs → Compare → Overview: val.loss and loss are
    #     green where lowest, val.acc where highest.
    #   - Metrics & Media: val.* charts start on the "epoch" x-axis.
"""

from __future__ import annotations

import math
import random

import cairn

PROJECT = "metric-rules-demo"
STEPS = 300
STEPS_PER_EPOCH = 30

# (name, lr, step where validation is best) — each run overfits after that step,
# so its LAST val.loss is worse than its best.
RUNS = [("lr-1e-3", 1e-3, 240), ("lr-3e-3", 3e-3, 150), ("lr-1e-2", 1e-2, 60)]


class Model:
    """A component that declares its own rule: wherever it is mounted, its
    weight norm reports its minimum."""

    def __init__(self, lr: float) -> None:
        self.lr = lr
        self.weight_norm = 1.0

    def step(self, step: int) -> None:
        self.weight_norm = 1.0 + 0.5 * math.cos(step * self.lr * 20)

    def __cairn_track__(self, scope: cairn.Scope) -> None:
        # Lands as "model.weight_norm" with a "min" rule on that full name.
        scope.track(self.weight_norm, "weight_norm", summary="min")


def main() -> None:
    rng = random.Random(0)
    for name, lr, best_step in RUNS:
        run = cairn.Run(project=PROJECT, name=name)
        run.config(lr=lr, steps=STEPS)
        model = Model(lr)

        for step in range(STEPS):
            model.step(step)
            # Lower is better for every loss, higher for accuracy. Without
            # these rules each would show its LAST value, i.e. after overfitting.
            run.track(math.exp(-step * lr * 3) + 0.02 * rng.random(), "loss", step,
                      summary="min")
            run.track(model, "model", step)
            if step % STEPS_PER_EPOCH == 0:
                # Validation: improves until best_step, then overfits.
                gap = abs(step - best_step) / STEPS / 2
                run.track(step // STEPS_PER_EPOCH, "epoch", step)
                run.track(0.2 + gap + 0.01 * rng.random(), "val.loss", step,
                          summary="min", x="epoch")
                run.track(0.9 - gap + 0.01 * rng.random(), "val.acc", step,
                          summary="max", x="epoch")

        # An explicit summary key wins over any rule.
        run.summary(best_epoch=best_step // STEPS_PER_EPOCH)
        run.finish()
        print(f"{name}: logged {STEPS} steps")


if __name__ == "__main__":
    main()
