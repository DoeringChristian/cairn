"""HuggingFace Trainer integration.

Usage:

```python
from cairn.integrations.huggingface import CairnCallback
from transformers import Trainer

trainer = Trainer(
    ...,
    callbacks=[CairnCallback(project="ft")],
)
```

Evaluation metrics (``eval_<metric>`` in the Trainer) are tracked once, as
``eval.<metric>`` at ``step=global_step``, from ``on_evaluate``. The Trainer
also passes them to ``on_log``, which therefore skips them; training metrics
keep their Trainer names.
"""

from __future__ import annotations

from typing import Any

try:
    from transformers.trainer_callback import (
        TrainerCallback,
        TrainerControl,
        TrainerState,
    )
    from transformers.training_args import TrainingArguments
except ImportError as exc:  # pragma: no cover - covered when hf extra absent
    raise ImportError(
        "cairn HuggingFace integration requires `pip install cairn-track[hf]`"
    ) from exc

from .. import Run


class CairnCallback(TrainerCallback):
    """HuggingFace ``TrainerCallback`` that mirrors training output into a Cairn run.

    Creates the run lazily at ``on_train_begin`` (or uses an explicitly
    provided one) and calls ``finish`` at ``on_train_end`` if it created it.

    Args:
        run: An existing run to write into; it is left open. Default: a new
            run created from ``run_kwargs`` and finished when training ends.
        **run_kwargs: Passed to ``cairn.Run`` for the new run (``project``
            defaults to the last component of ``TrainingArguments.output_dir``, else ``"hf"``).
    """

    def __init__(self, run: Run | None = None, **run_kwargs: Any):
        self._run: Run | None = run
        self._run_kwargs = run_kwargs
        self._owns_run = run is None

    @property
    def run(self) -> Run | None:
        """The run being written to; None before training starts."""
        return self._run

    def on_train_begin(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> None:
        if self._run is None:
            # Sensible defaults if the user didn't pass project.
            kw = dict(self._run_kwargs)
            kw.setdefault("project", args.output_dir.split("/")[-1] if args.output_dir else "hf")
            self._run = Run(**kw)
        # Log the TrainingArguments as params (flat dict).
        try:
            self._run.config(training_args=args.to_dict())
        except Exception:  # noqa: BLE001
            pass

    def on_log(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        logs: dict[str, float] | None = None,
        **kwargs: Any,
    ) -> None:
        if self._run is None or not logs:
            return
        step = int(logs.get("step", state.global_step))
        for k, v in logs.items():
            # Evaluation metrics are tracked by on_evaluate, as eval.<m>.
            if k == "step" or k.startswith("eval_"):
                continue
            try:
                self._run.track(float(v), name=k, step=step)
            except (TypeError, ValueError):
                continue

    def on_evaluate(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        metrics: dict[str, float] | None = None,
        **kwargs: Any,
    ) -> None:
        if self._run is None or not metrics:
            return
        step = int(state.global_step)
        for k, v in metrics.items():
            # The Trainer adds the epoch to the metrics it logs; on_log has it.
            if k == "epoch":
                continue
            try:
                name = k[len("eval_"):] if k.startswith("eval_") else k
                self._run.track(float(v), name=f"eval.{name}", step=step)
            except (TypeError, ValueError):
                continue

    def on_train_end(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> None:
        if self._run is not None and self._owns_run:
            self._run.finish("completed")
