"""Cairn + torchrun: rank 0 creates the run and broadcasts its id (no CAIRN_RUN_ID).

The same tiny CPU DDP job as ``torchrun_ddp.py``, but nothing is prepared
before launching: rank 0 creates the run, sends ``run.id`` to the other ranks
with ``dist.broadcast_object_list``, and every other rank joins it with
``cairn.attach(run_id, label=f"rank{rank}")``. Use this when you cannot set an
environment variable for the whole job, or want a fresh run per launch.

As with ``CAIRN_RUN_ID``: rank 0 is the primary (it alone sets the run's
status), rank 0 logs the run-wide ``train.loss``, every rank logs its own
``rank<N>.samples_per_sec``, and console lines and ``system.rank<N>.*``
metrics carry each rank's label.

Requirements::

    pip install torch

Usage (a local repo; on a cluster, a directory every node sees)::

    export CAIRN_REPO=/tmp/cairn-ddp/.cairn
    torchrun --nproc_per_node=2 examples/torchrun_attach.py
    cairn ui --repo $CAIRN_REPO

Without a filesystem shared by every node, log over HTTP instead:
``CAIRN_REPO=cairn://<server>:4300`` and ``CAIRN_TOKEN=<token>`` (see
docs/guides/server.md).
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


def open_run(rank: int) -> cairn.Run:
    """Rank 0 creates the run; the others join it under the id it broadcasts."""
    ids: list[str | None] = [None]
    run = None
    if rank == 0:
        run = cairn.Run("torchrun-attach", label="rank0")
        ids = [run.id]
    dist.broadcast_object_list(ids, src=0)
    if rank != 0:
        run = cairn.attach(ids[0], label=f"rank{rank}")
    return run


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

    with open_run(rank) as run:
        if rank == 0:
            run.total_steps = EPOCHS * len(loader)
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
                mean_loss = loss.detach().clone()
                dist.all_reduce(mean_loss)
                if rank == 0:
                    run.track(mean_loss.item() / world, "train.loss", step=step)
                step += 1
            run.track(seen / (time.perf_counter() - t0), f"rank{rank}.samples_per_sec", step=epoch)
            print(f"rank {rank}: epoch {epoch} done ({seen} samples)", flush=True)
        dist.barrier()  # every rank is done before rank 0 marks the run completed

    dist.destroy_process_group()


if __name__ == "__main__":
    if "RANK" not in os.environ:
        raise SystemExit("launch with torchrun: torchrun --nproc_per_node=2 examples/torchrun_attach.py")
    main()
