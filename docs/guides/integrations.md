# Integrations

cairn ships callbacks for five training frameworks, plus an importer for
TensorBoard logs. Each integration lives in `cairn.integrations.<framework>` and
needs its framework installed. The matching extra installs it for you:

| Framework | Import | Extra |
|---|---|---|
| HuggingFace `Trainer` | `from cairn.integrations.huggingface import CairnCallback` | `cairn-track[huggingface]` |
| Keras 3 | `from cairn.integrations.keras import CairnCallback, CairnModelCheckpoint` | `cairn-track[keras]` |
| PyTorch Lightning | `from cairn.integrations.lightning import CairnLogger` | `cairn-track[lightning]` |
| Ultralytics YOLO | `from cairn.integrations.ultralytics import add_cairn_callbacks` | `cairn-track[ultralytics]` |
| XGBoost | `from cairn.integrations.xgboost import CairnCallback` | `cairn-track[xgboost]` |
| TensorBoard event files | `cairn import-tb LOGDIR` | `cairn-track[tb]` |

Importing an integration without its framework raises an `ImportError` that
names the extra.

## Which run gets the data

Every callback and logger takes the same arguments:

```python
CairnCallback(run=None, **run_kwargs)
```

- With no `run`, the integration creates one from `run_kwargs` (any
  [`cairn.Run`](runs.md) keyword: `project`, `name`, `tags`, `repo`, …) when
  training starts. It finishes that run when training ends.
- With `run=`, it logs into your run and leaves it open, so you can keep
  logging (test metrics, artifacts) after training.

Where the run is written is resolved as usual: `repo=` in `run_kwargs`, else
`cairn.configure`, `CAIRN_REPO`, and so on (see
[Configuration](../reference/configuration.md)).

Ultralytics is the exception: `add_cairn_callbacks(model, project=..., **run_kwargs)`
creates a new run for every `model.train()` and always finishes it.

## Progress

The integrations give their runs a total, so the UI shows [progress and an ETA](runs.md#progress-and-eta):

| Integration | Total | How |
|---|---|---|
| Lightning | `trainer.estimated_stepping_batches` | `run.total_steps`, when fitting starts (if finite). Lightning logs at `global_step`, which counts the same optimizer steps. |
| HuggingFace | `state.max_steps` | `run.total_steps`, at training start. The Trainer logs at `global_step`. |
| Keras | `epochs` | `run.progress(epoch + 1, total=epochs)` after each epoch: the integration's steps are epoch indices (batch indices only with `log_every_n_batches`), so progress counts epochs. |
| Ultralytics | `epochs` | `run.progress(epoch + 1, total=epochs)` after each epoch's training. |

XGBoost, sweeps (`Sweep.run`, `cairn agent`) and TensorBoard imports set none: a trial's script
sets its own run's total.

## Model checkpoints

The Lightning, HuggingFace, Keras and Ultralytics integrations can log the
models they save as [artifacts](artifacts.md): each saved checkpoint becomes a
new version of one artifact of type `model`, named after the run.

| Integration | Turned on by | Artifact | Aliases |
|---|---|---|---|
| Lightning | `CairnLogger(log_model=True)` or `"all"` | `model-<run id>` | `latest`, `best` |
| HuggingFace | `CairnCallback(log_model="checkpoint")` | `checkpoint-<run id>`, plus `model-<run id>` at the end | `latest`, `checkpoint-<step>` |
| HuggingFace | `CairnCallback(log_model="end")` or `"checkpoint"` | `model-<run id>` | `latest`, `best` |
| Keras | `CairnModelCheckpoint(...)` in place of `ModelCheckpoint` | `model-<run id>` | `latest`, `best` |
| Ultralytics | always | `model-<run id>` | `latest` (`last.pt`), `best` (`best.pt`) |

`latest` always names the newest version. `best` moves to the version that was
best when it was logged, as each section below defines. Get a checkpoint back
in another run with `use_artifact`:

```python
ckpt = run.use_artifact(f"model-{train_run_id}:best")
path = ckpt.file(ckpt.files()[0].path)    # the downloaded checkpoint file
```

## HuggingFace Trainer

```python
from transformers import Trainer
from cairn.integrations.huggingface import CairnCallback

trainer = Trainer(..., callbacks=[CairnCallback(project="ft")])
trainer.train()
```

| When | What is logged |
|---|---|
| Training starts | The run is created. The default `project` is the last component of `TrainingArguments.output_dir`, or `hf`. `TrainingArguments.to_dict()` is recorded as config under `training_args`. |
| Every Trainer log (`on_log`) | Each numeric value under its Trainer name (`loss`, `learning_rate`, `grad_norm`, `epoch`, …) at the logged `step`, else `global_step`. `eval_*` keys are skipped here. |
| Every evaluation (`on_evaluate`) | Each metric `eval_<m>` as `eval.<m>` at `global_step`. `epoch` is skipped. |
| Every checkpoint (`on_save`) | Only with `log_model="checkpoint"`: the checkpoint directory (`<output_dir>/checkpoint-<step>`, every file in it) as a version of `checkpoint-<run id>`, aliased `checkpoint-<step>`, at `step=<step>`. |
| Training ends | With `log_model="end"` or `"checkpoint"` (as in wandb): the final model, saved as `Trainer.save_model` saves it (weights, config, tokenizer or processor), as a version of `model-<run id>`, at `step=global_step`. With `load_best_model_at_end=True` that model is the best checkpoint's: the version is also aliased `best`, and its metadata holds `best_metric`, `metric_for_best_model` and `best_model_checkpoint`. Then the run is finished as `completed`, if the callback created it. |

The callback exposes the run as `callback.run`. Checkpoints and models are
logged by the main process only.

```python
args = TrainingArguments(output_dir="out", save_steps=500,
                         eval_strategy="steps", eval_steps=500,
                         load_best_model_at_end=True)
trainer = Trainer(model=model, args=args, ...,
                  callbacks=[CairnCallback(project="ft", log_model="end")])
```

The `huggingface` extra installs `transformers` only, not a backend: install
PyTorch (or another backend `transformers` supports) as well.

## Keras

The `keras` extra installs Keras 3 only, not a backend. Install one of
TensorFlow, JAX or PyTorch as well, and pick it with `KERAS_BACKEND`
(Keras defaults to `tensorflow`); without one, importing the integration raises
an `ImportError` that says so.

```python
from cairn.integrations.keras import CairnCallback

model.fit(x, y, validation_split=0.1, epochs=10,
          callbacks=[CairnCallback(project="cls")])
```

| When | What is logged |
|---|---|
| Training starts | The run is created (default `project`: `keras`). The scalar entries of the callback's `params` (such as `epochs`, `steps`, `verbose`) are recorded as config under `fit`. |
| Each epoch ends | Every metric at `step=epoch`. Keras' `val_<name>` keys become `val.<name>`, the rest keep their names (`loss`, `accuracy`, …). |
| Every N batches | Only with `CairnCallback(log_every_n_batches=N)`: Keras' running batch metrics as `batch/<name>`, at the count of batches seen so far across all epochs. |
| Training ends | The run is finished as `completed`, if the callback created it. |

### Checkpoints: `CairnModelCheckpoint`

`CairnModelCheckpoint` is Keras' `ModelCheckpoint` (same arguments, plus
`run=`) that logs every file Keras saves as a version of `model-<run id>`. The
alias `best` moves to a save at which `monitor` improved on its best value so
far; with `save_best_only=True` that is every save. The metadata holds
`epoch` (from 0, as Keras counts; the file name's `{epoch}` is one more), `batch` (None for epoch saves), `monitor`, `score` (the monitored
value) and `original_filename`.

