"""Keras 3 integration.

Usage:

```python
from cairn.integrations.keras import CairnCallback

model.fit(x, y, validation_split=0.1, callbacks=[CairnCallback(project="cls")])
```

Epoch metrics are tracked at ``step=epoch``; Keras' ``val_<name>`` keys become
``val.<name>``. ``log_every_n_batches=N`` additionally tracks the
running batch metrics as ``batch/<name>`` at the global batch index.

``CairnModelCheckpoint`` is Keras' ``ModelCheckpoint`` that also logs each file
it saves as a version of the artifact ``model-<run id>``:

```python
model.fit(x, y, validation_split=0.1, callbacks=[
    CairnCallback(project="cls"),
    CairnModelCheckpoint("ckpt/model.keras", monitor="val_loss", save_best_only=True),
])
```
"""

from __future__ import annotations

import importlib.util
import os
from typing import Any

if importlib.util.find_spec("keras") is None:
    raise ImportError(
        "cairn Keras integration requires Keras 3: install the `keras` extra "
        "of cairn-track, plus a backend (tensorflow, jax or torch)"
    )
try:
    import keras
except ImportError as exc:
    # Keras itself is installed; what failed is its backend. The `keras` extra
    # brings Keras only: the backend is the user's choice (and a heavy one).
    raise ImportError(
        f"Keras is installed but could not load its backend ({exc}). Keras 3 "
        "needs one of tensorflow, jax or torch: install it, and select it with "
        "KERAS_BACKEND=tensorflow|jax|torch (default: tensorflow)."
    ) from exc

from .. import Artifact, Run

# id(model) -> the run of the CairnCallback in that model's ongoing fit, for
# CairnModelCheckpoint in the same fit.
_FIT_RUNS: dict[int, Run] = {}


class CairnCallback(keras.callbacks.Callback):
    """Keras ``Callback`` that mirrors ``fit`` metrics into a Cairn run.

    Creates the run at ``on_train_begin`` from ``run_kwargs`` (or uses the
    given ``run``) and finishes it at ``on_train_end`` only if it created it.

    Args:
        run: An existing run to write into; it is left open. Default: a new
            run created from ``run_kwargs`` and finished when training ends.
        log_every_n_batches: Also track the running batch metrics as
            ``batch/<name>`` every N batches, at the global batch index.
        **run_kwargs: Passed to ``cairn.Run`` for the new run (``project``
            defaults to ``"keras"``).
    """

    def __init__(
        self,
        run: Run | None = None,
        *,
        log_every_n_batches: int | None = None,
        **run_kwargs: Any,
    ):
        super().__init__()
        self._run: Run | None = run
        self._run_kwargs = run_kwargs
        self._owns_run = run is None
        self._every = log_every_n_batches
        self._batch = 0

    @property
    def run(self) -> Run | None:
        """The run being written to; None before training starts."""
        return self._run

    def on_train_begin(self, logs: dict[str, Any] | None = None) -> None:
        if self._run is None:
            kw = dict(self._run_kwargs)
            kw.setdefault("project", "keras")
            self._run = Run(**kw)
        _FIT_RUNS[id(self.model)] = self._run
        params = getattr(self, "params", None)
        if params:
            self._run.config(fit={k: v for k, v in params.items() if isinstance(v, (int, float, str, bool))})

    def on_train_batch_end(self, batch: int, logs: dict[str, Any] | None = None) -> None:
        self._batch += 1
        if self._run is None or not self._every or not logs or self._batch % self._every:
            return
        for k, v in logs.items():
            try:
                self._run.track(float(v), name=f"batch/{k}", step=self._batch)
            except (TypeError, ValueError):
                continue

    def on_epoch_end(self, epoch: int, logs: dict[str, Any] | None = None) -> None:
        if self._run is None:
            return
        epochs = (getattr(self, "params", None) or {}).get("epochs")
        if epochs:
            # Steps are epoch indices here (batch indices only with
            # log_every_n_batches), so progress is counted in epochs.
            self._run.progress(epoch + 1, total=epochs)
        if not logs:
            return
        for k, v in logs.items():
            try:
                value = float(v)
            except (TypeError, ValueError):
                continue
            if k.startswith("val_"):
                self._run.track(value, name=f"val.{k[4:]}", step=epoch)
            else:
                self._run.track(value, name=k, step=epoch)

    def on_train_end(self, logs: dict[str, Any] | None = None) -> None:
        _FIT_RUNS.pop(id(self.model), None)
        if self._run is not None and self._owns_run:
            self._run.finish("completed")


class CairnModelCheckpoint(keras.callbacks.ModelCheckpoint):
    """Keras ``ModelCheckpoint`` that logs every file it saves to Cairn.

    Each save becomes a version of the artifact ``model-<run id>`` (type
    ``model``) holding the saved file. ``latest`` names the newest version;
    the alias ``best`` moves to a save at which ``monitor`` improved on its
    best value so far (with ``save_best_only``, every save). The run is the one of a ``CairnCallback`` in the same
    ``fit``, else ``run``.

    Args:
        filepath: As for ``keras.callbacks.ModelCheckpoint``, like every
            other argument but ``run`` (``monitor``, ``save_best_only``,
            ``mode``, ``save_freq``, ...).
        run: The run to log into when the fit has no ``CairnCallback``.

    Raises:
        RuntimeError: At the first epoch, when there is no run to log into.
    """

    def __init__(self, filepath: str, *args: Any, run: Run | None = None, **kwargs: Any):
        super().__init__(filepath, *args, **kwargs)
        self._explicit_run = run
        self._monitor_best: Any = None

    def _cairn_run(self) -> Run:
        run = _FIT_RUNS.get(id(self.model), self._explicit_run)
        if run is None:
            raise RuntimeError(
                "CairnModelCheckpoint has no run to log into: add a cairn "
                "CairnCallback to the same fit(), or pass run=..."
            )
        return run

    def on_epoch_begin(self, epoch: int, logs: dict[str, Any] | None = None) -> None:
        # Every callback's on_train_begin has run (and created its run) by now.
        self._cairn_run()
        super().on_epoch_begin(epoch, logs)

    def _save_model(self, epoch: int, batch: int | None, logs: dict[str, Any] | None) -> None:
        filepath = self._get_file_path(epoch, batch, logs)
        before = _mtime(filepath)
        super()._save_model(epoch, batch, logs)
        improved = self._improved(logs)
        if _mtime(filepath) in (None, before):
            return  # Keras did not save (save_best_only without improvement)
        art = Artifact(f"model-{self._cairn_run().id}", type="model",
                       metadata={"epoch": epoch, "batch": batch, "monitor": self.monitor,
                                 "score": _float((logs or {}).get(self.monitor)),
                                 "original_filename": os.path.basename(filepath)})
        art.add_file(filepath)
        self._cairn_run().log_artifact(art, aliases=["best"] if improved else None)

    def _improved(self, logs: dict[str, Any] | None) -> bool:
        """Whether ``monitor`` improved on its best value so far."""
        current = _float((logs or {}).get(self.monitor))
        if current is None or self.monitor_op is None:
            return False
        if self._monitor_best is not None and not bool(self.monitor_op(current, self._monitor_best)):
            return False
        self._monitor_best = current
        return True


def _mtime(path: str) -> int | None:
    try:
        return os.stat(path).st_mtime_ns
    except OSError:
        return None


def _float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
