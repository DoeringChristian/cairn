"""Demo: Table cards.

Logs two runs so the multi-run comparison panes can be exercised. Each run
logs:

  * ``predictions`` — a per-epoch table of 1,000 rows with mixed column types
    (int id, string class, string prediction, float probability, bool correct).
    Evolves over several steps so the step slider has something to move through.
  * ``summary`` — a small end-of-run metrics table (a handful of rows).

Exercise in the UI: sort any column (click header — numeric columns sort
numerically), type in the filter box, page through (100 rows/page), move the
step slider, download the current table as CSV, toggle column visibility and
rows-per-page in settings, and open a comparison of both runs to see one table
pane per run.

Usage::

    uv run cairn init /tmp/cairn-table
    CAIRN_REPO=/tmp/cairn-table/.cairn uv run python examples/demo_table.py
    uv run cairn ui --repo /tmp/cairn-table/.cairn --port 4312
    # browse http://localhost:4312/
"""

from __future__ import annotations

import random

import cairn

PROJECT = "table-demo"
NUM_STEPS = 5
N_ROWS = 1000
CLASSES = ["cat", "dog", "bird", "fish", "horse"]


def make_predictions_table(step: int, seed: int) -> cairn.Table:
    """A 1,000-row predictions table; accuracy improves with the step."""
    rng = random.Random(seed * 1000 + step)
    # Later steps => higher chance the prediction matches the label.
    correct_prob = 0.5 + 0.09 * step
    columns = ["id", "true_label", "pred_label", "confidence", "correct"]
    data = []
    for i in range(N_ROWS):
        true_label = rng.choice(CLASSES)
        is_correct = rng.random() < correct_prob
        if is_correct:
            pred_label = true_label
            conf = round(rng.uniform(0.6, 0.99), 4)
        else:
            pred_label = rng.choice([c for c in CLASSES if c != true_label])
            conf = round(rng.uniform(0.3, 0.7), 4)
        data.append([i, true_label, pred_label, conf, is_correct])
    return cairn.Table(columns=columns, data=data)


def make_summary_table(accuracy: float, loss: float) -> cairn.Table:
    """A small metrics summary table (mixed types)."""
    return cairn.Table(
        columns=["metric", "value", "improved"],
        data=[
            ["accuracy", round(accuracy, 4), True],
            ["loss", round(loss, 4), True],
            ["num_samples", N_ROWS, False],
            ["notes", "held-out validation split", False],
        ],
    )


def log_run(name: str, seed: int) -> None:
    run = cairn.Run(project=PROJECT, name=name, tags=["table-demo"])
    run["config"] = {"seed": seed, "n_rows": N_ROWS}

    final_acc = 0.0
    for step in range(NUM_STEPS):
        table = make_predictions_table(step, seed)
        run.track(table, name="predictions", step=step)

        # Track accuracy for the summary + a scalar so the run has a metric.
        correct = sum(1 for row in table.obj["data"] if row[4])
        acc = correct / N_ROWS
        final_acc = acc
        run.track(float(acc), name="accuracy", step=step)

    run.track(
        make_summary_table(final_acc, loss=1.0 - final_acc),
        name="summary",
        step=NUM_STEPS - 1,
    )
    run.finish()
    print(f"  done: {name} (final accuracy {final_acc:.3f})")


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")

    log_run("run-a", seed=1)
    log_run("run-b", seed=2)

    print(
        "\nDone. Open the UI, add a 'Tables' card for `predictions`, and try "
        "sort/filter/pagination/CSV. Create a comparison of run-a + run-b to "
        "see one table pane per run."
    )


if __name__ == "__main__":
    main()