```python
from cairn.integrations.keras import CairnCallback, CairnModelCheckpoint

model.fit(x, y, validation_split=0.1, epochs=10, callbacks=[
    CairnCallback(project="cls"),
    CairnModelCheckpoint("ckpt/model-{epoch}.keras", monitor="val_loss",
                         save_best_only=True),
])
```

It logs into the run of the `CairnCallback` in the same `fit`, else into
`run=`. With neither, the first epoch raises a `RuntimeError`.

## PyTorch Lightning

```python
import lightning as L
from cairn.integrations.lightning import CairnLogger

trainer = L.Trainer(logger=CairnLogger(project="mnist"))
trainer.fit(model, datamodule)
```

`CairnLogger` is a Lightning `Logger`:

| Lightning call | What cairn does |
|---|---|
| First use (`logger.experiment`) | Creates the run, on rank 0 only. The default `project` is `lightning`. |
| `log_hyperparams(...)` | Records the hyperparameters as config. Values that are not JSON (modules, dtypes, paths) are stored as strings. |
| `log_metrics(metrics, step)` | Tracks each metric under its Lightning name at the trainer's step. Without a step, it uses the previous step + 1. |
| `finalize(status)` | Finishes the run as `completed` (`failed` if Lightning reports `failed`), if the logger created it. |

`logger.name` is the project and `logger.version` is the run id. All logging
happens on rank 0.

### Checkpoints: `log_model`

With `log_model`, the logger logs the checkpoints of the trainer's
`ModelCheckpoint` callbacks as versions of `model-<run id>`, one `.ckpt` file
each, like wandb's `WandbLogger(log_model=...)`:

- `log_model=True`: when training succeeds, the checkpoints the callbacks still
  keep (the top-k and `last.ckpt`). Nothing is logged when training fails.
- `log_model="all"`: every checkpoint as soon as it is saved.

Versions are logged oldest file first, so `latest` is the newest checkpoint.
A file is logged once, unless it was overwritten since (`last.ckpt` is, every
time it is saved). When the callback has a `monitor`, its `best_model_path`
gets the alias `best`. The metadata holds `score` (the monitored value),
`monitor`, `epoch`, `global_step` and `original_filename`.

