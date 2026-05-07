"""Cairn + Ray Tune: grid-search hyperparameter sweep.

Each Ray Tune trial creates its own cairn.Run.  Uses tune.Tuner with a
grid_search over learning rates.  After the sweep, WALs are ingested and
results verified via cairn.Reader.

**Single machine** (default): all workers share the filesystem. WAL mode
works out of the box.

**Multi-machine Ray cluster**: workers run on different nodes.

  - With shared filesystem (NFS): pass the NFS-mounted .cairn/ path as
    ``repo=``. Workers write WALs to the shared directory.

  - Without shared filesystem: use Cairn's HTTP transport instead::

        # On the head node:
        cairn server --port 4301

        # In the trainable:
        cairn.configure(server="http://head-node:4301")
        run = cairn.Run(project="ray-tune", name="...")

Install Ray first::

    pip install "ray[tune]"

Usage::

    python examples/ray_tune.py
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import ray
    from ray import tune
except ImportError:
    print("This example requires Ray Tune.  Install it with:")
    print('  pip install "ray[tune]"')
    sys.exit(1)


# ---------------------------------------------------------------------------
# Trainable function
# ---------------------------------------------------------------------------

def train_fn(config: dict) -> None:
    """Ray Tune trainable that creates a Cairn run per trial."""
    import cairn

    repo_path = Path(config["repo_path"])
    lr = config["lr"]
    decay = config.get("decay", 0.05)
    steps = config.get("steps", 50)

    run = cairn.Run(
        project="ray-tune-sweep",
        name=f"lr-{lr:.0e}",
        repo=str(repo_path),
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    )
    run["hparams"] = {"lr": lr, "decay": decay, "steps": steps}

    for step in range(steps):
        loss = lr * math.exp(-step * decay)
        run.track(loss, name="loss", step=step)
        # Also report to Ray so its dashboard / early stopping can see progress.
        tune.report(loss=loss, step=step)

    run.finish()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    tmp = tempfile.mkdtemp(prefix="cairn_ray_")
    repo_path = Path(tmp) / ".cairn"
    ray_results = Path(tmp) / "ray_results"
    print(f"Repo: {repo_path}")

    ray.init(ignore_reinit_error=True, num_cpus=4)

    param_space = {
        "repo_path": str(repo_path),
        "lr": tune.grid_search([1e-2, 1e-3, 1e-4]),
        "decay": 0.05,
        "steps": 50,
    }

    tuner = tune.Tuner(
        train_fn,
        param_space=param_space,
        run_config=ray.train.RunConfig(
            storage_path=str(ray_results),
            name="cairn-ray-sweep",
        ),
    )
    results = tuner.fit()
    ray.shutdown()

    print(f"\nRay Tune finished {len(results)} trials")

    # --- Ingest WALs and verify -------------------------------------------
    from cairn.server.storage.datadir import DataDir
    from cairn.server.storage.db import Database
    from cairn.server.storage.blobs import BlobStore
    from cairn.server.wal_ingest import ingest_all

    dd = DataDir(repo_path)
    db = Database.open(dd.db_path)
    blobs = BlobStore(dd.artifacts_dir)
    ingest_all(dd, db, blobs)
    db.close()

    from cairn.sdk.reader import Reader

    reader = Reader(repo=str(repo_path))
    runs = reader.runs(project="ray-tune-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'ray-tune-sweep'")
    print(f"{'='*60}")
    for r in runs:
        seq = r.sequence("loss")
        final_loss = seq.values[-1] if seq.values else None
        loss_str = f"{final_loss:.6f}" if final_loss is not None else "n/a"
        print(f"  {r.name:<12s}  status={r.status:<10s}  steps={len(seq)}  final_loss={loss_str}")
    reader.close()
    print(f"\nRepo at: {repo_path}")


if __name__ == "__main__":
    main()
