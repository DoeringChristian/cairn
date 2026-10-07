"""Cairn + Amazon SageMaker: a training job on two instances, one cairn run.

This file is both the launcher and the entry point. Run on your machine, it
submits a SageMaker training job (a ``sagemaker.pytorch.PyTorch`` estimator)
that runs this same file on every instance. Inside the job it trains a toy
model and logs into ONE cairn run:

- SageMaker sets ``SM_HOSTS`` and ``SM_CURRENT_HOST``, not ``RANK``, so the
  rank is this host's position in ``SM_HOSTS`` and the label is given
  explicitly: ``label=f"rank{rank}"``, ``primary=(rank == 0)``. (With
  ``distribution={"torch_distributed": {"enabled": True}}`` torchrun sets
  ``RANK`` instead, and ``label="auto"`` works as in ``torchrun_ddp.py``.)
- The launcher makes the run id and passes it, with ``CAIRN_REPO`` and
  ``CAIRN_TOKEN``, through the estimator's ``environment=``.

Training instances share no filesystem with your server, so the run goes over
HTTP: ``CAIRN_REPO=cairn://<server>:4300`` must be reachable from the job's
VPC or the internet (see docs/guides/server.md).

Requirements (the launcher; SageMaker Python SDK v2, which has ``Estimator``)::

    pip install "sagemaker<3" cairn-track

Usage::

    export CAIRN_REPO=cairn://<your-server>:4300 CAIRN_TOKEN=<token>
    python examples/sagemaker_job.py --role arn:aws:iam::<account>:role/<sagemaker-role>
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import tempfile
from pathlib import Path

CAIRN_PIP = "cairn-track @ git+https://github.com/DoeringChristian/cairn"


def train() -> None:
    """The entry point, on every instance of the job."""
    import cairn

    hosts = json.loads(os.environ["SM_HOSTS"])
    rank = sorted(hosts).index(os.environ["SM_CURRENT_HOST"])
    steps = 200
    with cairn.Run("sagemaker", label=f"rank{rank}", primary=(rank == 0),
                   total_steps=steps) as run:
        if rank == 0:
            run.config(instances=len(hosts), steps=steps)
        print(f"host {os.environ['SM_CURRENT_HOST']} (rank {rank}) logging into run {run.id}")
        for step in range(steps):
            loss = math.exp(-step / 50) + 0.01 * rank
            run.track(loss, f"rank{rank}.loss", step=step)
            if rank == 0:
                run.track(loss, "train.loss", step=step)


def launch(role: str, instance_type: str, instance_count: int) -> None:
    """Submit the job from your machine."""
    from sagemaker.pytorch import PyTorch

    import cairn

    run_id = cairn.new_run_id()
    # The job's source: this file as train.py, and the requirements SageMaker
    # installs before running it.
    src = Path(tempfile.mkdtemp(prefix="cairn_sagemaker_"))
    shutil.copy(__file__, src / "train.py")
    (src / "requirements.txt").write_text(CAIRN_PIP + "\n")

    estimator = PyTorch(
        entry_point="train.py",
        source_dir=str(src),
        role=role,
        instance_type=instance_type,
        instance_count=instance_count,
        framework_version="2.3",
        py_version="py311",
        environment={
            "CAIRN_REPO": os.environ["CAIRN_REPO"],
            "CAIRN_TOKEN": os.environ["CAIRN_TOKEN"],
            "CAIRN_RUN_ID": run_id,
        },
    )
    print(f"cairn run {run_id}")
    estimator.fit(wait=True)


if __name__ == "__main__":
    if "SM_CURRENT_HOST" in os.environ:  # inside the training job
        train()
    else:
        parser = argparse.ArgumentParser(description="Submit the SageMaker training job.")
        parser.add_argument("--role", required=True, help="SageMaker execution role ARN")
        parser.add_argument("--instance-type", default="ml.m5.large")
        parser.add_argument("--instance-count", type=int, default=2)
        args = parser.parse_args()
        launch(args.role, args.instance_type, args.instance_count)
