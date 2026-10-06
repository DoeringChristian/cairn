"""Model checkpoints as artifacts (Lightning, HuggingFace, Keras) and the
Ultralytics callbacks: fake trainers and checkpoint callbacks against a real
repo, read back through the Reader. The real trainings are in
tests/integration/test_integration_smoke.py."""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

import cairn

_RUN_KW = {
    "capture_source": False,
    "capture_stdout": False,
    "capture_env": False,
    "capture_system_metrics": False,
}


@pytest.fixture(autouse=True)
def _reset_capture_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _importorskip(name: str):
    try:
        return __import__(name)
    except Exception as exc:  # noqa: BLE001 - e.g. Keras without a backend
        pytest.skip(f"{name} unavailable: {exc}")


def _versions(repo: Path, project: str, name: str) -> list[dict]:
    """Every version of ``name``: aliases, file paths, metadata, step."""
    with cairn.Reader(repo) as reader:
        return [
            {"aliases": set(v.aliases), "files": sorted(e.path for e in v.files()),
             "metadata": v.metadata, "step": v.step, "type": v.type,
             "bytes": {e.path: e.read() for e in v.files()}}
            for v in reader.artifact_versions(name, project=project)
        ]


def _touch(path: Path, data: bytes, mtime: float) -> None:
    path.write_bytes(data)
    os.utime(path, (mtime, mtime))


# ---- Lightning ---------------------------------------------------------------


class _FakeModelCheckpoint:
    """What the logger reads off Lightning's ModelCheckpoint."""

    def __init__(self, monitor: str | None = "val_loss"):
        self.monitor = monitor
        self.best_k_models: dict[str, float] = {}
        self.best_model_path = ""
        self.best_model_score = None
        self.last_model_path = ""
        self.current_score = None


def _lightning_save(torch, cb, d: Path, epoch: int, score: float, t: float, best: bool) -> None:
    """One epoch of ModelCheckpoint(save_top_k=-1, save_last=True)."""
    path = d / f"epoch={epoch}.ckpt"
    torch.save({"epoch": epoch, "global_step": 4 * (epoch + 1)}, path)
    os.utime(path, (t, t))
    cb.best_k_models[str(path)] = torch.tensor(score)
    cb.current_score = torch.tensor(score)
    if best:
        cb.best_model_path, cb.best_model_score = str(path), torch.tensor(score)
    last = d / "last.ckpt"
    torch.save({"epoch": epoch, "global_step": 4 * (epoch + 1)}, last)
    os.utime(last, (t + 1, t + 1))
    cb.last_model_path = str(last)


@pytest.mark.parametrize("mode", ["all", True])
def test_lightning_log_model(tmp_path, mode):
    torch = _importorskip("torch")
    _importorskip("lightning")
    from cairn.integrations.lightning import CairnLogger

    repo = tmp_path / ".cairn"
    logger = CairnLogger(project="lit", repo=repo, log_model=mode, **_RUN_KW)
    run_id = logger.experiment.id
    cb = _FakeModelCheckpoint()
    _lightning_save(torch, cb, tmp_path, 0, 0.5, 1000.0, best=True)
    logger.after_save_checkpoint(cb)
    _lightning_save(torch, cb, tmp_path, 1, 0.7, 2000.0, best=False)
    logger.after_save_checkpoint(cb)
    logger.after_save_checkpoint(cb)  # nothing new: nothing logged twice
    logger.finalize("success")

    got = _versions(repo, "lit", f"model-{run_id}")
    names = [v["metadata"]["original_filename"] for v in got]
    if mode == "all":
        # As saved: epoch 0 and its last.ckpt, then epoch 1 and the overwritten last.ckpt.
        assert names == ["epoch=0.ckpt", "last.ckpt", "epoch=1.ckpt", "last.ckpt"]
    else:
        # Once, at the end: the files still on disk, oldest first.
        assert names == ["epoch=0.ckpt", "epoch=1.ckpt", "last.ckpt"]
    assert got[0]["aliases"] == {"best"}
    assert got[-1]["aliases"] == {"latest"}
    assert all(v["type"] == "model" and len(v["files"]) == 1 for v in got)
    assert got[0]["files"] == ["epoch=0.ckpt"]
    first = got[0]["metadata"]
    assert first["score"] == pytest.approx(0.5)
    assert first["monitor"] == "val_loss"
    assert (first["epoch"], first["global_step"]) == (0, 4)
    assert got[-1]["metadata"]["epoch"] == 1


