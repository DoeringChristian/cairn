"""Cairn + Kubernetes: generate Job manifests for a distributed sweep.

This script does NOT require a running cluster.  It generates:

1. A self-contained ``train.py`` worker script that each K8s Job runs.
2. A ``jobs.yaml`` manifest defining one Job per hyperparameter config.

Both are printed to stdout so you can pipe them into files::

    python examples/kubernetes_jobs.py > /dev/null  # just prints

**With shared PVC (recommended)**: All Jobs mount the same PersistentVolumeClaim
at ``/mnt/cairn``. Workers write WAL files to the shared ``.cairn/`` directory.
Run ``cairn server --repo /mnt/cairn/.cairn`` on a node with PVC access to
ingest and serve the UI.

**Without shared storage**: Use Cairn's HTTP transport instead. Run
``cairn server`` and set ``CAIRN_REPO=cairn://cairn-service:4301`` as an
environment variable in the Job spec.

Prerequisites for actually running the generated Jobs:
  - A Kubernetes cluster with kubectl configured
  - A shared PVC named ``cairn-repo-pvc`` mounted at /mnt/cairn
  - The cairn package available in the container image

Usage::

    python examples/kubernetes_jobs.py
"""

from __future__ import annotations

import math
import sys
import tempfile
import textwrap
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ---------------------------------------------------------------------------
# Generated worker script content
# ---------------------------------------------------------------------------

TRAIN_SCRIPT = textwrap.dedent('''\
    #!/usr/bin/env python3
    """Cairn training worker for Kubernetes Jobs.

    Expects environment variables:
      CAIRN_REPO  — path to the shared .cairn directory (e.g. /mnt/cairn/.cairn)
      RUN_NAME    — display name for this run
      LR          — learning rate (float)
      DECAY       — exponential decay rate (float)
      STEPS       — number of training steps (int)
    """

    import math
    import os
    import cairn

    repo = os.environ["CAIRN_REPO"]
    name = os.environ["RUN_NAME"]
    lr = float(os.environ["LR"])
    decay = float(os.environ["DECAY"])
    steps = int(os.environ["STEPS"])

    run = cairn.Run(
        project="k8s-sweep",
        name=name,
        repo=repo,
        capture_source=False,
        capture_stdout=False,
        capture_env=True,
        capture_system_metrics=False,
    )
    run["hparams"] = {"lr": lr, "decay": decay, "steps": steps}

    for step in range(steps):
        loss = lr * math.exp(-step * decay)
        run.track(loss, name="loss", step=step)

    run.finish()
    print(f"Run {name} finished (id={run.id})")
''')


# ---------------------------------------------------------------------------
# K8s Job YAML template
# ---------------------------------------------------------------------------

JOB_TEMPLATE = textwrap.dedent('''\
    apiVersion: batch/v1
    kind: Job
    metadata:
      name: cairn-sweep-{slug}
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: trainer
              image: python:3.11-slim
              command: ["python", "/app/train.py"]
              env:
                - name: CAIRN_REPO
                  value: "/mnt/cairn/.cairn"
                - name: RUN_NAME
                  value: "{name}"
                - name: LR
                  value: "{lr}"
                - name: DECAY
                  value: "{decay}"
                - name: STEPS
                  value: "{steps}"
              volumeMounts:
                - name: cairn-repo
                  mountPath: /mnt/cairn
                - name: train-script
                  mountPath: /app
          volumes:
            - name: cairn-repo
              persistentVolumeClaim:
                claimName: cairn-repo-pvc
            - name: train-script
              configMap:
                name: cairn-train-script
    ---
''')


# ---------------------------------------------------------------------------
# Local simulation + verification
# ---------------------------------------------------------------------------

