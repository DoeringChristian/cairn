"""PyTorch Lightning integration.

Usage:

```python
from cairn.integrations.lightning import CairnLogger
import lightning as L

trainer = L.Trainer(logger=CairnLogger(project="mnist", log_model=True))
```

``log_model`` logs the checkpoints the trainer's ``ModelCheckpoint`` callbacks
save as versions of the artifact ``model-<run id>`` (type ``model``): ``True``
logs them once training succeeds, ``"all"`` each one as it is saved. The newest
version is ``latest``; the best by the callback's monitored score is ``best``.
"""

from __future__ import annotations

import math
from argparse import Namespace
from pathlib import Path
from typing import Any, Literal

try:
    from lightning.fabric.utilities.logger import (
        _convert_params,
        _sanitize_callable_params,
    )
    from lightning.pytorch.callbacks import ModelCheckpoint
    from lightning.pytorch.loggers.logger import Logger, rank_zero_experiment
    from lightning.pytorch.loggers.utilities import _scan_checkpoints
    from lightning.pytorch.utilities import rank_zero_only
except ImportError as exc:  # pragma: no cover - covered when lightning extra absent
    raise ImportError(
        "cairn Lightning integration requires `pip install cairn-track[lightning]`"
    ) from exc

from .. import Artifact, Run

# Lightning's finalize() statuses → cairn run statuses.
_STATUS = {"success": "completed", "failed": "failed"}


