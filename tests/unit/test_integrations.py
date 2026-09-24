"""Lightning / Keras / XGBoost integrations: fake-object unit tests plus one
real tiny training per framework, read back through the Reader."""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest

import cairn

_RUN_KW = dict(
    capture_source=False,
    capture_stdout=False,
    capture_env=False,
    capture_system_metrics=False,
)


@pytest.fixture(autouse=True)
def _reset_capture_state():
    from cairn.sdk.capture import stdout as scap

    scap._active_run_id = None
    yield
    scap._active_run_id = None


def _importorskip(name: str):
    # xgboost raises XGBoostError (not ImportError) when libomp is missing.
    try:
        return __import__(name)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"{name} unavailable: {exc}")


def _seq(repo, run_id, name):
    with cairn.Reader(repo) as reader:
        run = reader.run(run_id)
        return run.status, run.sequence(name).values


# ---- Lightning ---------------------------------------------------------------


def test_lightning_logger_fake_run():
    _importorskip("lightning")
    from cairn.integrations.lightning import CairnLogger

    run = MagicMock()
    logger = CairnLogger(run=run)
    logger.log_hyperparams({"lr": 0.1, "act": object, "nested": {"a": 1}})
    (cfg,), _ = run.config.call_args
    assert cfg["lr"] == 0.1 and cfg["nested"] == {"a": 1} and isinstance(cfg["act"], str)

    logger.log_metrics({"loss": 0.5, "epoch": 0}, step=3)
    logger.log_metrics({"loss": 0.4})  # no step: continues after the last one
    steps = [c.kwargs["step"] for c in run.track.call_args_list]
    assert steps == [3, 3, 4]

    logger.finalize("success")
    run.finish.assert_not_called()  # not owned


def test_lightning_finalize_maps_status():
    _importorskip("lightning")
    from cairn.integrations.lightning import CairnLogger

    logger = CairnLogger(project="p")
    logger._run = MagicMock()
    logger.finalize("failed")
    logger._run.finish.assert_called_once_with("failed")


def test_lightning_trainer_end_to_end(tmp_path):
    torch = _importorskip("torch")
    L = _importorskip("lightning")
    from cairn.integrations.lightning import CairnLogger

    class Tiny(L.LightningModule):
        def __init__(self, lr=0.1):
            super().__init__()
            self.save_hyperparameters()
            self.layer = torch.nn.Linear(2, 1)

        def training_step(self, batch, _):
            x, y = batch
            loss = torch.nn.functional.mse_loss(self.layer(x), y)
            self.log("train_loss", loss)
            return loss

        def configure_optimizers(self):
            return torch.optim.SGD(self.parameters(), lr=self.hparams.lr)

    ds = torch.utils.data.TensorDataset(torch.randn(16, 2), torch.randn(16, 1))
    repo = tmp_path / ".cairn"
    logger = CairnLogger(project="lit", repo=repo, **_RUN_KW)
    trainer = L.Trainer(
        max_epochs=2, logger=logger, log_every_n_steps=1, enable_checkpointing=False,
        enable_progress_bar=False, enable_model_summary=False, default_root_dir=tmp_path,
    )
    trainer.fit(Tiny(), torch.utils.data.DataLoader(ds, batch_size=4))
    run_id = logger.experiment.id

    status, values = _seq(repo, run_id, "train_loss")
    assert status == "completed"
    assert len(values) == 8
    with cairn.Reader(repo) as reader:
        assert reader.run(run_id).config["lr"] == 0.1


# ---- Keras -------------------------------------------------------------------


def _keras():
    os.environ.setdefault("KERAS_BACKEND", "torch")
    return _importorskip("keras")


def test_keras_callback_val_prefix():
    _keras()
    from cairn.integrations.keras import CairnCallback

    run = MagicMock()
    cb = CairnCallback(run=run)
    cb.on_epoch_end(2, {"loss": 0.5, "val_loss": 0.6, "accuracy": 0.9})
    calls = {c.kwargs["name"]: c.kwargs["step"] for c in run.track.call_args_list}
    assert calls == {"loss": 2, "val.loss": 2, "accuracy": 2}
    cb.on_train_end()
    run.finish.assert_not_called()


def test_keras_fit_end_to_end(tmp_path):
    keras = _keras()
    np = _importorskip("numpy")
    from cairn.integrations.keras import CairnCallback

    repo = tmp_path / ".cairn"
    cb = CairnCallback(project="k", repo=repo, log_every_n_batches=2, **_RUN_KW)
    model = keras.Sequential([keras.Input((2,)), keras.layers.Dense(1)])
    model.compile(optimizer="sgd", loss="mse")
    x = np.random.rand(32, 2).astype("float32")
    y = np.random.rand(32, 1).astype("float32")
    model.fit(x, y, epochs=3, batch_size=8, validation_split=0.25, verbose=0, callbacks=[cb])

    status, train = _seq(repo, cb.run.id, "loss")
    _, val = _seq(repo, cb.run.id, "val.loss")
    assert status == "completed"
    assert len(train) == 3 and len(val) == 3
    # 3 batches/epoch x 3 epochs = 9 batches → every 2nd: 4 points.
    assert len(_seq(repo, cb.run.id, "batch/loss")[1]) == 4


# ---- XGBoost -----------------------------------------------------------------


def test_xgboost_after_iteration_fake_run():
    _importorskip("xgboost")
    from cairn.integrations.xgboost import CairnCallback

    run = MagicMock()
    cb = CairnCallback(run=run)
    stop = cb.after_iteration(None, 4, {"train": {"rmse": [0.9, 0.5]}, "val": {"rmse": [(0.7, 0.1)]}})
    assert stop is False
    got = {(c.kwargs["name"], c.args[0]) for c in run.track.call_args_list}
    assert got == {("train.rmse", 0.5), ("val.rmse", 0.7)}
    assert all(c.kwargs["step"] == 4 for c in run.track.call_args_list)


def test_xgboost_train_end_to_end(tmp_path):
    xgb = _importorskip("xgboost")
    np = _importorskip("numpy")
    from cairn.integrations.xgboost import CairnCallback

    repo = tmp_path / ".cairn"
    x = np.random.rand(40, 3)
    y = np.random.rand(40)
    dtrain = xgb.DMatrix(x[:30], label=y[:30])
    dval = xgb.DMatrix(x[30:], label=y[30:])
    cb = CairnCallback(project="gbm", repo=repo, **_RUN_KW)
    xgb.train({"objective": "reg:squarederror"}, dtrain, num_boost_round=5,
              evals=[(dtrain, "train"), (dval, "val")], callbacks=[cb], verbose_eval=False)

    status, train = _seq(repo, cb.run.id, "train.rmse")
    _, val = _seq(repo, cb.run.id, "val.rmse")
    assert status == "completed"
    assert len(train) == 5 and len(val) == 5
