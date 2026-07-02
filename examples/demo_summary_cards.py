"""Demo for Workstream E — summary cards (bar chart, scalar tile, comparer).

Seeds four runs with distinct final scalar metrics + differing params so the
BarChartCard, ScalarTileCard, and the Comparison Overview metrics/diff table
all have deterministic, self-explanatory data to render.

**Local mode**::

    uv run cairn init /tmp/cairn-summary
    CAIRN_REPO=/tmp/cairn-summary/.cairn uv run python examples/demo_summary_cards.py
    uv run cairn ui --repo /tmp/cairn-summary/.cairn --port 4315

    # browse http://localhost:4315/
    # Open a project → Compare → create a comparison, add all four runs, then:
    #   - Add card → Bar Chart → settings: metric = final.accuracy → bars sorted
    #     descending, one per run, click a bar to select the run.
    #   - Add card → Scalar Tile → metric = final.accuracy, Across runs = Best.
    #   - Overview tab → Metrics table + "Only show differences" toggle.

Each run trains for 40 steps; the four runs deliberately converge to different
final accuracy / loss so the bars and tiles are visually distinct.
"""

from __future__ import annotations

import math
import random

import cairn

PROJECT = "summary-cards-demo"

# (name, lr, optimizer, final_accuracy, final_loss) — distinct finals per run.
RUNS = [
    ("baseline", 1e-3, "adamw", 0.82, 0.45),
    ("tuned-lr", 3e-4, "adamw", 0.91, 0.28),
    ("sgd-momentum", 1e-2, "sgd", 0.76, 0.58),
    ("big-batch", 5e-4, "adamw", 0.88, 0.33),
]

NUM_STEPS = 40


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}\n")

    for name, lr, optimizer, final_acc, final_loss in RUNS:
        rng = random.Random(hash(name) & 0xFFFF)
        run = cairn.Run(
            project=PROJECT,
            name=name,
            tags=["summary-demo"],
            notes=f"Converges to acc={final_acc}, loss={final_loss}.",
            capture_source=False,
            capture_stdout=False,
            capture_env=True,
            capture_system_metrics=False,
        )

        # Params — lr + optimizer differ across runs; batch_size is shared so
        # the "only show differences" toggle has something to hide.
        run["hparams"] = {
            "lr": lr,
            "optimizer": optimizer,
            "batch_size": 32,
            "epochs": NUM_STEPS,
        }

        # Scalar curves that smoothly approach each run's distinct final value.
        for step in range(NUM_STEPS):
            frac = step / (NUM_STEPS - 1)
            # accuracy rises to final_acc; loss decays to final_loss.
            acc = final_acc * (1 - math.exp(-3.0 * frac)) + rng.uniform(-0.01, 0.01)
            loss = (
                final_loss
                + (2.0 - final_loss) * math.exp(-3.0 * frac)
                + rng.uniform(-0.01, 0.01)
            )
            run.track(acc, name="final.accuracy", step=step)
            run.track(loss, name="final.loss", step=step)
            run.track(rng.uniform(0.3, 1.2), name="grad_norm", step=step)

        # Pin the exact final value on the last step so tiles/bars are exact.
        run.track(final_acc, name="final.accuracy", step=NUM_STEPS)
        run.track(final_loss, name="final.loss", step=NUM_STEPS)

        run.finish()
        print(f"  logged run '{name}': final.accuracy={final_acc} final.loss={final_loss}")

    print(f"\nDone. {len(RUNS)} runs in project '{PROJECT}'.")


if __name__ == "__main__":
    main()
