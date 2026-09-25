# Integrations

cairn ships callbacks for four training frameworks, plus an importer for
TensorBoard logs. Each integration lives in `cairn.integrations.<framework>` and
needs its framework installed. The matching extra installs it for you:

| Framework | Import | Extra |
|---|---|---|
| HuggingFace `Trainer` | `from cairn.integrations.huggingface import CairnCallback` | `cairn-track[hf]` |
| Keras 3 | `from cairn.integrations.keras import CairnCallback` | `cairn-track[keras]` |
| PyTorch Lightning | `from cairn.integrations.lightning import CairnLogger` | `cairn-track[lightning]` |
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
| Training ends | The run is finished as `completed`, if the callback created it. |

The callback exposes the run as `callback.run`.

## Keras

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