def simulate_locally() -> None:
    """Run the same configs in-process and verify via Reader."""
    import cairn

    tmp = tempfile.mkdtemp(prefix="cairn_k8s_sim_")
    repo_path = Path(tmp) / ".cairn"
    print(f"\n--- Local simulation ---")
    print(f"Repo: {repo_path}")

    configs = [
        {"name": "k8s-lr1e-2", "lr": 1e-2, "decay": 0.05, "steps": 50},
        {"name": "k8s-lr1e-3", "lr": 1e-3, "decay": 0.05, "steps": 50},
        {"name": "k8s-lr1e-4", "lr": 1e-4, "decay": 0.05, "steps": 50},
    ]

    run_ids: list[str] = []
    for cfg in configs:
        run = cairn.Run(
            project="k8s-sweep",
            name=cfg["name"],
            repo=str(repo_path),
            capture_source=False,
            capture_stdout=False,
            capture_env=False,
            capture_system_metrics=False,
        )
        run["hparams"] = {"lr": cfg["lr"], "decay": cfg["decay"], "steps": cfg["steps"]}

        lr = cfg["lr"]
        decay = cfg["decay"]
        for step in range(cfg["steps"]):
            loss = lr * math.exp(-step * decay)
            run.track(loss, name="loss", step=step)

        run.finish()
        run_ids.append(run.id)
        print(f"  {cfg['name']} finished  (run_id={run.id})")

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
    runs = reader.runs(project="k8s-sweep").list()

    print(f"\n{'='*60}")
    print(f"Captured {len(runs)} runs in project 'k8s-sweep'")
    print(f"{'='*60}")
    for r in runs:
        seq = r.sequence("loss")
        final_loss = seq.values[-1] if seq.values else None
        loss_str = f"{final_loss:.6f}" if final_loss is not None else "n/a"
        print(f"  {r.name:<14s}  status={r.status:<10s}  steps={len(seq)}  final_loss={loss_str}")
    reader.close()
    print(f"\nRepo at: {repo_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    configs = [
        {"name": "k8s-lr1e-2", "slug": "lr1e-2", "lr": "1e-2", "decay": "0.05", "steps": "50"},
        {"name": "k8s-lr1e-3", "slug": "lr1e-3", "lr": "1e-3", "decay": "0.05", "steps": "50"},
        {"name": "k8s-lr1e-4", "slug": "lr1e-4", "lr": "1e-4", "decay": "0.05", "steps": "50"},
    ]

    # --- Print train.py ---------------------------------------------------
    print("=" * 60)
    print("=== train.py (worker script — add to a ConfigMap) ===")
    print("=" * 60)
    print(TRAIN_SCRIPT)

    # --- Print jobs.yaml --------------------------------------------------
    print("=" * 60)
    print("=== jobs.yaml (Kubernetes Job manifest) ===")
    print("=" * 60)

    for cfg in configs:
        print(JOB_TEMPLATE.format(**cfg), end="")

    # --- Instructions -----------------------------------------------------
    print("=" * 60)
    print("=== Deployment instructions ===")
    print("=" * 60)
    print(textwrap.dedent("""\
        Prerequisites:
          1. A Kubernetes cluster with kubectl configured
          2. A PersistentVolumeClaim named 'cairn-repo-pvc' (ReadWriteMany)
             mounted at /mnt/cairn on every Job pod
          3. A container image with Python 3.11+ and cairn installed

        Steps:
          # Create the ConfigMap with the training script
          kubectl create configmap cairn-train-script --from-file=train.py

          # Apply the Jobs
          kubectl apply -f jobs.yaml

          # Watch progress
          kubectl get jobs -l app=cairn-sweep --watch

          # After all Jobs complete, ingest WALs locally:
          #   (mount or copy the PVC contents, then run)
          python -c "
          from cairn.server.storage.datadir import DataDir
          from cairn.server.storage.db import Database
          from cairn.server.storage.blobs import BlobStore
          from cairn.server.wal_ingest import ingest_all
          from cairn.sdk.reader import Reader
          import pathlib

          repo = pathlib.Path('/mnt/cairn/.cairn')
          dd = DataDir(repo)
          db = Database.open(dd.db_path)
          blobs = BlobStore(dd.artifacts_dir)
          ingest_all(dd, db, blobs)
          db.close()

          reader = Reader(repo=str(repo))
          for r in reader.runs(project='k8s-sweep').list():
              seq = r.sequence('loss')
              print(f'{r.name}  status={r.status}  steps={len(seq)}')
          reader.close()
          "
    """))

    # --- Local simulation so this script is actually runnable -------------
    simulate_locally()


if __name__ == "__main__":
    main()
