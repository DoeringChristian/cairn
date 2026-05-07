"""Cairn + Dask: distributed hyperparameter sweep.

Creates a LocalCluster with 4 workers, submits training tasks via
client.submit, and gathers results.  Each Dask task creates its own
cairn.Run.  After all futures resolve, WALs are ingested and verified.

Install Dask first::

    pip install "dask[distributed]"

Usage::

    uv run python examples/dask_sweep.py
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dask.distributed import Client, LocalCluster
except ImportError:
    print("This example requires Dask Distributed.  Install it with:")
    print('  pip install "dask[distributed]"')
    sys.exit(1)


# ---------------------------------------------------------------------------
# Training function — must be importable / picklable for Dask workers.
# ---------------------------------------------------------------------------

def train(repo_path_str: str, config: dict) -> str:
    """Simulate training and return the run ID."""
    import cairn

    repo_path = Path(repo_path_str)
    run = cairn.Run(
        project="dask-sweep",
        name=config["name"],
        repo=str(repo_path),
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    )
    run["hparams"] = {
        "lr": config["lr"],
        "decay": config["decay"],
        "steps": config["steps"],
    }

    lr = config["lr"]
    decay = config["decay"]
    for step in range(config["steps"]):
        loss = lr * math.exp(-step * decay)
        run.track(loss, name="loss", step=step)

    run.finish()
    return run.id


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    tmp = tempfile.mkdtemp(prefix="cairn_dask_")
    repo_path = Path(tmp) / ".cairn"
    print(f"Repo: {repo_path}")

    configs = [
        {"name": "dask-lr1e-1", "lr": 1e-1, "decay": 0.04, "steps": 50},
        {"name": "dask-lr1e-2", "lr": 1e-2, "decay": 0.05, "steps": 50},
        {"name": "dask-lr1e-3", "lr": 1e-3, "decay": 0.06, "steps": 50},
        {"name": "dask-lr1e-4", "lr": 1e-4, "decay": 0.07, "steps": 50},
    ]

    cluster = LocalCluster(n_workers=4, threads_per_worker=1)
    client = Client(cluster)
    print(f"Dask dashboard: {client.dashboard_link}")

    futures = [
        client.submit(train, str(repo_path), cfg)
        for cfg in configs
    ]
    run_ids = client.gather(futures)

    for cfg, rid in zip(configs, run_ids):
        print(f"  {cfg['name']} finished  (run_id={rid})")

    client.close()
    cluster.close()

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
    runs = reader.runs(project="dask-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'dask-sweep'")
    print(f"{'='*60}")
    for r in runs:
        seq = r.sequence("loss")
        final_loss = seq.values[-1] if seq.values else None
        loss_str = f"{final_loss:.6f}" if final_loss is not None else "n/a"
        print(f"  {r.name:<14s}  status={r.status:<10s}  steps={len(seq)}  final_loss={loss_str}")
    reader.close()
    print(f"\nRepo at: {repo_path}")


if __name__ == "__main__":
    main()
