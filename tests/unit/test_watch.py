"""run.watch: gradient/parameter histograms of a torch module."""

from __future__ import annotations

import pytest

import cairn

torch = pytest.importorskip("torch")


def _run(repo):
    return cairn.Run(project="w", repo=repo, capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False)


def _train(run, model, steps):
    opt = torch.optim.SGD(model.parameters(), lr=0.1)
    x, y = torch.randn(16, 4), torch.randn(16, 1)
    for step in range(steps):
        loss = torch.nn.functional.mse_loss(model(x), y)
        opt.zero_grad()
        loss.backward()
        opt.step()
        run.track(loss.item(), name="loss", step=step)


def _read(repo):
    reader = cairn.Reader(repo=repo)
    run = reader.runs("w").list()[0]
    return reader, run


def _mlp():
    torch.manual_seed(0)
    return torch.nn.Sequential(torch.nn.Linear(4, 8), torch.nn.ReLU(), torch.nn.Linear(8, 1))


def test_watch_all_records_gradients_and_parameters(tmp_path):
    repo = tmp_path / ".cairn"
    model = _mlp()
    with _run(repo) as run:
        run.watch(model, log="all", every=2)
        _train(run, model, 5)
    reader, run = _read(repo)
    try:
        names = {s.name for s in run.sequences()}
        params = {n for n, _ in model.named_parameters()}
        assert {f"gradients/{p}" for p in params} <= names
        assert {f"parameters/{p}" for p in params} <= names
        # Passes 0, 2, 4 log; each takes the last step tracked before it.
        assert run.sequence("gradients/0.weight").steps == [0, 1, 3]
        assert run.sequence("parameters/2.bias").steps == [0, 1, 3]
        counts, edges = run.artifact("gradients/0.weight", step=3)
        assert len(edges) == len(counts) + 1 == 65
        assert counts.sum() == model[0].weight.numel()
    finally:
        reader.close()


def test_watch_gradients_only_by_default(tmp_path):
    repo = tmp_path / ".cairn"
    model = _mlp()
    with _run(repo) as run:
        run.watch(model, every=1)
        _train(run, model, 2)
    reader, run = _read(repo)
    try:
        names = {s.name for s in run.sequences()}
        assert "gradients/0.weight" in names
        assert not any(n.startswith("parameters/") for n in names)
    finally:
        reader.close()


def test_unwatch_removes_the_hooks(tmp_path):
    repo = tmp_path / ".cairn"
    model = _mlp()
    with _run(repo) as run:
        run.watch(model, log="parameters", every=1)
        _train(run, model, 1)
        run.unwatch(model)
        assert not model._forward_pre_hooks
        _train(run, model, 3)
    reader, run = _read(repo)
    try:
        assert run.sequence("parameters/0.weight").steps == [0]
    finally:
        reader.close()


def test_non_finite_values_are_dropped_and_constant_tensors_bin(tmp_path):
    repo = tmp_path / ".cairn"
    model = torch.nn.Linear(2, 1)
    with torch.no_grad():
        model.weight.copy_(torch.tensor([[float("nan"), float("inf")]]))
        model.bias.fill_(3.0)
    with _run(repo) as run:
        run.watch(model, log="parameters", every=1)
        model(torch.zeros(1, 2))
    reader, run = _read(repo)
    try:
        names = {s.name for s in run.sequences()}
        assert "parameters/weight" not in names  # nothing finite
        counts, edges = run.artifact("parameters/bias", step=0)
        assert counts.sum() == 1 and edges[0] < 3.0 < edges[-1]
    finally:
        reader.close()


def test_watch_rejects_bad_arguments(tmp_path):
    with _run(tmp_path / ".cairn") as run:
        with pytest.raises(ValueError):
            run.watch(_mlp(), log="weights")
        with pytest.raises(ValueError):
            run.watch(_mlp(), every=0)