def test_lightning_log_model_true_skips_failed_runs(tmp_path):
    torch = _importorskip("torch")
    _importorskip("lightning")
    from cairn.integrations.lightning import CairnLogger

    repo = tmp_path / ".cairn"
    logger = CairnLogger(project="lit", repo=repo, log_model=True, **_RUN_KW)
    run_id = logger.experiment.id
    cb = _FakeModelCheckpoint()
    _lightning_save(torch, cb, tmp_path, 0, 0.5, 1000.0, best=True)
    logger.after_save_checkpoint(cb)
    logger.finalize("failed")
    with cairn.Reader(repo) as reader, pytest.raises(LookupError):
        reader.artifact_versions(f"model-{run_id}", project="lit")


def test_lightning_no_best_alias_without_monitor(tmp_path):
    torch = _importorskip("torch")
    _importorskip("lightning")
    from cairn.integrations.lightning import CairnLogger

    repo = tmp_path / ".cairn"
    logger = CairnLogger(project="lit", repo=repo, log_model="all", **_RUN_KW)
    cb = _FakeModelCheckpoint(monitor=None)
    _lightning_save(torch, cb, tmp_path, 0, 0.5, 1000.0, best=True)
    logger.after_save_checkpoint(cb)
    logger.finalize("success")
    got = _versions(repo, "lit", f"model-{logger.experiment.id}")
    assert all("best" not in v["aliases"] for v in got)


def test_lightning_watch_and_bad_log_model():
    _importorskip("lightning")
    from unittest.mock import MagicMock

    from cairn.integrations.lightning import CairnLogger

    run = MagicMock()
    model = object()
    CairnLogger(run=run).watch(model, log="all", log_freq=10)
    run.watch.assert_called_once_with(model, log="all", every=10)
    with pytest.raises(ValueError):
        CairnLogger(log_model="best")


# ---- HuggingFace -------------------------------------------------------------


def _hf_args(tmp_path: Path, **kw) -> SimpleNamespace:
    return SimpleNamespace(output_dir=str(tmp_path / "out"), to_dict=dict, deepspeed=None,
                           load_best_model_at_end=False, metric_for_best_model=None, **kw)


def _hf_state(step: int, zero: bool = True) -> SimpleNamespace:
    return SimpleNamespace(global_step=step, epoch=step / 4, is_world_process_zero=zero,
                           best_metric=0.25, best_model_checkpoint=None)


def test_hf_log_model_checkpoint(tmp_path):
    _importorskip("transformers")
    from cairn.integrations.huggingface import CairnCallback

    repo = tmp_path / ".cairn"
    args = _hf_args(tmp_path)
    cb = CairnCallback(project="hf", repo=repo, log_model="checkpoint", **_RUN_KW)
    cb.on_train_begin(args, _hf_state(0), None)
    for step in (2, 4):
        d = Path(args.output_dir) / f"checkpoint-{step}"
        d.mkdir(parents=True)
        (d / "model.safetensors").write_bytes(b"w%d" % step)
        (d / "trainer_state.json").write_text("{}")
        cb.on_save(args, _hf_state(step), None)
    cb.on_save(args, _hf_state(6, zero=False), None)  # not the main process: nothing
    run_id = cb.run.id
    cb.on_train_end(args, _hf_state(4), None, model=None)

    got = _versions(repo, "hf", f"checkpoint-{run_id}")
    assert [v["aliases"] for v in got] == [{"checkpoint-2"}, {"latest", "checkpoint-4"}]
    assert got[1]["files"] == ["model.safetensors", "trainer_state.json"]
    assert got[1]["bytes"]["model.safetensors"] == b"w4"
    assert got[1]["step"] == 4 and got[1]["type"] == "model"
    with cairn.Reader(repo) as reader, pytest.raises(LookupError):  # "end" only
        reader.artifact_versions(f"model-{run_id}", project="hf")


@pytest.mark.parametrize("best", [False, True])
def test_hf_log_model_end(tmp_path, monkeypatch, best):
    _importorskip("transformers")
    from cairn.integrations import huggingface
    from cairn.integrations.huggingface import CairnCallback

    saved = {}

    def fake_save(args, model, processing_class, out):
        saved.update(model=model, processing_class=processing_class)
        Path(out, "config.json").write_text("{}")
        Path(out, "model.safetensors").write_bytes(b"final")

    monkeypatch.setattr(huggingface, "_save_model", fake_save)
    repo = tmp_path / ".cairn"
    args = _hf_args(tmp_path)
    args.load_best_model_at_end = best
    args.metric_for_best_model = "loss" if best else None
    cb = CairnCallback(project="hf", repo=repo, log_model="end", **_RUN_KW)
    cb.on_train_begin(args, _hf_state(0), None)
    run_id = cb.run.id
    cb.on_save(args, _hf_state(2), None)  # "checkpoint" only: nothing
    cb.on_train_end(args, _hf_state(8), None, model="M", processing_class="T")

    assert saved == {"model": "M", "processing_class": "T"}
    got = _versions(repo, "hf", f"model-{run_id}")
    assert len(got) == 1
    assert got[0]["files"] == ["config.json", "model.safetensors"]
    assert got[0]["aliases"] == ({"latest", "best"} if best else {"latest"})
    assert got[0]["step"] == 8
    if best:
        assert got[0]["metadata"]["best_metric"] == 0.25
    with cairn.Reader(repo) as reader:
        assert reader.run(run_id).status == "completed"
        with pytest.raises(LookupError):
            reader.artifact_versions(f"checkpoint-{run_id}", project="hf")


