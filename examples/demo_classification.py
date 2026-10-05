"""Demo script for the classification presets — ``cairn.ConfusionMatrix``,
``cairn.ROCCurve`` and ``cairn.PRCurve``.

Logs two fake 3-class classifier runs whose predictions improve over a
handful of training steps (at different rates per run), so the same card can
be scrubbed through the step slider in the viewer *and* compared across runs.
The presets take the raw labels and scores; the SDK computes and stores the
counts and curves (with AUC / AP), and the viewer draws them.

Usage::

    uv run cairn init /tmp/cairn-classification
    CAIRN_REPO=/tmp/cairn-classification/.cairn uv run python examples/demo_classification.py
    uv run cairn ui --repo /tmp/cairn-classification/.cairn --port 4317

    # browse http://localhost:4317/
"""

from __future__ import annotations

import numpy as np

import cairn

CLASSES = ["cat", "dog", "bird"]
N_CLASSES = len(CLASSES)
N_PER_CLASS = 30
NUM_STEPS = 5

# Two runs, same metric names throughout, but a different learning rate
# (`confidence_scale`) and RNG seed so their curves are visibly distinct —
# what a cross-run comparison is meant to show off.
RUN_VARIANTS = [
    {"name": "fake-3class-classifier-a", "seed": 0, "confidence_scale": 1.0},
    {"name": "fake-3class-classifier-b", "seed": 1, "confidence_scale": 0.55},
]


def _softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=1, keepdims=True)
    exp = np.exp(shifted)
    return exp / exp.sum(axis=1, keepdims=True)


def simulate_predictions(
    y_true: np.ndarray,
    step: int,
    rng: np.random.Generator,
    confidence_scale: float = 1.0,
) -> np.ndarray:
    """Fake softmax output that sharpens toward the true class as `step` grows.

    Early steps look close to a coin flip; by the last step the classifier is
    confident and mostly correct, so the confusion matrix / ROC / PR cards
    visibly improve as you scrub the step slider. `confidence_scale` lets two
    runs of the same demo diverge (a slower-learning run stays noisier at the
    same step), so cross-run comparisons have something to show.
    """
    confidence = 0.5 + 1.8 * confidence_scale * (step / max(NUM_STEPS - 1, 1))
    logits = rng.normal(scale=0.6, size=(y_true.size, N_CLASSES))
    logits[np.arange(y_true.size), y_true] += confidence
    return _softmax(logits)


def run_variant(name: str, seed: int, confidence_scale: float) -> cairn.Run:
    run = cairn.Run(
        project="classification-demo",
        name=name,
        tags=["demo", "classification"],
        notes=(
            "Exercises the classification presets (ConfusionMatrix, ROCCurve, "
            "PRCurve) for a fake 3-class classifier across a few training steps."
        ),
    )

    rng = np.random.default_rng(seed)
    y_true = np.repeat(np.arange(N_CLASSES), N_PER_CLASS)
    rng.shuffle(y_true)

    for step in range(NUM_STEPS):
        probas = simulate_predictions(y_true, step, rng, confidence_scale)
        y_pred = probas.argmax(axis=1)

        accuracy = float((y_pred == y_true).mean())
        train_loss = max(0.05, 1.6 * np.exp(-confidence_scale * step / 2.0))
        val_loss = train_loss + 0.08 + 0.02 * step

        run.track(accuracy, name="eval.accuracy", step=step)
        run.track(train_loss, name="train.loss", step=step)
        run.track(val_loss, name="val.loss", step=step)

        # Confusion matrix of the argmax predictions.
        run.track(
            cairn.ConfusionMatrix(y_true, y_pred, class_names=CLASSES),
            name="eval.confusion_matrix",
            step=step,
        )
        # One-vs-rest ROC and PR curves from the class scores; AUC / AP per class.
        run.track(cairn.ROCCurve(y_true, probas, labels=CLASSES), name="eval.roc_curve", step=step)
        run.track(cairn.PRCurve(y_true, probas, labels=CLASSES), name="eval.pr_curve", step=step)

        print(
            f"step={step} accuracy={accuracy:.3f} train_loss={train_loss:.3f} "
            f"val_loss={val_loss:.3f}"
        )

    run.add_note(
        "Classification preset demo finished: eval.confusion_matrix, "
        "eval.roc_curve and eval.pr_curve, one point per step."
    )
    print("\nAll done. Run ID:", run.id)
    print("Open:", run.url)
    # Explicitly finish so the next variant's `cairn.Run()` isn't rejected as
    # a nested run (only one run may be active at a time per process).
    run.finish()
    return run


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")

    for variant in RUN_VARIANTS:
        print(f"\n=== {variant['name']} ===")
        run_variant(
            name=str(variant["name"]),
            seed=int(variant["seed"]),
            confidence_scale=float(variant["confidence_scale"]),
        )

    print(
        "\nAll runs done. Create a comparison in project 'classification-demo' "
        "across fake-3class-classifier-a and fake-3class-classifier-b."
    )


if __name__ == "__main__":
    main()
