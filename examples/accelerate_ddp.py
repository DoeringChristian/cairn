"""Cairn + Hugging Face Accelerate: one run for every process of the job.

A tiny regression model trained with ``Accelerator``, on GPUs or on the
CPU. ``accelerate launch`` sets ``RANK`` for each process, so
``label="auto"`` makes process 0 the primary ``rank0`` that creates the run
and every other process the worker ``rankN`` that joins it. All of them read
the run id from ``CAIRN_RUN_ID``.

The main process logs the run-wide ``train.loss`` (gathered over the
processes); every process logs its own ``rank<N>.samples_per_sec``. Console
lines and ``system.rank<N>.*`` metrics carry each process's label, and only
the main process sets the run's status.

Requirements::

    pip install torch accelerate

Usage (a local repo; on a cluster, a directory every node sees)::

    export CAIRN_REPO=/tmp/cairn-accelerate/.cairn
    export CAIRN_RUN_ID=$(python -c "import cairn; print(cairn.new_run_id())")
    accelerate launch --multi_gpu --num_processes 2 examples/accelerate_ddp.py
    cairn ui --repo $CAIRN_REPO

On a machine without GPUs, add ``ACCELERATE_USE_CPU=1`` in front of
``accelerate launch``: the processes then train on the CPU with ``gloo``.
(``accelerate launch --cpu`` starts ONE process whatever ``--num_processes``
says, unless it is given an MPI hostfile.)

Without a filesystem shared by every node, log over HTTP instead:
``CAIRN_REPO=cairn://<server>:4300`` and ``CAIRN_TOKEN=<token>`` (see
docs/guides/server.md).
"""

from __future__ import annotations

import time

import torch
from accelerate import Accelerator
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

import cairn

EPOCHS = 5
BATCH_SIZE = 32


def make_dataset(n: int = 2048) -> TensorDataset:
    g = torch.Generator().manual_seed(0)  # the same data in every process
    x = torch.randn(n, 16, generator=g)
    w = torch.randn(16, 1, generator=g)
    y = x @ w + 0.1 * torch.randn(n, 1, generator=g)
    return TensorDataset(x, y)


def main() -> None:
    accelerator = Accelerator()
    rank = accelerator.process_index
    torch.manual_seed(0)

    model = nn.Sequential(nn.Linear(16, 32), nn.ReLU(), nn.Linear(32, 1))
    opt = torch.optim.SGD(model.parameters(), lr=0.05)
    # ``prepare`` shards the loader over the processes and wraps the model in DDP.
    loader = DataLoader(make_dataset(), batch_size=BATCH_SIZE, shuffle=True)
    model, opt, loader = accelerator.prepare(model, opt, loader)
    loss_fn = nn.MSELoss()

    with cairn.Run("accelerate-ddp", label="auto", total_steps=EPOCHS * len(loader)) as run:
        if accelerator.is_main_process:
            run.config(num_processes=accelerator.num_processes, epochs=EPOCHS,
                       batch_size=BATCH_SIZE, lr=0.05)
        print(f"process {rank}/{accelerator.num_processes} logging into run {run.id}", flush=True)
        step = 0
        for epoch in range(EPOCHS):
            t0, seen = time.perf_counter(), 0
            for x, y in loader:
                opt.zero_grad()
                loss = loss_fn(model(x), y)
                accelerator.backward(loss)
                opt.step()
                seen += len(x)
                mean_loss = accelerator.gather(loss.detach()).mean()
                if accelerator.is_main_process:
                    run.track(mean_loss.item(), "train.loss", step=step)
                step += 1
            run.track(seen / (time.perf_counter() - t0), f"rank{rank}.samples_per_sec", step=epoch)
            print(f"process {rank}: epoch {epoch} done ({seen} samples)", flush=True)
        # No barrier needed: the run's status is the main process's, and what the
        # other processes record still lands if they finish after it.

    accelerator.end_training()


if __name__ == "__main__":
    main()