```python
from lightning.pytorch.callbacks import ModelCheckpoint

logger = CairnLogger(project="mnist", log_model=True)
trainer = L.Trainer(logger=logger,
                    callbacks=[ModelCheckpoint(monitor="val_loss", save_last=True)])
```

### Watching the model

`logger.watch(model, log="gradients", log_freq=100)` records histograms of the
gradients, the parameters or both (`log="all"`) every `log_freq` forward
passes. It is `run.watch(model, log=log, every=log_freq)` (see
[Runs](runs.md#gradient-and-parameter-histograms)).

```python
logger = CairnLogger(project="mnist")
logger.watch(model, log="all", log_freq=50)
trainer = L.Trainer(logger=logger)
trainer.fit(model, datamodule)
```

## Ultralytics YOLO

```python
from ultralytics import YOLO
from cairn.integrations.ultralytics import add_cairn_callbacks

model = YOLO("yolov8n.pt")
add_cairn_callbacks(model, project="detect")
model.train(data="coco8.yaml", epochs=50, imgsz=640)
```

`add_cairn_callbacks(model, project="ultralytics", **run_kwargs)` registers
callbacks on the model (`model.add_callback`), so every `model.train()` makes
one run. It returns the callbacks object; its `.run` is the run of the latest
training.

| When | What is logged |
|---|---|
| Training starts | The run is created (`name` defaults to the trainer's `name` argument, such as `train2`). The trainer arguments are recorded as config; values that are not JSON (paths) are stored as strings. |
| Each epoch's training ends | The training losses (`train/box_loss`, `train/cls_loss`, `train/dfl_loss`, …) and learning rates (`lr/pg0`, …) at `step=epoch`. |
| Each epoch's validation ends | The validation metrics under their Ultralytics names (`metrics/precision(B)`, `metrics/mAP50(B)`, `metrics/mAP50-95(B)`, `val/box_loss`, …) at `step=epoch`. The final validation of `best.pt` lands one step after the last epoch. |
| Training ends | The validation prediction images (`val_batch*_pred.jpg`) as one gallery point, `val/predictions`; the result plots that exist (`results.png`, `confusion_matrix*.png`, `*_curve.png`) as images under `plots/<file name>`; `best.pt` and then `last.pt` as versions of `model-<run id>`, aliased `best` and `latest`. Then the run is finished as `completed`. |

Epochs count from 0. Only rank 0 logs, as with Ultralytics' own loggers. The
integration supports the maintained `ultralytics` package (YOLOv8 and later).
The YOLOv5 repository hard-codes its loggers and has no callback API to hook
into, so it is not supported.

## XGBoost

```python
import xgboost as xgb
from cairn.integrations.xgboost import CairnCallback

xgb.train(params, dtrain,
          evals=[(dtrain, "train"), (dval, "val")],
          callbacks=[CairnCallback(project="gbm")])
```

| When | What is logged |
|---|---|
| Training starts | The run is created (default `project`: `xgboost`). |
| Each boosting round | The latest value of every eval metric as `<eval name>.<metric>` (e.g. `train.rmse`, `val.rmse`) at `step=<round>`. For `xgb.cv`, which logs (mean, std) pairs, the mean is tracked. |
| Training ends | The run is finished as `completed`, if the callback created it. |

The callback does not record `params` as config. Add them yourself with
`run.config(...)` if you pass your own `run`.

## Importing TensorBoard logs

`cairn import-tb` turns TensorBoard event files into cairn runs. It needs the
`[tb]` extra.

```bash
pip install 'cairn-track[tb]'
cairn import-tb runs/ --project my-experiments
```

- Every directory under `LOGDIR` that holds `*tfevents*` files becomes one run.
  The run is named after that directory relative to `LOGDIR` (or after
  `LOGDIR` itself, when the events sit directly in it).
- `--project` defaults to `LOGDIR`'s directory name. `--repo` picks the repo or
  server; without it, the usual [resolution](../reference/configuration.md)
  applies.
- Scalars, images and histograms are imported with their TensorBoard step and
  wall time. Both the legacy summaries (written by `torch.utils.tensorboard`
  and TF1) and TF2 tensor summaries are read. Other plugins (text, audio,
  graphs, embeddings) are skipped.
- A run's creation and end times are its first and last event times, so
  imported runs sort by when they happened. Imported runs are `completed`.
- A directory whose events hold nothing importable produces no run.

The command prints the new run ids, one per line, and a count on stderr. From
Python, call `cairn.sdk.import_tb.import_tensorboard(logdir, project=..., repo=...)`,
which returns the list of run ids.

## Other trackers

cairn has no importer for other experiment trackers. To move data between cairn
repos, use run archives (see [Import and export](import-export.md)).
