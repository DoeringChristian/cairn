"""Cairn: a later evaluation job adds its results to a FINISHED training run.

A training job logs its model with ``run.log_model``. Hours later, another job
(a different SLURM job, another machine) evaluates that model and records the
results in the SAME run: it joins it with ``cairn.attach(run_id,
label="eval")``, takes the model with ``run.use_model`` (which records it as
the evaluation's input), and logs ``eval.*`` metrics and a summary. The run
keeps the status its training job left (``completed``): an attached process
never changes it. Its console lines carry the label ``eval``.

Usage::

    # self-contained demo: a training run, then the evaluation, in a scratch repo
    python examples/cluster_eval_attach.py --demo

    # the evaluation job alone, against the repo the training run lives in
    CAIRN_REPO=/shared/nfs/.cairn python examples/cluster_eval_attach.py <run id>
    # e.g. as a SLURM job after the training job:
    sbatch --dependency=afterok:<train job> --wrap \\
        "python examples/cluster_eval_attach.py <run id>"

``<run id>`` is the training run's id (``run.id``; the runs table shows it).
The model is the training run's ``log_model`` artifact,
``run-<run id>-model.json:latest``; pass ``--model <ref>`` for another one.

Shared filesystem or HTTP: the evaluation job needs the same repo as the
training run: the same directory (NFS, Lustre) or the same server
(``CAIRN_REPO=cairn://<server>:4300`` plus ``CAIRN_TOKEN``).

Requirements: none beyond cairn.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cairn

PROJECT = "eval-attach"


def make_data(n: int, seed: int) -> list[tuple[float, float]]:
    """Points of y = 3x - 1 plus noise."""
    rng = random.Random(seed)
    return [(x, 3 * x - 1 + rng.gauss(0, 0.1)) for x in (rng.uniform(-1, 1) for _ in range(n))]


def train(repo: str | None, workdir: Path) -> str:
    """The training job: fit y = w x + b, log the model, return the run id."""
    data = make_data(256, seed=0)
    w = b = 0.0
    steps, lr = 200, 0.1
    with cairn.Run(PROJECT, name="regressor", repo=repo, capture_source=False,
                   total_steps=steps) as run:
        run.config(lr=lr, steps=steps)
        for step in range(steps):
            gw = sum(2 * (w * x + b - y) * x for x, y in data) / len(data)
            gb = sum(2 * (w * x + b - y) for x, y in data) / len(data)
            w, b = w - lr * gw, b - lr * gb
            loss = sum((w * x + b - y) ** 2 for x, y in data) / len(data)
            run.track(loss, "train.loss", step=step)
        path = workdir / "model.json"
        path.write_text(json.dumps({"w": w, "b": b, "step": steps - 1}))
        run.log_model(path)  # artifact "run-<run id>-model.json", type "model"
        print(f"trained: w={w:.3f} b={b:.3f}")
        return run.id


def evaluate(run_id: str, repo: str | None, model_ref: str | None = None) -> None:
    """The evaluation job: join the finished run as ``eval`` and log results."""
    ref = model_ref or f"run-{run_id}-model.json:latest"
    with cairn.attach(run_id, label="eval", repo=repo) as run:
        model_dir = Path(run.use_model(ref))  # recorded as this run's input
        model = json.loads((model_dir / "model.json").read_text())
        test = make_data(512, seed=1)
        mse = sum((model["w"] * x + model["b"] - y) ** 2 for x, y in test) / len(test)
        # At the training run's last step, so it lines up with the training curves.
        run.track(mse, "eval.mse", step=model["step"])
        run.track(math.sqrt(mse), "eval.rmse", step=model["step"])
        run.summary(eval={"mse": mse, "model": ref})
        print(f"evaluated {ref}: test mse={mse:.5f}")


def demo() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="cairn_eval_attach_"))
    repo = str(tmp / ".cairn")
    print(f"Repo: {repo}")
    run_id = train(repo, tmp)
    # ... later, in another job:
    evaluate(run_id, repo)

    # --- Verify (the Reader ingests the run logs first) ---------------
    reader = cairn.Reader(repo=repo)
    run = reader.run(run_id)
    print(f"\nrun {run.id}: status={run.status}")
    for name in ("train.loss", "eval.mse", "eval.rmse"):
        seq = run.sequence(name)
        print(f"  {name:<10s} {len(seq):>3d} points, last={seq.values[-1]:.5f} at step {seq.steps[-1]}")
    print(f"  summary: {run.summary}")
    print(f"  used:    {[a.ref for a in run.used_artifacts()]}")
    print(f"  logged:  {[a.ref for a in run.logged_artifacts()]}")
    print(f"  console: {[(ln.label, ln.content) for ln in run.logs()]}")
    reader.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("run_id", nargs="?", help="the finished training run to evaluate")
    parser.add_argument("--model", help="model artifact ref (default: the run's log_model)")
    parser.add_argument("--demo", action="store_true", help="train, then evaluate, in a scratch repo")
    args = parser.parse_args()
    if args.demo:
        demo()
    elif args.run_id:
        evaluate(args.run_id, repo=None, model_ref=args.model)
    else:
        parser.error("give a run id, or --demo")


if __name__ == "__main__":
    main()
