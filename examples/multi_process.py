"""Cairn + ProcessPoolExecutor: parallel hyperparameter sweep.

Launches 4 workers via concurrent.futures.ProcessPoolExecutor, each training
with a different learning rate.  Every worker creates its own cairn.Run
against a shared local .cairn repo.  After all workers finish, WALs are
ingested and the runs are verified through cairn.Reader.

Usage::

    uv run python examples/multi_process.py
"""

from __future__ import annotations

import math
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

# Ensure the repo root is on sys.path so `import cairn` works from a checkout.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ---------------------------------------------------------------------------
# Training function — must be top-level so it can be pickled.
# ---------------------------------------------------------------------------

def train(repo_path_str: str, config: dict) -> str:
    """Simulate a short training run and return the run ID."""
    import cairn

    repo_path = Path(repo_path_str)
    run = cairn.Run(
        project="process-pool-sweep",
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
    tmp = tempfile.mkdtemp(prefix="cairn_multiproc_")
    repo_path = Path(tmp) / ".cairn"
    print(f"Repo: {repo_path}")

    configs = [
        {"name": "lr-1e-1", "lr": 1e-1, "decay": 0.05, "steps": 50},
        {"name": "lr-1e-2", "lr": 1e-2, "decay": 0.05, "steps": 50},
        {"name": "lr-1e-3", "lr": 1e-3, "decay": 0.05, "steps": 50},
        {"name": "lr-1e-4", "lr": 1e-4, "decay": 0.05, "steps": 50},
    ]

    run_ids: list[str] = []
    with ProcessPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(train, str(repo_path), cfg): cfg["name"]
            for cfg in configs
        }
        for future in as_completed(futures):
            name = futures[future]
            rid = future.result()
            run_ids.append(rid)
            print(f"  {name} finished  (run_id={rid})")

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
    runs = reader.runs(project="process-pool-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'process-pool-sweep'")
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
