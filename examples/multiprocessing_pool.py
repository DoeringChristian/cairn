"""Cairn + multiprocessing.Pool: pool.starmap hyperparameter sweep.

Uses multiprocessing.Pool(processes=4) with pool.starmap to run 4 training
configurations in parallel.  Each worker creates its own cairn.Run against a
shared local .cairn repo.

Usage::

    uv run python examples/multiprocessing_pool.py
"""

from __future__ import annotations

import math
import multiprocessing
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ---------------------------------------------------------------------------
# Training function — must be top-level for pickling.
# ---------------------------------------------------------------------------

def train(repo_path_str: str, config: dict) -> str:
    """Simulate training and return the run ID."""
    import cairn

    repo_path = Path(repo_path_str)
    run = cairn.Run(
        project="mp-pool-sweep",
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
        "batch_size": config["batch_size"],
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
    tmp = tempfile.mkdtemp(prefix="cairn_mp_pool_")
    repo_path = Path(tmp) / ".cairn"
    print(f"Repo: {repo_path}")

    configs = [
        {"name": "bs16-lr1e-2", "lr": 1e-2, "decay": 0.03, "batch_size": 16, "steps": 60},
        {"name": "bs32-lr1e-2", "lr": 1e-2, "decay": 0.04, "batch_size": 32, "steps": 60},
        {"name": "bs16-lr1e-3", "lr": 1e-3, "decay": 0.03, "batch_size": 16, "steps": 60},
        {"name": "bs32-lr1e-3", "lr": 1e-3, "decay": 0.04, "batch_size": 32, "steps": 60},
    ]

    # Build starmap args: list of (repo_path_str, config) tuples.
    args = [(str(repo_path), cfg) for cfg in configs]

    with multiprocessing.Pool(processes=4) as pool:
        run_ids = pool.starmap(train, args)

    for cfg, rid in zip(configs, run_ids):
        print(f"  {cfg['name']} finished  (run_id={rid})")

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
    runs = reader.runs(project="mp-pool-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'mp-pool-sweep'")
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
