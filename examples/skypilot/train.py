"""Cairn + SkyPilot: the training script every task YAML in this folder runs.

It logs a toy training loop into one cairn run:

- ``label="auto"`` reads ``SKYPILOT_NODE_RANK``: node 0 is the primary
  ``rank0`` (it creates the run and alone sets its status), node N the worker
  ``rankN`` that joins it. Node 0 logs the run-wide ``train.loss``; every
  node logs its own ``rank<N>.samples_per_sec``.
- The run id is ``CAIRN_RUN_ID`` when set (``task_multinode.yaml`` and
  ``task_spot.yaml`` set it once for the whole task, so every node and every
  recovery uses the same run), else a fresh one.
- Spot recovery: when the run already exists (a managed job restarted after
  a preemption), node 0 continues it with ``resume=`` instead of creating it,
  and rewinds it to the step of the last checkpoint, so the steps the
  preempted attempt logged after that checkpoint are dropped and logged
  again. Checkpoints go to ``CHECKPOINT_DIR`` (a bucket mount in
  ``task_spot.yaml``; ``./checkpoints`` by default).

The run is logged over HTTP: the YAMLs set ``CAIRN_REPO=cairn://<server>:4300``
and ``CAIRN_TOKEN``. See README.md.

Usage (what the YAMLs run; also works locally against any repo)::

    python train.py

Requirements: ``cairn-track`` (the YAMLs install it in ``setup:``).
"""

from __future__ import annotations

import json
import math
import os
import random
import time
from pathlib import Path

import cairn

PROJECT = "skypilot"
STEPS = int(os.environ.get("TRAIN_STEPS", "300"))
CKPT_EVERY = 50
CHECKPOINT_DIR = Path(os.environ.get("CHECKPOINT_DIR", "checkpoints"))


def load_checkpoint() -> dict | None:
    path = CHECKPOINT_DIR / "state.json"
    return json.loads(path.read_text()) if path.exists() else None


def save_checkpoint(state: dict) -> None:
    CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CHECKPOINT_DIR / "state.json.tmp"
    tmp.write_text(json.dumps(state))
    tmp.replace(CHECKPOINT_DIR / "state.json")


def open_run(ckpt: dict | None) -> cairn.Run:
    """Create the run, or continue it when it exists already (spot recovery)."""
    try:
        # Node 0 creates the run (with CAIRN_RUN_ID's id, if set); other nodes join it.
        return cairn.Run(PROJECT, label="auto", total_steps=STEPS)
    except ValueError:
        # Only a primary whose id is taken gets here: a recovery of the same
        # managed job. Continue the run, dropping what the preempted attempt
        # logged after its last checkpoint (everything, without a checkpoint).
        run_id = os.environ.get("CAIRN_RUN_ID")
        if not run_id:
            raise
        step = ckpt["step"] if ckpt else -1
        print(f"run {run_id} exists: resuming it from step {step + 1}", flush=True)
        return cairn.Run(PROJECT, label="auto", resume=run_id, rewind_to=step)


def main() -> None:
    rank = int(os.environ.get("SKYPILOT_NODE_RANK", "0"))
    ckpt = load_checkpoint()  # every node sees the bucket; only node 0 writes it
    start = ckpt["step"] + 1 if ckpt else 0
    rng = random.Random(rank)

    with open_run(ckpt) as run:
        if rank == 0 and ckpt is None:
            run.config(steps=STEPS, num_nodes=int(os.environ.get("SKYPILOT_NUM_NODES", "1")))
        print(f"node {rank} logging into run {run.id} from step {start}", flush=True)
        t0 = time.perf_counter()
        for step in range(start, STEPS):
            time.sleep(0.01)  # one "training step"
            if rank == 0:
                loss = 2.0 * math.exp(-step / 80) + 0.05 * rng.random()
                run.track(loss, "train.loss", step=step)
                if (step + 1) % CKPT_EVERY == 0:
                    save_checkpoint({"step": step})
            if (step + 1) % 10 == 0:
                rate = 10 * 64 / (time.perf_counter() - t0)  # 64 "samples" per step
                run.track(rate, f"rank{rank}.samples_per_sec", step=step)
                t0 = time.perf_counter()
        print(f"node {rank} done", flush=True)


if __name__ == "__main__":
    main()
