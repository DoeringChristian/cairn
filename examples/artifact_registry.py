"""Demo: Versioned artifact registry with lineage tracking.

Shows how to produce and consume versioned artifacts across runs,
building a lineage graph that the UI displays.

**Usage**::

    # Local mode
    uv run cairn init /tmp/cairn-registry
    CAIRN_REPO=/tmp/cairn-registry/.cairn uv run python examples/artifact_registry.py

    # Server mode
    CAIRN_SERVER=http://localhost:4300 uv run python examples/artifact_registry.py

    # Browse: http://localhost:4301/p/artifact-demo/artifacts
    #         http://localhost:4301/p/artifact-demo/lineage
"""

from __future__ import annotations

import json
import math
import random

import numpy as np

import cairn

PROJECT = "artifact-demo"


def make_dataset(seed: int, n_samples: int = 1000) -> dict:
    """Generate a fake dataset as a dict (serialized to JSON bytes)."""
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n_samples, 10))
    y = (X[:, 0] * 2 + X[:, 1] * -1 + rng.normal(scale=0.1, size=n_samples)).tolist()
    return {
        "X_shape": list(X.shape),
        "y_shape": [len(y)],
        "seed": seed,
        "n_samples": n_samples,
        "features": [f"feat_{i}" for i in range(10)],
        # Store just the summary; a real dataset would be a parquet/numpy file.
        "X_mean": X.mean(axis=0).tolist(),
        "y_mean": float(np.mean(y)),
    }


def make_model_weights(n_features: int = 10) -> bytes:
    """Generate fake model weights as a numpy array."""
    rng = np.random.default_rng(42)
    weights = rng.normal(size=(n_features, 1)).astype(np.float32)
    import io
    buf = io.BytesIO()
    np.save(buf, weights)
    return buf.getvalue()


