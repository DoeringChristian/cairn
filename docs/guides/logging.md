# Logging metrics

A run records three kinds of information:

| What | API | Meaning |
|---|---|---|
| Series | `run.track(value, name, step)` | Values that change over training: losses, accuracies, images per epoch |
| Config | `run.config(...)` | Inputs decided before the run: hyperparameters, dataset choice |
| Summary | `run.summary(...)` | Results you claim at the end: best accuracy, test scores |

Tags and notes describe the run itself.

## Tracking values

```python
import cairn

with cairn.Run("mnist", name="baseline") as run:
    for step, (x, y) in enumerate(loader):
        loss = train_step(x, y)
        run.track(loss.item(), "train.loss", step)
        if step % 500 == 0:
            run.track(evaluate(), "val.acc", step)
```

The signature is `run.track(value, name, step, *, summary=None, x=None, **kwargs)`.

- **`value`**: a Python or NumPy scalar (`int`, `float`, `bool`, `np.float32`, …), a string, a
  media object, or a component that implements `__cairn_track__`. `None` is silently skipped, so
  optional values need no guard.
- **`name`**: the series name. See [Naming](#naming) below.
- **`step`**: the integer iteration this point belongs to. It is **required**. Each series keeps
  its own steps, so a validation metric logged every 500 steps is fine next to a training loss
  logged every step.
- **`summary=` and `x=`**: set how a scalar metric is summarized and plotted. See
  [Final values and metric rules](metric-rules.md).
- **`**kwargs`**: passed to the value's handler, for example `caption=` or an image `encoding=`.

!!! warning "Convert tensors to numbers"
    A zero-dimensional PyTorch tensor is not recognized as a scalar and raises a `TypeError`.
    Log `loss.item()`, not `loss`.

A name and step identify one point. If you log the same name at the same step twice, the first
point is kept and the second is ignored.

### Naming

Use `.` to build a hierarchy: `train.loss`, `val.acc`, `model.encoder.grad_norm`. The UI groups
scalar series into sections by the part before the first dot (`train`, `val`, …). Names without a
dot go to the *Charts* section, and media goes to *Media*.

Some prefixes are used by cairn itself:

- `system.*`: [system metrics](runs.md#system-metrics-logs-and-code) sampled in the background.
- `gradients/*` and `parameters/*`: histograms from [`run.watch`](runs.md#gradient-and-parameter-histograms).
- `_cairn/`: reserved for cairn's internal attachments, such as `_cairn/git.diff`. Don't use it
  for your own artifacts.

### Text and media

Strings are stored as text points. Images, audio, tables and other rich types are covered in
[Media and rich types](media.md). A few keyword arguments work on any media point:

```python
run.track(cairn.Image(img), "sample", step, caption=f"epoch {epoch}")   # caption this point
run.track([cairn.Image(a), cairn.Image(b)], "grid", step)    # a list of images is a gallery
```

### Tracking components

When `value` implements `__cairn_track__`, `run.track` hands it a scope, and the component logs
its own values under `name`:

```python
run.track(model, "model", step=it)   # records model.loss, model.encoder.weight_norm, ...
```

See [Components and scopes](scopes.md).

## Config

`run.config` records the run's inputs. It accepts a mapping, keyword arguments, or both. Nested
dictionaries are flattened to dotted keys:

```python
run.config(lr=1e-3, optimizer={"name": "adam", "betas": [0.9, 0.999]})
run.config(vars(args))                 # e.g. an argparse Namespace
# -> lr, optimizer.name, optimizer.betas, plus every argparse field
```

Calling it again adds keys and overwrites keys that already exist. Config values appear as
columns in the runs table and can be used in filters and
[expressions](../reference/expressions.md).

## Summary

`run.summary` has the same shape as `config` and the opposite meaning: it records the results
you are claiming.

```python
run.summary(best_val_acc=0.91, epochs_run=30)
run.summary({"test": {"psnr": 31.4}})    # -> test.psnr
```

cairn never writes to the summary implicitly. A metric's last value is not a summary entry.
However, a summary key with the same name as a metric **overrides** that metric's final value in
the runs table. That lets you report, for example, the accuracy of the checkpoint you actually
kept rather than the last one logged. See
[Final values and metric rules](metric-rules.md).

## Tags and notes

Set them when you create the run, or change them later:

```python
run = cairn.Run("mnist", tags=["baseline", "cnn"], notes="First attempt with augmentation.")

run.set_tag("promising")        # add one tag, keeping the others
run.remove_tag("baseline")      # remove one (unknown tags are ignored)
run.set_tags(["final"])         # replace all tags

run.add_note("Diverged after epoch 12; see lr schedule.")
```

!!! note
    Despite its name, `run.add_note(text)` **replaces** the run's notes. It does not append.

Tags and notes can also be edited in the UI, or from Python after the run has finished with
`Reader(...).run(id).edit()` (see [Reading data back](reading.md)).

## Run identity

Every run has a 128-bit hex ID generated on the client (`run.id`, 32 characters). The UI shows the
first six characters. `run.url` is the run's address on the server it logs to, or a `file://` URL
in local mode.

## Next steps

- [Media and rich types](media.md)
- [Final values and metric rules](metric-rules.md)
- [Run lifecycle](runs.md)
