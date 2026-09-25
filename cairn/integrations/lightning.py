"""PyTorch Lightning integration.

Usage:

```python
from cairn.integrations.lightning import CairnLogger
import lightning as L

trainer = L.Trainer(logger=CairnLogger(project="mnist"))
```
"""

from __future__ import annotations

from argparse import Namespace
from typing import Any

try:
    from lightning.fabric.utilities.logger import _convert_params, _sanitize_callable_params
    from lightning.pytorch.loggers.logger import Logger, rank_zero_experiment
    from lightning.pytorch.utilities import rank_zero_only
except ImportError as exc:  # pragma: no cover - covered when lightning extra absent
    raise ImportError(
        "cairn Lightning integration requires `pip install cairn-track[lightning]`"
    ) from exc

from .. import Run

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
        **run_kwargs: Passed to ``cairn.Run`` for the new run (``project``
            defaults to ``"lightning"``).
    """

    def __init__(self, run: Run | None = None, **run_kwargs: Any):
        super().__init__()
        self._run: Run | None = run
        self._run_kwargs = run_kwargs
        self._run_kwargs.setdefault("project", "lightning")
        self._owns_run = run is None
        self._last_step = -1

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
    def finalize(self, status: str) -> None:
        """Finish the run with the matching status, if this logger created it."""
        if self._run is not None and self._owns_run:
            self._run.finish(_STATUS.get(status, "completed"))


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
