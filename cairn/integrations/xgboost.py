"""XGBoost integration.

Usage:

```python
from cairn.integrations.xgboost import CairnCallback

xgb.train(params, dtrain, evals=[(dtrain, "train"), (dval, "val")],
          callbacks=[CairnCallback(project="gbm")])
```

Each boosting round tracks the latest value of every eval metric as
``<eval name>.<metric>`` at ``step=<round>`` (``train.rmse``, ``val.rmse``).
"""

from __future__ import annotations

from typing import Any

try:
    from xgboost.callback import TrainingCallback
except ImportError as exc:  # pragma: no cover - covered when xgboost extra absent
    raise ImportError(
        "cairn XGBoost integration requires `pip install cairn-track[xgboost]`"
    ) from exc

from .. import Run


class CairnCallback(TrainingCallback):
    """XGBoost ``TrainingCallback`` that mirrors ``evals_log`` into a Cairn run.

    Creates the run at ``before_training`` from ``run_kwargs`` (or uses the
    given ``run``) and finishes it at ``after_training`` only if it created it.

    Args:
        run: An existing run to write into; it is left open. Default: a new
            run created from ``run_kwargs`` and finished when training ends.
        **run_kwargs: Passed to ``cairn.Run`` for the new run (``project``
            defaults to ``"xgboost"``).
    """

    def __init__(self, run: Run | None = None, **run_kwargs: Any):
        super().__init__()
        self._run: Run | None = run
        self._run_kwargs = run_kwargs
        self._owns_run = run is None

    @property
    def run(self) -> Run | None:
        """The run being written to; None before training starts."""
        return self._run

    def before_training(self, model: Any) -> Any:
        if self._run is None:
            kw = dict(self._run_kwargs)
            kw.setdefault("project", "xgboost")
            self._run = Run(**kw)
        return model

    def after_iteration(self, model: Any, epoch: int, evals_log: dict[str, dict[str, list[Any]]]) -> bool:
        if self._run is None:
            return False
        for subset, metrics in evals_log.items():
            for metric, values in metrics.items():
                if not values:
                    continue
                last = values[-1]
                # xgb.cv logs (mean, std) pairs.
                value = last[0] if isinstance(last, tuple) else last
                self._run.track(float(value), name=f"{subset}.{metric}", step=epoch)
        return False

    def after_training(self, model: Any) -> Any:
        if self._run is not None and self._owns_run:
            self._run.finish("completed")
        return model
