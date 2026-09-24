"""Keras 3 integration.

Usage::

    from cairn.integrations.keras import CairnCallback

    model.fit(x, y, validation_split=0.1, callbacks=[CairnCallback(project="cls")])

Epoch metrics are tracked at ``step=epoch``; Keras' ``val_<name>`` keys become
``val.<name>``. ``log_every_n_batches=N`` additionally tracks the
running batch metrics as ``batch/<name>`` at the global batch index.
"""

from __future__ import annotations

from typing import Any

try:
    import keras
except ImportError as exc:  # pragma: no cover - covered when keras extra absent
    raise ImportError(
        "cairn Keras integration requires `pip install cairn-track[keras]`"
    ) from exc

from .. import Run


class CairnCallback(keras.callbacks.Callback):
    """Keras ``Callback`` that mirrors ``fit`` metrics into a Cairn run.

    Creates the run at ``on_train_begin`` from ``run_kwargs`` (or uses the
    given ``run``) and finishes it at ``on_train_end`` only if it created it.
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
        return self._run

    def on_train_begin(self, logs: dict[str, Any] | None = None) -> None:
        if self._run is None:
            kw = dict(self._run_kwargs)
            kw.setdefault("project", "keras")
            self._run = Run(**kw)
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
        if self._run is None or not logs:
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
        if self._run is not None and self._owns_run:
            self._run.finish("completed")