def test_hf_bad_log_model():
    _importorskip("transformers")
    from cairn.integrations.huggingface import CairnCallback

    with pytest.raises(ValueError):
        CairnCallback(log_model=True)


# ---- Keras -------------------------------------------------------------------


def _keras():
    os.environ.setdefault("KERAS_BACKEND", "torch")
    return _importorskip("keras")


class _FakeKerasModel:
    """What ModelCheckpoint calls on the model: save()."""

    def save(self, filepath, overwrite=True):
        Path(filepath).write_bytes(b"model")


def _keras_fit(cb, model, val_losses):
    cb.set_model(model)
    cb.on_train_begin()
    for epoch, val in enumerate(val_losses):
        cb.on_epoch_begin(epoch)
        cb.on_epoch_end(epoch, {"loss": 1.0, "val_loss": val})
    cb.on_train_end()


@pytest.mark.parametrize("save_best_only", [False, True])
def test_keras_model_checkpoint(tmp_path, save_best_only):
    _keras()
    from cairn.integrations.keras import CairnModelCheckpoint

    repo = tmp_path / ".cairn"
    run = cairn.Run(project="k", repo=repo, **_RUN_KW)
    ckpt = CairnModelCheckpoint(str(tmp_path / "m-{epoch}.keras"), monitor="val_loss", mode="min",
                                save_best_only=save_best_only, run=run)
    _keras_fit(ckpt, _FakeKerasModel(), [0.5, 0.4, 0.7])
    run.finish()

    got = _versions(repo, "k", f"model-{run.id}")
    names = [v["metadata"]["original_filename"] for v in got]
    if save_best_only:
        assert names == ["m-1.keras", "m-2.keras"]
        assert [v["aliases"] for v in got] == [set(), {"latest", "best"}]
    else:
        assert names == ["m-1.keras", "m-2.keras", "m-3.keras"]
        assert [v["aliases"] for v in got] == [set(), {"best"}, {"latest"}]
    assert got[0]["files"] == ["m-1.keras"] and got[0]["type"] == "model"
    assert got[0]["metadata"]["score"] == pytest.approx(0.5)


def test_keras_model_checkpoint_uses_the_fits_cairn_callback(tmp_path):
    _keras()
    from cairn.integrations.keras import CairnCallback, CairnModelCheckpoint

    repo = tmp_path / ".cairn"
    model = _FakeKerasModel()
    cairn_cb = CairnCallback(project="k", repo=repo, **_RUN_KW)
    from unittest.mock import MagicMock

    other = MagicMock()  # the explicit run, which the fit's CairnCallback overrides
    ckpt = CairnModelCheckpoint(str(tmp_path / "m.keras"), monitor="val_loss", mode="min", run=other)
    ckpt.set_model(model)
    cairn_cb.set_model(model)
    # The checkpoint callback first: the run is looked up after every on_train_begin.
    ckpt.on_train_begin()
    cairn_cb.on_train_begin()
    ckpt.on_epoch_begin(0)
    ckpt.on_epoch_end(0, {"val_loss": 0.3})
    cairn_cb.on_train_end()
    other.log_artifact.assert_not_called()

    got = _versions(repo, "k", f"model-{cairn_cb.run.id}")
    assert len(got) == 1 and got[0]["aliases"] == {"latest", "best"}


def test_keras_model_checkpoint_without_a_run_says_so(tmp_path):
    _keras()
    from cairn.integrations.keras import CairnModelCheckpoint

    ckpt = CairnModelCheckpoint(str(tmp_path / "m.keras"))
    ckpt.set_model(_FakeKerasModel())
    ckpt.on_train_begin()
    with pytest.raises(RuntimeError, match="CairnCallback"):
        ckpt.on_epoch_begin(0)


# ---- Ultralytics -------------------------------------------------------------


