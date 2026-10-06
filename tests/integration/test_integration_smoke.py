"""Real (tiny, CPU) trainings through each integration that logs models,
checked through the Reader: the checkpoint artifact versions, their aliases
and their files. Each test skips when its framework is not installed."""

from __future__ import annotations

import os
from pathlib import Path

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


def _versions(repo: Path, project: str, name: str) -> list[cairn.ArtifactVersion]:
    with cairn.Reader(repo) as reader:
        return reader.artifact_versions(name, project=project)


def _files(v: cairn.ArtifactVersion) -> list[str]:
    return sorted(e.path for e in v.files())


# ---- Lightning ---------------------------------------------------------------


@pytest.mark.timeout(300)
@pytest.mark.parametrize("mode", [True, "all"])
def test_lightning_log_model(tmp_path, mode):
    torch = _importorskip("torch")
    L = _importorskip("lightning")
    from lightning.pytorch.callbacks import ModelCheckpoint

    from cairn.integrations.lightning import CairnLogger

    class Tiny(L.LightningModule):
        def __init__(self):
            super().__init__()
            self.layer = torch.nn.Linear(2, 1)

        def _loss(self, batch):
            x, y = batch
            return torch.nn.functional.mse_loss(self.layer(x), y)

        def training_step(self, batch, _):
            return self._loss(batch)

        def validation_step(self, batch, _):
            self.log("val_loss", self._loss(batch))

        def configure_optimizers(self):
            return torch.optim.SGD(self.parameters(), lr=0.1)

    torch.manual_seed(0)
    ds = torch.utils.data.TensorDataset(torch.randn(16, 2), torch.randn(16, 1))
    dl = torch.utils.data.DataLoader(ds, batch_size=4)
    repo = tmp_path / ".cairn"
    logger = CairnLogger(project="lit", repo=repo, log_model=mode, **_RUN_KW)
    ckpt = ModelCheckpoint(dirpath=tmp_path / "ckpt", monitor="val_loss", save_top_k=1, save_last=True)
    trainer = L.Trainer(
        max_epochs=2, logger=logger, callbacks=[ckpt], enable_progress_bar=False,
        enable_model_summary=False, default_root_dir=tmp_path, accelerator="cpu",
    )
    trainer.fit(Tiny(), dl, dl)
    run_id = logger.experiment.id

    versions = _versions(repo, "lit", f"model-{run_id}")
    names = [v.metadata["original_filename"] for v in versions]
    assert all(len(_files(v)) == 1 and _files(v)[0].endswith(".ckpt") for v in versions)
    assert len(names) == len(set(zip(names, (v.metadata["global_step"] for v in versions))))  # no duplicates
    if mode == "all":
        assert names.count("last.ckpt") == 2  # one per epoch: last.ckpt is overwritten
    else:
        assert names.count("last.ckpt") == 1
    latest = next(v for v in versions if "latest" in v.aliases)
    assert latest is versions[-1] and latest.metadata["original_filename"] == "last.ckpt"
    assert latest.metadata["epoch"] == 1
    best = next(v for v in versions if "best" in v.aliases)
    assert best.metadata["original_filename"] == Path(ckpt.best_model_path).name
    assert best.metadata["score"] == pytest.approx(float(ckpt.best_model_score))
    assert best.metadata["monitor"] == "val_loss"
    assert best.get_entry(_files(best)[0]).read() == Path(ckpt.best_model_path).read_bytes()


# ---- HuggingFace -------------------------------------------------------------


def _hf_trainer(tmp_path, callback, **args_kw):
    torch = _importorskip("torch")
    transformers = _importorskip("transformers")
    _importorskip("accelerate")

    config = transformers.BertConfig(vocab_size=32, hidden_size=8, num_hidden_layers=1,
                                     num_attention_heads=2, intermediate_size=8, num_labels=2)
    model = transformers.BertForSequenceClassification(config)
    g = torch.Generator().manual_seed(0)
    data = [{"input_ids": torch.randint(0, 32, (6,), generator=g), "labels": torch.tensor(i % 2)}
            for i in range(8)]
    args = transformers.TrainingArguments(
        output_dir=str(tmp_path / "out"), max_steps=4, save_steps=2, save_strategy="steps",
        per_device_train_batch_size=2, report_to=[], use_cpu=True, logging_steps=1, **args_kw,
    )
    return transformers.Trainer(model=model, args=args, train_dataset=data, eval_dataset=data[:4],
                                callbacks=[callback])


@pytest.mark.timeout(300)
def test_hf_log_model_checkpoint(tmp_path):
    _importorskip("transformers")
    from cairn.integrations.huggingface import CairnCallback

    repo = tmp_path / ".cairn"
    cb = CairnCallback(project="hf", repo=repo, log_model="checkpoint", **_RUN_KW)
    _hf_trainer(tmp_path, cb).train()

    versions = _versions(repo, "hf", f"checkpoint-{cb.run.id}")
    assert [set(v.aliases) for v in versions] == [{"checkpoint-2"}, {"latest", "checkpoint-4"}]
    for v, step in zip(versions, (2, 4)):
        files = _files(v)
        assert "config.json" in files and "trainer_state.json" in files
        assert any(f.startswith("model.") for f in files)
        assert v.step == step and v.type == "model"


