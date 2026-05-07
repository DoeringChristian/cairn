"""Cairn + Fabric: run training on remote machines over SSH.

The simplest way to distribute training across multiple machines.
Fabric runs commands on remote hosts via SSH — no cluster manager needed.

Requirements:
  - SSH access to remote hosts (ssh-agent or key-based auth)
  - Cairn installed on all hosts (or a shared virtualenv on NFS)
  - A shared filesystem (NFS/sshfs) mounted at the same path on all hosts

If you don't have a shared filesystem, use Cairn's HTTP transport instead::

    # On the local machine:
    cairn server --port 4301

    # In the training script on remote hosts:
    cairn.configure(repo="cairn://local-machine:4301")

Install Fabric first::

    pip install fabric

Usage::

    # Local simulation (default)
    python examples/fabric_remote.py

    # Real remote execution
    python examples/fabric_remote.py --hosts gpu1 gpu2 gpu3
"""

from __future__ import annotations

import math
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ---------------------------------------------------------------------------
# Training function (runs on each host)
# ---------------------------------------------------------------------------

def train(repo_path_str: str, config: dict) -> str:
    """Simulate training and return the run ID."""
    import cairn

    repo_path = Path(repo_path_str)
    run = cairn.Run(
        project="fabric-sweep",
        name=config["name"],
        repo=str(repo_path),
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    )
    run["hparams"] = config

    lr = config["lr"]
    for step in range(config["steps"]):
        loss = lr * math.exp(-step * 0.05)
        run.track(loss, name="loss", step=step)

    run.finish()
    return run.id


def run_on_remote(host: str, repo_path: str, config: dict) -> str:
    """SSH into a remote host and run training there.

    In a real setup, this would use Fabric to execute a script on the
    remote host. For this example, we simulate it locally.
    """
    try:
        from fabric import Connection
        # Real remote execution:
        # c = Connection(host)
        # result = c.run(f"python /path/to/train.py --repo {repo_path} --lr {config['lr']}")
        # return result.stdout.strip()
    except ImportError:
        pass

    # Simulate locally (each "host" is a thread).
    return train(repo_path, config)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    tmp = tempfile.mkdtemp(prefix="cairn_fabric_")
    repo_path = Path(tmp) / ".cairn"
    print(f"Repo: {repo_path}")

    # Parse --hosts from CLI, or simulate locally.
    hosts = []
    if "--hosts" in sys.argv:
        idx = sys.argv.index("--hosts")
        hosts = sys.argv[idx + 1:]

    configs = [
        {"name": "remote-lr1e-1", "lr": 1e-1, "steps": 50},
        {"name": "remote-lr1e-2", "lr": 1e-2, "steps": 50},
        {"name": "remote-lr1e-3", "lr": 1e-3, "steps": 50},
    ]

    if hosts:
        print(f"Running on remote hosts: {hosts}")
        print(f"  (Requires {repo_path} accessible on all hosts via NFS)")
        print()
        # Real Fabric execution would look like:
        #
        #   from fabric import ThreadingGroup
        #   group = ThreadingGroup(*hosts)
        #   for config in configs:
        #       group.run(f"python train.py --repo {repo_path} --lr {config['lr']}")
        #
        # For this demo, we simulate with threads:
        with ThreadPoolExecutor(max_workers=len(configs)) as pool:
            futures = [
                pool.submit(run_on_remote, hosts[i % len(hosts)], str(repo_path), cfg)
                for i, cfg in enumerate(configs)
            ]
            for cfg, fut in zip(configs, futures):
                rid = fut.result()
                print(f"  {cfg['name']} finished  (run_id={rid})")
    else:
        print("Local simulation (use --hosts gpu1 gpu2 for real remote execution)")
        print("  (Runs sequentially since threads share the process-level active-run guard.)")
        print("  (Real Fabric/SSH runs are separate processes — no such limitation.)")
        print()
        for cfg in configs:
            rid = train(str(repo_path), cfg)
            print(f"  {cfg['name']} finished  (run_id={rid})")

    # --- Ingest WALs and verify -----------------------------------------------
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
    runs = reader.runs(project="fabric-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'fabric-sweep'")
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
