"""Cairn + torchrun: one run for every rank of a DDP job (CPU, gloo).

Trains a tiny regression model with ``DistributedDataParallel`` on the CPU
(``gloo`` backend) and a ``DistributedSampler``. Every rank logs into ONE run:

- the run id comes from ``CAIRN_RUN_ID``, made once before launching;
- ``label="auto"`` reads ``RANK`` (set by torchrun): rank 0 creates the run as
  the primary ``rank0``, every other rank joins it as the worker ``rankN``;
- rank 0 logs the run-wide ``train.loss`` (averaged over the ranks), and every
  rank logs its own throughput as ``rank<N>.samples_per_sec``;
- each rank's console lines carry its label, and its system metrics are
  ``system.rank<N>.*``.

Only rank 0 sets the run's status: it is ``completed`` when rank 0 leaves its
``with`` block, whatever the other ranks do.

Requirements::

    pip install torch

Usage (a local repo; on a cluster, a directory every node sees)::

    export CAIRN_REPO=/tmp/cairn-ddp/.cairn
    export CAIRN_RUN_ID=$(python -c "import cairn; print(cairn.new_run_id())")
    torchrun --nproc_per_node=2 examples/torchrun_ddp.py
    cairn ui --repo $CAIRN_REPO

Several nodes: run the same ``torchrun --nnodes=N --node_rank=... ...`` on
each with the SAME ``CAIRN_RUN_ID``. Without a filesystem shared by every
node, log over HTTP instead: ``CAIRN_REPO=cairn://<server>:4300`` and
``CAIRN_TOKEN=<token>`` (see docs/guides/server.md).
"""

from __future__ import annotations

import os
import time

import torch
import torch.distributed as dist
from torch import nn
from torch.nn.parallel import DistributedDataParallel
from torch.utils.data import DataLoader, DistributedSampler, TensorDataset

import cairn

EPOCHS = 5
BATCH_SIZE = 32


def make_dataset(n: int = 2048) -> TensorDataset:
    g = torch.Generator().manual_seed(0)  # the same data on every rank
    x = torch.randn(n, 16, generator=g)
    w = torch.randn(16, 1, generator=g)
    y = x @ w + 0.1 * torch.randn(n, 1, generator=g)
    return TensorDataset(x, y)


def main() -> None:
    dist.init_process_group("gloo")
    rank, world = dist.get_rank(), dist.get_world_size()
    torch.manual_seed(0)

    dataset = make_dataset()
    sampler = DistributedSampler(dataset, num_replicas=world, rank=rank, shuffle=True)
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, sampler=sampler)
    model = DistributedDataParallel(nn.Sequential(nn.Linear(16, 32), nn.ReLU(), nn.Linear(32, 1)))
    opt = torch.optim.SGD(model.parameters(), lr=0.05)
    loss_fn = nn.MSELoss()

    with cairn.Run("torchrun-ddp", label="auto", total_steps=EPOCHS * len(loader)) as run:
        if rank == 0:
            run.config(world_size=world, epochs=EPOCHS, batch_size=BATCH_SIZE, lr=0.05)
        print(f"rank {rank}/{world} logging into run {run.id}", flush=True)
        step = 0
        for epoch in range(EPOCHS):
            sampler.set_epoch(epoch)
            t0, seen = time.perf_counter(), 0
            for x, y in loader:
                opt.zero_grad()
                loss = loss_fn(model(x), y)
                loss.backward()
                opt.step()
                seen += len(x)
                # The run-wide loss: the mean over the ranks, logged by rank 0 only.
                mean_loss = loss.detach().clone()
                dist.all_reduce(mean_loss)
                if rank == 0:
                    run.track(mean_loss.item() / world, "train.loss", step=step)
                step += 1
            # A per-rank metric: every rank logs it under its own name.
            run.track(seen / (time.perf_counter() - t0), f"rank{rank}.samples_per_sec", step=epoch)
            print(f"rank {rank}: epoch {epoch} done ({seen} samples)", flush=True)
        dist.barrier()  # every rank is done before rank 0 marks the run completed

    dist.destroy_process_group()


if __name__ == "__main__":
    if "RANK" not in os.environ:
        raise SystemExit("launch with torchrun: torchrun --nproc_per_node=2 examples/torchrun_ddp.py")
    main()