class CairnLogger(Logger):
    """Lightning ``Logger`` that writes into a Cairn run.

    Hyperparameters go to the run's ``config``, metrics to ``track`` at the
    trainer's step. The run is created lazily on first use (rank 0 only) from
    ``run_kwargs``, or an existing ``run`` is used — and then left open.

    Args:
        run: An existing run to write into; it is left open. Default: a new
            run created from ``run_kwargs`` and finished when training ends.
        log_model: Log the ``ModelCheckpoint`` checkpoints as versions of the
            artifact ``model-<run id>``: ``True`` once training succeeds (the
            best and last checkpoints the callbacks kept), ``"all"`` every
            checkpoint as it is saved, ``False`` none.
        **run_kwargs: Passed to ``cairn.Run`` for the new run (``project``
            defaults to ``"lightning"``).
    """

    def __init__(
        self,
        run: Run | None = None,
        *,
        log_model: bool | Literal["all"] = False,
        **run_kwargs: Any,
    ):
        super().__init__()
        if log_model not in (True, False, "all"):
            raise ValueError(f"log_model must be True, False or 'all', not {log_model!r}")
        self._run: Run | None = run
        self._run_kwargs = run_kwargs
        self._run_kwargs.setdefault("project", "lightning")
        self._owns_run = run is None
        self._last_step = -1
        self._log_model = log_model
        self._checkpoint_callbacks: dict[int, ModelCheckpoint] = {}
        # checkpoint path -> mtime when it was logged: a file is logged again
        # only once it was overwritten (last.ckpt).
        self._logged_ckpt_time: dict[str, float] = {}

    @property
    def name(self) -> str:
        """The Cairn project name."""
        return str(self._run_kwargs["project"])

    @property
    def version(self) -> str:
        """The run id (creates the run on first access)."""
        return self.experiment.id

    @property
    @rank_zero_experiment
    def experiment(self) -> Run:
        """The ``cairn.Run``, created on first access (rank 0 only)."""
        if self._run is None:
            self._run = Run(**self._run_kwargs)
        return self._run

    @rank_zero_only
    def log_hyperparams(self, params: dict[str, Any] | Namespace, *args: Any, **kwargs: Any) -> None:
        """Record hyperparameters as the run's config (non-JSON values as strings)."""
        params = _sanitize_callable_params(_convert_params(params))
        clean = {k: _jsonable(v) for k, v in params.items()}
        if clean:
            self.experiment.config(clean)

    @rank_zero_only
    def log_metrics(self, metrics: dict[str, float], step: int | None = None) -> None:
        """Track each numeric metric at ``step`` (the next step when None)."""
        if step is None:
            step = self._last_step + 1
        self._last_step = max(self._last_step, step)
        for k, v in metrics.items():
            try:
                value = float(v)
            except (TypeError, ValueError):
                continue
            self.experiment.track(value, name=k, step=step)

    @rank_zero_only
    def log_graph(self, model: Any, input_array: Any = None) -> None:
        """Called by the trainer when fitting starts: the run's ``total_steps``
        becomes ``trainer.estimated_stepping_batches`` (the optimizer steps,
        which ``global_step`` counts), when that is finite."""
        trainer = getattr(model, "_trainer", None)
        if trainer is None or getattr(getattr(trainer, "state", None), "fn", None) != "fit":
            return
        try:
            total = trainer.estimated_stepping_batches
        except Exception:  # noqa: BLE001 - no progress rather than a failed fit
            return
        if isinstance(total, (int, float)) and math.isfinite(total) and total > 0:
            self.experiment.total_steps = int(total)

    @rank_zero_only
    def watch(self, model: Any, log: str = "gradients", log_freq: int = 100) -> None:
        """Record histograms of ``model``'s gradients, parameters or both
        (``log="gradients"|"parameters"|"all"``) every ``log_freq`` forward
        passes: ``run.watch(model, log=log, every=log_freq)``."""
        self.experiment.watch(model, log=log, every=log_freq)

    @rank_zero_only
    def after_save_checkpoint(self, checkpoint_callback: ModelCheckpoint) -> None:
        """``log_model="all"``: log the checkpoints saved since the last call.
        ``log_model=True``: remember the callback, for ``finalize``."""
        if self._log_model == "all":
            self._log_checkpoints(checkpoint_callback)
        elif self._log_model is True:
            self._checkpoint_callbacks[id(checkpoint_callback)] = checkpoint_callback

    @rank_zero_only
    def finalize(self, status: str) -> None:
        """Log the kept checkpoints (``log_model=True``, on success only), then
        finish the run with the matching status, if this logger created it."""
        if status == "success" and self._run is not None:
            for callback in self._checkpoint_callbacks.values():
                self._log_checkpoints(callback)
        if self._run is not None and self._owns_run:
            self._run.finish(_STATUS.get(status, "completed"))

    def _log_checkpoints(self, callback: ModelCheckpoint) -> None:
        """Log every checkpoint of ``callback`` not logged yet (or overwritten
        since), oldest first, so ``latest`` lands on the newest."""
        run = self.experiment
        best_path = callback.best_model_path if callback.monitor is not None else None
        for mtime, path, score, _tag in _scan_checkpoints(callback, self._logged_ckpt_time):
            metadata: dict[str, Any] = {
                "score": _scalar(score),
                "monitor": callback.monitor,
                "original_filename": Path(path).name,
            }
            metadata.update(_progress(path))
            art = Artifact(f"model-{run.id}", type="model", metadata=metadata)
            art.add_file(path)
            run.log_artifact(art, aliases=["best"] if path == best_path else None)
            self._logged_ckpt_time[path] = mtime


def _scalar(v: Any) -> Any:
    """A score as a float (Lightning keeps tensors), None when there is none."""
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _progress(path: str) -> dict[str, int]:
    """``epoch`` and ``global_step`` as stored in a Lightning checkpoint
    (memory-mapped: the weights are not read); empty when unreadable."""
    import torch

    try:
        ckpt = torch.load(path, map_location="cpu", mmap=True, weights_only=False)
    except Exception:  # noqa: BLE001 - metadata only; the file is still logged
        return {}
    return {k: int(ckpt[k]) for k in ("epoch", "global_step") if isinstance(ckpt.get(k), int)}


def _jsonable(v: Any) -> Any:
    """Hyperparameters can hold arbitrary objects (modules, dtypes, paths);
    keep JSON scalars and containers, stringify the rest."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return str(v)
