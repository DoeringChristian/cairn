"""HuggingFace Trainer integration.

Usage::

    from cairn.integrations.huggingface import CairnCallback
    from transformers import Trainer

    trainer = Trainer(
        ...,
        callbacks=[CairnCallback(project="ft")],
    )
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
    provided one) and calls ``finish`` at ``on_train_end``.
    """

    def __init__(self, run: Run | None = None, **run_kwargs: Any):
        self._run: Run | None = run
        self._run_kwargs = run_kwargs
        self._owns_run = run is None

    @property
    def run(self) -> Run | None:
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
            self._run["training_args"] = args.to_dict()
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
            if k == "step":
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
            try:
                self._run.track(float(v), name=k, step=step, context={"subset": "eval"})
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
