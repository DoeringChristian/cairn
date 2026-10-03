"""Demo: versioned artifacts with lineage.

A data-prep run logs a dataset (a directory, a reference and a generated
file), a training run consumes it and logs a checkpoint per epoch with a
moving ``best`` alias, an evaluation run consumes the best checkpoint, and a
reader walks the lineage back.

**Usage**::

    # Local mode
    uv run cairn init /tmp/cairn-registry
    CAIRN_REPO=/tmp/cairn-registry/.cairn uv run python examples/artifact_registry.py
    uv run cairn ui --repo /tmp/cairn-registry/.cairn

    # Server mode (ingest :4300, UI :4301; --no-auth for a local demo, or keep
    # auth and export the CAIRN_TOKEN the server prints)
    uv run cairn server --repo /tmp/cairn-registry/.cairn --ui --no-auth
    CAIRN_SERVER=http://localhost:4300 uv run python examples/artifact_registry.py

    # Browse: http://localhost:4301/p/artifact-demo/artifacts
    #         http://localhost:4301/p/artifact-demo/lineage
"""

from __future__ import annotations

import json
import math
import random
import tempfile
from pathlib import Path

import numpy as np

import cairn

PROJECT = "artifact-demo"


def write_dataset(root: Path, seed: int, n: int) -> None:
    """A tiny on-disk dataset: one .npy shard per split plus a label map."""
    rng = np.random.default_rng(seed)
    for split, size in (("train", n), ("val", n // 5)):
        (root / split).mkdir(parents=True, exist_ok=True)
        np.save(root / split / "x.npy", rng.normal(size=(size, 10)).astype(np.float32))
        np.save(root / split / "y.npy", rng.normal(size=size).astype(np.float32))
    (root / "labels.json").write_text(json.dumps({"target": "y"}))


def prepare(seed: int, n: int) -> cairn.ArtifactVersion:
    with cairn.Run(PROJECT, name=f"data-prep-{seed}", tags=["data-prep"]) as run:
        run.config(data={"seed": seed, "n_samples": n})
        with tempfile.TemporaryDirectory() as tmp:
            write_dataset(Path(tmp), seed, n)
            art = cairn.Artifact("training-data", type="dataset",
                                 description=f"{n} samples, seed {seed}",
                                 metadata={"n_samples": n, "seed": seed})
            art.add_dir(tmp)
            # A file that stays where it is: recorded, never uploaded.
            art.add_reference("s3://example-bucket/raw/dump.tar", size=170_498_071)
            with art.new_file("stats.json") as f:
                json.dump({"mean": 0.0, "std": 1.0}, f)
            version = run.log_artifact(art)  # files are read now, while tmp exists
    print(f"  -> {version.qualified_ref}  aliases={version.aliases}")
    return version


def train(name: str, lr: float) -> None:
    with cairn.Run(PROJECT, name=name, tags=["training"]) as run:
        run.config(model={"kind": "linear", "n_features": 10}, optim={"lr": lr, "epochs": 20})
        data = run.use_artifact("training-data", role="train")  # = training-data:latest
        x = np.load(data.file("train/x.npy"))
        print(f"  <- {data.ref}: x{tuple(x.shape)}")
        best = math.inf
        for epoch in range(20):
            loss = 2.0 * math.exp(-epoch / 5) + random.gauss(0, 0.05)
            run.track(loss, name="train.loss", step=epoch)
            weights = {"w": np.random.default_rng(epoch).normal(size=10), "epoch": epoch}
            improved = loss < best
            best = min(best, loss)
            # Every call is a new version; "latest" always moves, "best" only on improvement.
            run.log_artifact(weights, "linear-model", type="model", step=epoch,
                             aliases=["best"] if improved else None,
                             metadata={"loss": round(loss, 4)})
        run.summary(best_loss=best)


def evaluate() -> None:
    with cairn.Run(PROJECT, name="eval", tags=["evaluation"]) as run:
        model = run.use_artifact("linear-model:best", role="model")
        test = run.use_artifact("training-data:v1", role="test")
        weights = model.get()  # the logged dict, unpickled
        print(f"  <- {model.ref} (epoch {weights['epoch']}, step {model.step}) and {test.ref}")
        run.track(0.12, name="eval.loss", step=0)
        report = {"test_loss": 0.12, "model": model.qualified_ref}
        run.log_artifact(cairn.Text(json.dumps(report, indent=2)), "eval-report", type="report")


def main() -> None:
    print(f"=== Artifact demo (project: {PROJECT}) ===\n")
    print("1. Dataset v1")
    prepare(seed=42, n=1000)
    print("2. Training on training-data:latest")
    train("train-a", lr=0.01)
    print("3. Evaluating linear-model:best")
    evaluate()
    print("4. Dataset v2, retraining")
    prepare(seed=123, n=2000)
    train("train-b", lr=0.005)

    print("\n=== Reading it back ===")
    with cairn.Reader() as r:
        for fam in r.artifact_families(PROJECT):
            print(f"  {fam.name} ({fam.type}): {fam.versions} versions, aliases {fam.aliases}")
        best = r.artifact("linear-model:best", project=PROJECT)
        producer = best.logged_by()
        print(f"  {best.qualified_ref} was logged by {producer.name} "
              f"with lr={producer.config['optim']['lr']}")
        print(f"  used by: {[run.name for run in best.used_by()]}")
        root = r.artifact("training-data:latest", project=PROJECT).download()
        print(f"  downloaded the dataset to {root} (the s3 reference is listed, not fetched)")
    print(f"\nBrowse: http://localhost:4301/p/{PROJECT}/artifacts")


if __name__ == "__main__":
    main()
