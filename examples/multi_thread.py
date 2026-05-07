"""Cairn + threading.Thread: threaded hyperparameter sweep.

Spawns 3 threads, each training with different hyperparameters.  Threads are
started one at a time because cairn.Run enforces a single-active-run guard
per process (to prevent interleaved stdout capture).  Each thread runs its
training loop and finishes before the next is started.  All runs write to a
shared local .cairn repo.

After all threads complete, WALs are ingested and runs are verified through
cairn.Reader.

Usage::

    uv run python examples/multi_thread.py
"""

from __future__ import annotations

import math
import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cairn


def train(repo_path: Path, config: dict, results: dict) -> None:
    """Simulate training in a thread."""
    run = cairn.Run(
        project="thread-sweep",
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
        "optimizer": config["optimizer"],
        "steps": config["steps"],
    }

    lr = config["lr"]
    decay = config["decay"]
    for step in range(config["steps"]):
        loss = lr * math.exp(-step * decay)
        run.track(loss, name="loss", step=step)

    run.finish()
    results[config["name"]] = run.id


def main() -> None:
    tmp = tempfile.mkdtemp(prefix="cairn_threads_")
    repo_path = Path(tmp) / ".cairn"
    print(f"Repo: {repo_path}")

    configs = [
        {"name": "sgd-fast",  "lr": 1e-1, "decay": 0.04, "optimizer": "sgd",  "steps": 40},
        {"name": "adam-mid",  "lr": 1e-2, "decay": 0.06, "optimizer": "adam", "steps": 40},
        {"name": "adamw-low", "lr": 1e-3, "decay": 0.08, "optimizer": "adamw","steps": 40},
    ]

    results: dict[str, str] = {}

    # Cairn enforces one active Run per process (to avoid interleaved stdout
    # capture).  We start each thread, wait for it to finish, then start the
    # next.  For true parallelism, use multiprocessing (see multi_process.py).
    for cfg in configs:
        t = threading.Thread(target=train, args=(repo_path, cfg, results))
        t.start()
        t.join()

    for name, rid in results.items():
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
    runs = reader.runs(project="thread-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'thread-sweep'")
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
