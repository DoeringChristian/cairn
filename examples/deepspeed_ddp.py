"""Cairn + DeepSpeed: one run for every rank of a DeepSpeed job.

A tiny regression model trained with ``deepspeed.initialize`` and the config
in ``examples/deepspeed_config.json`` (ZeRO stage 1, AdamW). The ``deepspeed``
launcher sets ``RANK`` for every process, so ``label="auto"`` makes rank 0
the primary ``rank0`` that creates the run and every other rank the worker
``rankN`` that joins it. All of them read the run id from ``CAIRN_RUN_ID``.

Rank 0 logs the run-wide ``train.loss`` (averaged over the ranks); every rank
logs its own ``rank<N>.samples_per_sec``. Console lines and
``system.rank<N>.*`` metrics carry each rank's label, and only rank 0 sets
the run's status.

Requirements: GPUs with CUDA, and::

    pip install torch deepspeed

Usage (a local repo; on a cluster, a directory every node sees)::

    export CAIRN_REPO=/tmp/cairn-deepspeed/.cairn
    export CAIRN_RUN_ID=$(python -c "import cairn; print(cairn.new_run_id())")
    deepspeed --num_gpus 2 examples/deepspeed_ddp.py
    cairn ui --repo $CAIRN_REPO

Several nodes (``deepspeed --hostfile hosts ...``): the launcher starts the
processes over SSH, and passes on the variables in ``.deepspeed_env`` (one
``NAME=value`` per line, in the working directory or your home), so put
``CAIRN_RUN_ID`` and ``CAIRN_REPO`` there. Without a filesystem shared by
every node, log over HTTP: ``CAIRN_REPO=cairn://<server>:4300`` and
``CAIRN_TOKEN=<token>`` (see docs/guides/server.md).
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import deepspeed
import torch
import torch.distributed as dist
from torch import nn
from torch.utils.data import TensorDataset

import cairn

EPOCHS = 5
CONFIG = Path(__file__).resolve().parent / "deepspeed_config.json"


def make_dataset(n: int = 4096) -> TensorDataset:
    g = torch.Generator().manual_seed(0)  # the same data on every rank
    x = torch.randn(n, 16, generator=g)
    w = torch.randn(16, 1, generator=g)
    y = x @ w + 0.1 * torch.randn(n, 1, generator=g)
    return TensorDataset(x, y)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--local_rank", type=int, default=-1)  # passed by the launcher
    parser.add_argument("--deepspeed_config", default=str(CONFIG))
    args = parser.parse_args()

    deepspeed.init_distributed()
    rank, world = dist.get_rank(), dist.get_world_size()
    torch.manual_seed(0)

    model = nn.Sequential(nn.Linear(16, 32), nn.ReLU(), nn.Linear(32, 1))
    # ``training_data`` gives a loader that is sharded over the ranks.
    engine, _, loader, _ = deepspeed.initialize(
        model=model, model_parameters=model.parameters(),
        training_data=make_dataset(), config=args.deepspeed_config,
    )
    loss_fn = nn.MSELoss()

    with cairn.Run("deepspeed-ddp", label="auto", total_steps=EPOCHS * len(loader)) as run:
        if rank == 0:
            ds_config = json.loads(Path(args.deepspeed_config).read_text())
            run.config(world_size=world, epochs=EPOCHS, deepspeed=ds_config)
        print(f"rank {rank}/{world} logging into run {run.id}", flush=True)
        step = 0
        for epoch in range(EPOCHS):
            t0, seen = time.perf_counter(), 0
            for x, y in loader:
                x, y = x.to(engine.device), y.to(engine.device)
                loss = loss_fn(engine(x), y)
                engine.backward(loss)
                engine.step()
                seen += len(x)
                mean_loss = loss.detach().clone()
                dist.all_reduce(mean_loss)
                if rank == 0:
                    run.track(mean_loss.item() / world, "train.loss", step=step)
                step += 1
            run.track(seen / (time.perf_counter() - t0), f"rank{rank}.samples_per_sec", step=epoch)
            print(f"rank {rank}: epoch {epoch} done ({seen} samples)", flush=True)
        dist.barrier()  # every rank is done before rank 0 marks the run completed


if __name__ == "__main__":
    main()
