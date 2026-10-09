"""Organising runs: group, job_type, name, versions and lineage, end to end.

A small fake pipeline (no real training, a few seconds on a CPU) in project
``organise-demo`` that uses every part of how cairn organises runs:

- **group** = the runs that belong together: experiment ``exp-1`` (a whole
  pipeline) and ``seeds-lr3e-4`` (one configuration over several seeds).
- **job_type** = the run's role in its group: ``prepare`` → ``train`` →
  ``finetune`` → ``eval``.
- **name** = a free label. Runs that share (group, job_type, name) form a
  series, and the server numbers them: the second ``prepare`` and the second
  ``base`` in ``exp-1`` are **v2** (re-runs). Runs with distinct names (the
  fine-tune siblings, the seeds) are each **v1**.
- **seeds**: three ``train`` runs in ``seeds-lr3e-4`` that differ only in
  ``config.seed``. Grouped by group, the workspace draws them as one mean line
  with a min–max band.
- **fine-tune fan-out**: one base ``train`` run, three ``finetune`` runs that
  each declare ``uses=[base]`` (a run link) and take its model with
  ``use_artifact`` (an artifact link); an ``eval`` run links all three with
  ``use_run``.
- **metric rules**: ``track(..., summary="min" / "max", x="epoch")`` decide each
  metric's final value (best loss, best accuracy) and plot the ``val.*``
  series against ``epoch``.

At the end a ``Reader`` prints each run's group, job type, name, version and
links.

Usage::

    uv run cairn init /tmp/cairn-organise
    CAIRN_REPO=/tmp/cairn-organise/.cairn uv run python examples/organise_runs.py
    uv run cairn ui --repo /tmp/cairn-organise/.cairn

    # browse the project ``organise-demo``:
    #   - Workspace: the sidebar groups by group, then job type
    #     (Group: exp-1 > Job Type: finetune > ft-cifar, ...); the charts draw
    #     one line per innermost group. Click ``seeds-lr3e-4`` to filter to it.
    #   - Runs table: Group and Job Type columns, ``prepare v2`` / ``base v2``;
    #     **Latest only** hides the v1 re-runs.
    #   - A fine-tune run's Overview: ``Inputs ← base v2 · base-model:v2``;
    #     the base run's: ``Used by → ft-cifar v1 · ...``.
    #   - Lineage: prepare → data → base → base-model → ft-* → eval.

Running the script again continues every series: ``prepare`` and ``base``
get v3 and v4, the fine-tune, eval and seed runs v2.
"""

from __future__ import annotations

import math
import random

import time

import cairn

PROJECT = "organise-demo"
# Keep the demo fast: skip system metrics per run (the source snapshot stays on, the default).
QUIET = dict(capture_system_metrics=False)
# The ids of the runs this script creates, to wait for them before reading back.
CREATED: list[str] = []
EPOCHS = 4
STEPS_PER_EPOCH = 10


def fake_training(run: cairn.Run, rng: random.Random, *, start: float, rate: float) -> None:
    """Log a train loss per step and validation metrics per epoch, with the
    metric rules: the best loss and accuracy are the final values, and the
    validation series plot against ``epoch``."""
    for step in range(EPOCHS * STEPS_PER_EPOCH):
        loss = start * math.exp(-rate * step) + 0.05 * rng.random()
        run.track(loss, "train.loss", step, summary="min")
        if (step + 1) % STEPS_PER_EPOCH == 0:
            epoch = (step + 1) // STEPS_PER_EPOCH
            run.track(epoch, "epoch", step)
            run.track(loss * 1.1 + 0.02 * rng.random(), "val.loss", step, summary="min", x="epoch")
            run.track(1.0 - loss / (start + 1) - 0.02 * rng.random(), "val.acc", step,
                      summary="max", x="epoch")


def prepare(group: str, rows: int) -> cairn.ArtifactVersion:
    """``prepare``: build the dataset and log it as an artifact."""
    with cairn.Run(PROJECT, name="prepare", group=group, job_type="prepare", **QUIET) as run:
        CREATED.append(run.id)
        run.config(rows=rows)
        return run.log_artifact({"rows": rows, "features": 16}, f"data-{group}", type="dataset")


