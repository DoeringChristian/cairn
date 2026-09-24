"""Demo for ``run.define_metric`` — which value a run reports for a metric,
and which series a metric is plotted against.

Every metric has one *final value*: the number the runs table, the run
overview, the comparison table and query filters (``final_metric``) show.
It is resolved, per run, in this order:

1. an explicit ``run.summary(name=...)`` key;
2. a ``run.define_metric(name, summary="min"|"max"|"mean"|"last")`` rule
   (``name`` may be an fnmatch glob; an exact name beats a glob, and the
   longest glob wins among globs);
3. otherwise the metric's last logged point.

A ``"min"`` rule also tells the comparison table that lower is better, so
the lowest value is green. Rules are applied when values are read, so they
never change the logged data.

``define_metric(..., step_metric="epoch")`` makes charts of the metric start
on the ``epoch`` series as their x-axis (joined on step).

**Local mode**::

    uv run cairn init /tmp/cairn-define-metric
    CAIRN_REPO=/tmp/cairn-define-metric/.cairn uv run python examples/demo_define_metric.py
    uv run cairn ui --repo /tmp/cairn-define-metric/.cairn --port 4316

    # browse http://localhost:4316/
    #   - Runs table: loss / val/loss / val/acc columns show min / min / max.
    #   - A run's Overview → Metrics: the "From" column says min, max, last
    #     or summary for each metric.
    #   - Select all three runs → Compare → Overview: val/loss and loss are
    #     green where lowest, val/acc where highest.
    #   - Metrics & Media: val/* charts start on the "epoch" x-axis.
"""

from __future__ import annotations

import math
import random

import cairn

PROJECT = "define-metric-demo"
STEPS = 300
STEPS_PER_EPOCH = 30

# (name, lr, step where validation is best) — each run overfits after that step,
# so its LAST val/loss is worse than its best.
RUNS = [("lr-1e-3", 1e-3, 240), ("lr-3e-3", 3e-3, 150), ("lr-1e-2", 1e-2, 60)]


def main() -> None:
    rng = random.Random(0)
    for name, lr, best_step in RUNS:
        run = cairn.Run(project=PROJECT, name=name)
        run.config(lr=lr, steps=STEPS)

        # Lower is better for every loss, higher for accuracy. Without these
        # rules each would show its LAST value, i.e. after overfitting.
        run.define_metric("loss", summary="min")
        run.define_metric("val/*", step_metric="epoch", summary="min")
        run.define_metric("val/acc", summary="max")  # exact name beats "val/*"

        for step in range(STEPS):
            run.track(math.exp(-step * lr * 3) + 0.02 * rng.random(), name="loss", step=step)
            if step % STEPS_PER_EPOCH == 0:
                # Validation: improves until best_step, then overfits.
                gap = abs(step - best_step) / STEPS / 2
                run.track(step // STEPS_PER_EPOCH, name="epoch", step=step)
                run.track(0.2 + gap + 0.01 * rng.random(), name="val/loss", step=step)
                run.track(0.9 - gap + 0.01 * rng.random(), name="val/acc", step=step)

        # An explicit summary key wins over any rule.
        run.summary(best_epoch=best_step // STEPS_PER_EPOCH)
        run.finish()
        print(f"{name}: logged {STEPS} steps")


if __name__ == "__main__":
    main()