@pytest.mark.timeout(300)
def test_hf_log_model_end(tmp_path):
    _importorskip("transformers")
    from cairn.integrations.huggingface import CairnCallback

    repo = tmp_path / ".cairn"
    cb = CairnCallback(project="hf", repo=repo, log_model="end", **_RUN_KW)
    _hf_trainer(tmp_path, cb, eval_strategy="steps", eval_steps=2, load_best_model_at_end=True,
                metric_for_best_model="loss").train()

    versions = _versions(repo, "hf", f"model-{cb.run.id}")
    assert len(versions) == 1
    v = versions[0]
    assert set(v.aliases) == {"latest", "best"}
    files = _files(v)
    assert "config.json" in files and any(f.startswith("model.") for f in files)
    assert v.metadata["metric_for_best_model"] == "loss"
    with cairn.Reader(repo) as reader:
        assert reader.run(cb.run.id).status == "completed"


# ---- Keras -------------------------------------------------------------------


@pytest.mark.timeout(300)
def test_keras_model_checkpoint(tmp_path):
    os.environ.setdefault("KERAS_BACKEND", "torch")
    keras = _importorskip("keras")
    np = _importorskip("numpy")
    from cairn.integrations.keras import CairnCallback, CairnModelCheckpoint

    repo = tmp_path / ".cairn"
    cb = CairnCallback(project="k", repo=repo, **_RUN_KW)
    ckpt = CairnModelCheckpoint(str(tmp_path / "model-{epoch}.keras"), monitor="loss", mode="min")
    keras.utils.set_random_seed(0)
    model = keras.Sequential([keras.Input((2,)), keras.layers.Dense(1)])
    model.compile(optimizer="sgd", loss="mse")
    x = np.random.rand(32, 2).astype("float32")
    y = (x @ np.array([[1.0], [-2.0]], dtype="float32"))
    model.fit(x, y, epochs=3, batch_size=8, verbose=0, callbacks=[ckpt, cb])

    versions = _versions(repo, "k", f"model-{cb.run.id}")
    assert [_files(v) for v in versions] == [["model-1.keras"], ["model-2.keras"], ["model-3.keras"]]
    assert "latest" in versions[-1].aliases
    assert sum("best" in v.aliases for v in versions) == 1
    best = next(v for v in versions if "best" in v.aliases)
    scores = [v.metadata["score"] for v in versions]
    assert best.metadata["score"] == min(scores)
    entry = best.get_entry(_files(best)[0])
    assert entry.read() == (tmp_path / _files(best)[0]).read_bytes()


# ---- Ultralytics -------------------------------------------------------------


@pytest.mark.network  # downloads coco8 (a few hundred kB) and a plot font
@pytest.mark.timeout(600)
def test_ultralytics_train(tmp_path, monkeypatch):
    import sys

    if "ultralytics.utils" in sys.modules:
        pytest.skip("ultralytics already imported: its settings dir can no longer be redirected")
    # Ultralytics' settings, fonts and datasets go to the scratch dir, not ~ or the cwd.
    (tmp_path / "yolo-config").mkdir()
    monkeypatch.setenv("YOLO_CONFIG_DIR", str(tmp_path / "yolo-config"))
    monkeypatch.chdir(tmp_path)
    _importorskip("ultralytics")
    import ultralytics.data.utils
    from ultralytics import YOLO

    from cairn.integrations.ultralytics import add_cairn_callbacks

    monkeypatch.setattr(ultralytics.data.utils, "DATASETS_DIR", tmp_path / "datasets")
    repo = tmp_path / ".cairn"
    model = YOLO("yolov8n.yaml")  # built from the yaml: no weights download
    cbs = add_cairn_callbacks(model, project="yolo", repo=repo, **_RUN_KW)
    try:
        model.train(data="coco8.yaml", epochs=1, imgsz=64, device="cpu", workers=0,
                    project=str(tmp_path / "runs"), name="train", exist_ok=True, verbose=False,
                    amp=False, pretrained=False)
    except Exception as exc:
        if "download" in str(exc).lower() or "dataset" in str(exc).lower():
            pytest.skip(f"coco8 unavailable: {exc}")
        raise

    run_id = cbs.run.id
    with cairn.Reader(repo) as reader:
        run = reader.run(run_id)
        assert run.status == "completed"
        assert run.config["imgsz"] == 64
        seqs = {s.name: s for s in run.sequences()}
    assert {"train/box_loss", "lr/pg0", "metrics/mAP50(B)", "val/box_loss"} <= set(seqs)
    assert seqs["val/predictions"].count == 1
    assert "plots/results" in seqs
    versions = _versions(repo, "yolo", f"model-{run_id}")
    assert [_files(v) for v in versions] == [["best.pt"], ["last.pt"]]
    assert [set(v.aliases) for v in versions] == [{"best"}, {"latest"}]