@pytest.fixture
def ultralytics_integration(monkeypatch):
    """cairn.integrations.ultralytics, against a stand-in ``ultralytics.utils``
    (it only reads RANK): importing the real one writes Ultralytics' settings
    file into the home directory."""
    monkeypatch.delitem(sys.modules, "cairn.integrations.ultralytics", raising=False)
    pkg, utils = types.ModuleType("ultralytics"), types.ModuleType("ultralytics.utils")
    utils.RANK = -1
    pkg.utils = utils
    monkeypatch.setitem(sys.modules, "ultralytics", pkg)
    monkeypatch.setitem(sys.modules, "ultralytics.utils", utils)
    import cairn.integrations.ultralytics as mod

    yield mod
    sys.modules.pop("cairn.integrations.ultralytics", None)


class _FakeYOLO:
    def __init__(self):
        self.callbacks: dict[str, list] = {}

    def add_callback(self, event, fn):
        self.callbacks.setdefault(event, []).append(fn)

    def fire(self, event, trainer):
        for fn in self.callbacks.get(event, []):
            fn(trainer)


def _png(path: Path, color) -> None:
    from PIL import Image as PILImage

    PILImage.new("RGB", (8, 6), color).save(path)


def test_ultralytics_callbacks(tmp_path, ultralytics_integration):
    _importorskip("PIL")
    save_dir = tmp_path / "runs" / "train"
    (save_dir / "weights").mkdir(parents=True)
    repo = tmp_path / ".cairn"
    model = _FakeYOLO()
    cbs = ultralytics_integration.add_cairn_callbacks(model, project="yolo", repo=repo, **_RUN_KW)
    assert set(model.callbacks) == {"on_pretrain_routine_start", "on_train_epoch_end",
                                    "on_fit_epoch_end", "on_train_end"}

    trainer = SimpleNamespace(
        args=SimpleNamespace(name="train", data="coco8.yaml", imgsz=64, save_dir=save_dir),
        save_dir=save_dir, epoch=0, tloss=[1.0, 2.0],
        label_loss_items=lambda tloss, prefix: {f"{prefix}/box_loss": tloss[0], f"{prefix}/cls_loss": tloss[1]},
        lr={"lr/pg0": 0.01}, metrics={"metrics/mAP50(B)": 0.1, "val/box_loss": 1.5},
        best=save_dir / "weights" / "best.pt", last=save_dir / "weights" / "last.pt",
    )
    model.fire("on_pretrain_routine_start", trainer)
    for epoch in range(2):
        trainer.epoch = epoch
        model.fire("on_train_epoch_end", trainer)
        model.fire("on_fit_epoch_end", trainer)
    trainer.epoch = 2  # the trainer's final validation of best.pt
    model.fire("on_fit_epoch_end", trainer)
    trainer.epoch = 1
    for name in ("val_batch0_pred.jpg", "val_batch1_pred.jpg"):
        _png(save_dir / name, "red")
    for name in ("results.png", "confusion_matrix.png", "confusion_matrix_normalized.png", "BoxPR_curve.png"):
        _png(save_dir / name, "blue")
    trainer.best.write_bytes(b"best")
    trainer.last.write_bytes(b"last")
    model.fire("on_train_end", trainer)

    run_id = cbs.run.id
    with cairn.Reader(repo) as reader:
        run = reader.run(run_id)
        assert run.status == "completed" and run.name == "train"
        assert run.config["imgsz"] == 64 and run.config["save_dir"] == str(save_dir)
        assert run.sequence("train/box_loss").steps == [0, 1]
        assert run.sequence("lr/pg0").values == [0.01, 0.01]
        assert run.sequence("metrics/mAP50(B)").steps == [0, 1, 2]
        seqs = {s.name: s for s in run.sequences()}
        assert seqs["val/predictions"].count == 1  # one gallery point
        assert {"plots/results", "plots/confusion_matrix", "plots/confusion_matrix_normalized",
                "plots/BoxPR_curve"} <= set(seqs)
    got = _versions(repo, "yolo", f"model-{run_id}")
    assert [v["files"] for v in got] == [["best.pt"], ["last.pt"]]
    assert [v["aliases"] for v in got] == [{"best"}, {"latest"}]
    assert got[1]["bytes"]["last.pt"] == b"last"


def test_ultralytics_other_ranks_log_nothing(tmp_path, ultralytics_integration, monkeypatch):
    monkeypatch.setattr(ultralytics_integration, "RANK", 1)
    model = _FakeYOLO()
    cbs = ultralytics_integration.add_cairn_callbacks(model, repo=tmp_path / ".cairn", **_RUN_KW)
    model.fire("on_pretrain_routine_start", SimpleNamespace(args=SimpleNamespace(name="t")))
    assert cbs.run is None
