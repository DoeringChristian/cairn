"""Cairn + submitit: Slurm-style sweep (runs locally via cluster="local").

Uses submitit.AutoExecutor with cluster="local" so the example works on any
machine without a Slurm scheduler.  Each trial creates its own cairn.Run
against a shared .cairn repo.

**On a real Slurm cluster**: change ``cluster="local"`` to ``cluster="slurm"``
and point ``repo=`` to an NFS-mounted directory visible to all nodes. Each
Slurm job writes its own WAL file — no SQLite contention even with hundreds
of concurrent jobs.  Run ``cairn server`` on the login/head node to ingest
WALs and serve the UI.

If your cluster does NOT have a shared filesystem, use Cairn's HTTP transport
instead::

    cairn.configure(server="http://head-node:4301")

Install submitit first::

    pip install submitit

Usage::

    python examples/submitit_sweep.py
"""

from __future__ import annotations

import math
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    import submitit
except ImportError:
    print("This example requires submitit.  Install it with:")
    print("  pip install submitit")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Training function — top-level for pickling by submitit.
# ---------------------------------------------------------------------------

def train(repo_path_str: str, config: dict) -> str:
    """Simulate training and return the run ID."""
    import cairn

    repo_path = Path(repo_path_str)
    run = cairn.Run(
        project="submitit-sweep",
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
    tmp = tempfile.mkdtemp(prefix="cairn_submitit_")
    repo_path = Path(tmp) / ".cairn"
    log_folder = Path(tmp) / "submitit_logs"
    log_folder.mkdir()
    print(f"Repo: {repo_path}")

    configs = [
        {"name": "trial-lr1e-1", "lr": 1e-1, "decay": 0.05, "steps": 50},
        {"name": "trial-lr1e-2", "lr": 1e-2, "decay": 0.05, "steps": 50},
        {"name": "trial-lr1e-3", "lr": 1e-3, "decay": 0.05, "steps": 50},
        {"name": "trial-lr1e-4", "lr": 1e-4, "decay": 0.05, "steps": 50},
    ]

    executor = submitit.AutoExecutor(folder=str(log_folder), cluster="local")
    executor.update_parameters(timeout_min=5)

    # Submit all trials via map_array.
    repos = [str(repo_path)] * len(configs)
    jobs = executor.map_array(train, repos, configs)

    # Wait for results.
    run_ids: list[str] = []
    for job, cfg in zip(jobs, configs):
        rid = job.result()
        run_ids.append(rid)
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
    runs = reader.runs(project="submitit-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'submitit-sweep'")
    print(f"{'='*60}")
    for r in runs:
        seq = r.sequence("loss")
        final_loss = seq.values[-1] if seq.values else None
        loss_str = f"{final_loss:.6f}" if final_loss is not None else "n/a"
        print(f"  {r.name:<16s}  status={r.status:<10s}  steps={len(seq)}  final_loss={loss_str}")
    reader.close()
    print(f"\nRepo at: {repo_path}")


if __name__ == "__main__":
    main()