def train_base(group: str, data: cairn.ArtifactVersion, lr: float) -> tuple[cairn.Run, cairn.ArtifactVersion]:
    """``train``: the base model, trained on the dataset."""
    rng = random.Random(0)
    with cairn.Run(PROJECT, name="base", group=group, job_type="train", **QUIET) as run:
        CREATED.append(run.id)
        run.use_artifact(data)
        run.config(lr=lr, seed=0)
        fake_training(run, rng, start=2.0, rate=lr * 30)
        model = run.log_artifact({"weights": [rng.random() for _ in range(8)]}, "base-model",
                                 type="model", aliases=["best"])
    return run, model


def finetune(group: str, base: cairn.Run, model: cairn.ArtifactVersion, task: str, i: int) -> cairn.Run:
    """``finetune``: one sibling per task, all starting from the base run's model."""
    rng = random.Random(10 + i)
    with cairn.Run(PROJECT, name=f"ft-{task}", group=group, job_type="finetune",
                   uses=[base], **QUIET) as run:
        CREATED.append(run.id)
        run.use_artifact(model)
        run.config(task=task, lr=1e-4, seed=0)
        fake_training(run, rng, start=0.8 + 0.2 * i, rate=0.08)
    return run


def evaluate(group: str, finetuned: list[cairn.Run]) -> None:
    """``eval``: reads the fine-tuned runs' results, so it links them with
    ``use_run`` (no artifact between them)."""
    with cairn.Run(PROJECT, name="eval", group=group, job_type="eval", **QUIET) as run:
        CREATED.append(run.id)
        for ft in finetuned:
            run.use_run(ft, role="evaluated")
        for i, ft in enumerate(finetuned):
            run.track(0.7 + 0.05 * i, "eval.acc", step=i, summary="max")
        run.summary(n_models=len(finetuned))


def seeds(group: str, lr: float, n: int) -> None:
    """One configuration, several seeds: distinct names, so each is v1."""
    for seed in range(n):
        rng = random.Random(seed)
        with cairn.Run(PROJECT, name=f"seed-{seed}", group=group, job_type="train", **QUIET) as run:
            CREATED.append(run.id)
            run.config(lr=lr, seed=seed)
            fake_training(run, rng, start=2.0 + 0.3 * rng.random(), rate=lr * 30)


def main() -> None:
    group = "exp-1"
    # The pipeline's first pass ...
    data = prepare(group, rows=1000)                # prepare v1 -> data-exp-1:v1
    train_base(group, data, lr=3e-3)                # base v1 -> base-model:v1
    # ... and a re-run of both (say, after a bug fix in the data loader):
    # same group, job type and name, so the server makes them v2.
    data = prepare(group, rows=1200)                # prepare v2 -> data-exp-1:v2
    base, model = train_base(group, data, lr=1e-3)  # base v2 -> base-model:v2
    finetuned = [finetune(group, base, model, task, i)
                 for i, task in enumerate(["cifar", "svhn", "imagenet"])]
    evaluate(group, finetuned)

    seeds("seeds-lr3e-4", lr=3e-3, n=3)

    # A viewer that is running holds the repo's ingest lease, and a Reader then
    # sees what it has ingested so far (a moment behind): wait for our runs.
    deadline = time.monotonic() + 30
    while True:
        with cairn.Reader() as reader:
            ids = {r.id for r in reader.runs(PROJECT).list()}
        if set(CREATED) <= ids or time.monotonic() > deadline:
            break
        time.sleep(0.5)

    with cairn.Reader() as reader:
        runs = reader.runs(PROJECT).list()
        print(f"\n{len(runs)} runs in project {PROJECT!r}:")
        print(f"  {'group':<14} {'job_type':<9} {'name':<12} {'ver':<4} {'uses':<38} {'used by'}")
        for r in runs:
            uses = ", ".join(f"{u.name} v{u.version}" for u in r.uses()) or "-"
            used_by = ", ".join(sorted({f"{u.name} v{u.version}" for u in r.used_by()})) or "-"
            print(f"  {r.group or '-':<14} {r.job_type or '-':<9} {r.name:<12} "
                  f"v{r.version!s:<3} {uses:<38} {used_by}")
        ft = next(r for r in runs if r.name == "ft-cifar")
        print("\nft-cifar's inputs:", [a.ref for a in ft.used_artifacts()])
        print("Metric rules:", reader.metric_rules(PROJECT))


if __name__ == "__main__":
    main()
