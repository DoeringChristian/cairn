"""Demo script for ``cairn.plot`` — SDK plot helpers (Workstream G).

Exercises every helper (confusion_matrix, pr_curve, roc_curve, bar,
line_series) against a fake 3-class classifier whose predictions improve
over a handful of training steps, so the same card can be scrubbed through
the step slider in the viewer.

Zero UI changes: every figure returned by ``cairn.plot.*`` is a plain
``plotly.graph_objects.Figure`` that flows through the existing ``figure``
card/handler pipeline (see ``cairn/sdk/handlers/figure.py``) — nothing here
is new UI surface.

Usage::

    uv run cairn init /tmp/cairn-plot-helpers
    CAIRN_REPO=/tmp/cairn-plot-helpers/.cairn uv run python examples/demo_plot_helpers.py
    uv run cairn ui --repo /tmp/cairn-plot-helpers/.cairn --port 4317

    # browse http://localhost:4317/
"""

from __future__ import annotations

import numpy as np

import cairn

CLASSES = ["cat", "dog", "bird"]
N_CLASSES = len(CLASSES)
N_PER_CLASS = 30
NUM_STEPS = 5


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=1, keepdims=True)


def simulate_predictions(y_true: np.ndarray, step: int, rng: np.random.Generator) -> np.ndarray:
    """Fake softmax output that sharpens toward the true class as `step` grows.

    Early steps look close to a coin flip; by the last step the classifier is
    confident and mostly correct, so the confusion matrix / ROC / PR cards
    visibly improve as you scrub the step slider.
    """
    confidence = 0.5 + 1.8 * (step / max(NUM_STEPS - 1, 1))
    logits = rng.normal(scale=0.6, size=(y_true.size, N_CLASSES))
    logits[np.arange(y_true.size), y_true] += confidence
    return _softmax(logits)


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")

    run = cairn.Run(
        project="plot-helpers-demo",
        name="fake-3class-classifier",
        tags=["demo", "plot-helpers"],
        notes=(
            "Exercises every cairn.plot helper (confusion_matrix, pr_curve, "
            "roc_curve, bar, line_series) for a fake 3-class classifier "
            "across a few training steps."
        ),
    )

    rng = np.random.default_rng(0)
    y_true = np.repeat(np.arange(N_CLASSES), N_PER_CLASS)
    rng.shuffle(y_true)

    train_losses: list[float] = []
    val_losses: list[float] = []

    for step in range(NUM_STEPS):
        probas = simulate_predictions(y_true, step, rng)
        y_pred = probas.argmax(axis=1)

        accuracy = float((y_pred == y_true).mean())
        train_loss = max(0.05, 1.6 * np.exp(-step / 2.0))
        val_loss = train_loss + 0.08 + 0.02 * step
        train_losses.append(train_loss)
        val_losses.append(val_loss)

        run.track(accuracy, name="eval.accuracy", step=step)
        run.track(train_loss, name="train.loss", step=step)
        run.track(val_loss, name="train.loss", step=step, context={"subset": "val"})

        # 1. confusion_matrix — raw counts.
        run.track(
            cairn.plot.confusion_matrix(y_true, y_pred, class_names=CLASSES),
            name="eval.confusion_matrix",
            step=step,
        )
        # ... and the row-normalized ("true") variant, same data, different view.
        run.track(
            cairn.plot.confusion_matrix(
                y_true, y_pred, class_names=CLASSES, normalize="true"
            ),
            name="eval.confusion_matrix_normalized",
            step=step,
        )

        # 2. roc_curve — one-vs-rest, 3 class traces + chance diagonal, AUC
        #    in each trace's legend name.
        run.track(
            cairn.plot.roc_curve(y_true, probas, labels=CLASSES),
            name="eval.roc_curve",
            step=step,
        )

        # 3. pr_curve — one-vs-rest, interpolated precision envelope, AP in
        #    each trace's legend name.
        run.track(
            cairn.plot.pr_curve(y_true, probas, labels=CLASSES),
            name="eval.pr_curve",
            step=step,
        )

        # 4. bar — per-class accuracy this step.
        per_class_acc = [
            float((y_pred[y_true == c] == c).mean()) for c in range(N_CLASSES)
        ]
        run.track(
            cairn.plot.bar(
                CLASSES, per_class_acc, title=f"Per-class accuracy (step {step})"
            ),
            name="eval.per_class_accuracy",
            step=step,
        )

        print(
            f"step={step} accuracy={accuracy:.3f} train_loss={train_loss:.3f} "
            f"val_loss={val_loss:.3f}"
        )

    # 5. line_series — thin convenience, one shot at the end summarizing the
    #    whole run's loss history (two series sharing the step axis).
    run.track(
        cairn.plot.line_series(
            list(range(NUM_STEPS)),
            [train_losses, val_losses],
            keys=["train_loss", "val_loss"],
            title="Loss curves",
        ),
        name="eval.loss_curves",
        step=NUM_STEPS - 1,
    )

    run.add_note(
        "cairn.plot demo finished. Check the Media tab for "
        "eval.confusion_matrix[_normalized], eval.roc_curve, eval.pr_curve, "
        "eval.per_class_accuracy (bar) and eval.loss_curves (line_series) — "
        "all rendered as `figure` cards backed by Plotly source."
    )
    print("\nAll done. Run ID:", run.id)
    print("Open:", run.url)


if __name__ == "__main__":
    main()