def main() -> None:
    print(f"=== Artifact Registry Demo (project: {PROJECT}) ===\n")

    # ── Step 1: Create and version a dataset ─────────────────────────────
    print("Step 1: Creating dataset v0...")
    with cairn.Run(project=PROJECT, name="data-prep-v0", tags=["data-prep"]) as run:
        run["task"] = "prepare training data"
        run["seed"] = 42
        run["n_samples"] = 1000

        dataset = make_dataset(seed=42, n_samples=1000)
        data_bytes = json.dumps(dataset).encode("utf-8")

        art = run.log_artifact(
            data_bytes,
            name="training-data",
            type="dataset",
            metadata={
                "format": "json",
                "n_samples": 1000,
                "n_features": 10,
                "seed": 42,
            },
        )
        print(f"  → training-data v{art.version} (hash: {art.hash[:12]}...)")

    # ── Step 2: Train a model using the dataset ──────────────────────────
    print("\nStep 2: Training model using training-data:latest...")
    with cairn.Run(project=PROJECT, name="train-v0", tags=["training"]) as run:
        run["model"] = "linear_regression"
        run["lr"] = 0.01
        run["epochs"] = 100

        # Consume the dataset
        data_raw = run.use_artifact("training-data:latest", role="train")
        if isinstance(data_raw, bytes):
            dataset = json.loads(data_raw)
        else:
            dataset = data_raw
        print(f"  ← Loaded training-data (n_samples={dataset.get('n_samples', '?')})")

        # Simulate training with metrics
        for epoch in range(20):
            loss = 2.0 * math.exp(-epoch / 5) + random.gauss(0, 0.05)
            acc = min(0.95, 0.3 + epoch * 0.035 + random.gauss(0, 0.01))
            run.track(loss, name="train.loss", step=epoch)
            run.track(acc, name="train.accuracy", step=epoch)

        # Produce model weights
        weights = make_model_weights()
        model_art = run.log_artifact(
            weights,
            name="linear-model",
            type="model",
            metadata={
                "format": "numpy",
                "architecture": "linear_regression",
                "n_features": 10,
                "final_loss": round(loss, 4),
                "final_accuracy": round(acc, 4),
            },
        )
        print(f"  → linear-model v{model_art.version} (hash: {model_art.hash[:12]}...)")

    # ── Step 3: Evaluate the model ───────────────────────────────────────
    print("\nStep 3: Evaluating model...")
    with cairn.Run(project=PROJECT, name="eval-v0", tags=["evaluation"]) as run:
        run["task"] = "evaluate on test set"

        # Consume both the model and the dataset
        model_data = run.use_artifact("linear-model:latest", role="model")
        test_data = run.use_artifact("training-data:latest", role="test")
        print(f"  ← Loaded linear-model and training-data")

        # Simulate evaluation metrics
        run.track(0.12, name="eval.loss", step=0)
        run.track(0.93, name="eval.accuracy", step=0)
        run.track(0.91, name="eval.f1_score", step=0)

        # Produce an evaluation report artifact
        report = json.dumps({
            "test_loss": 0.12,
            "test_accuracy": 0.93,
            "test_f1": 0.91,
            "confusion_matrix": [[450, 50], [30, 470]],
        }).encode("utf-8")
        report_art = run.log_artifact(
            report,
            name="eval-report",
            type="report",
            metadata={"format": "json", "metrics": ["loss", "accuracy", "f1_score"]},
        )
        print(f"  → eval-report v{report_art.version}")

    # ── Step 4: Create a new version of the dataset and retrain ──────────
    print("\nStep 4: Creating improved dataset v1...")
    with cairn.Run(project=PROJECT, name="data-prep-v1", tags=["data-prep"]) as run:
        run["task"] = "prepare improved training data"
        run["seed"] = 123
        run["n_samples"] = 2000

        dataset_v1 = make_dataset(seed=123, n_samples=2000)
        data_bytes_v1 = json.dumps(dataset_v1).encode("utf-8")

        art_v1 = run.log_artifact(
            data_bytes_v1,
            name="training-data",
            type="dataset",
            metadata={
                "format": "json",
                "n_samples": 2000,
                "n_features": 10,
                "seed": 123,
            },
        )
        print(f"  → training-data v{art_v1.version} (now has 2 versions)")

    print("\nStep 5: Retraining on improved dataset...")
    with cairn.Run(project=PROJECT, name="train-v1", tags=["training"]) as run:
        run["model"] = "linear_regression"
        run["lr"] = 0.005
        run["epochs"] = 200

        # Consume the LATEST dataset (v1 now)
        data_raw = run.use_artifact("training-data:latest", role="train")

        for epoch in range(20):
            loss = 1.5 * math.exp(-epoch / 4) + random.gauss(0, 0.03)
            acc = min(0.98, 0.4 + epoch * 0.03 + random.gauss(0, 0.01))
            run.track(loss, name="train.loss", step=epoch)
            run.track(acc, name="train.accuracy", step=epoch)

        weights_v1 = make_model_weights(n_features=10)
        model_art_v1 = run.log_artifact(
            weights_v1,
            name="linear-model",
            type="model",
            metadata={
                "format": "numpy",
                "architecture": "linear_regression",
                "n_features": 10,
                "final_loss": round(loss, 4),
                "final_accuracy": round(acc, 4),
            },
            aliases=["latest", "best"],
        )
        print(f"  → linear-model v{model_art_v1.version} (aliased as 'best')")

    # ── Summary ──────────────────────────────────────────────────────────
    print("\n=== Summary ===")
    print("Artifact families created:")
    print("  - training-data (dataset): 2 versions")
    print("  - linear-model (model): 2 versions")
    print("  - eval-report (report): 1 version")
    print()
    print("Lineage graph:")
    print("  data-prep-v0 → training-data:v0 → train-v0 → linear-model:v0 → eval-v0 → eval-report:v0")
    print("                  training-data:v0 → eval-v0")
    print("  data-prep-v1 → training-data:v1 → train-v1 → linear-model:v1")
    print()
    print(f"Browse: http://localhost:4301/p/{PROJECT}/artifacts")
    print(f"Lineage: http://localhost:4301/p/{PROJECT}/lineage")


if __name__ == "__main__":
    main()
