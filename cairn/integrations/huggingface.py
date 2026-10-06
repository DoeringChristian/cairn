"""HuggingFace Trainer integration.

Usage:

```python
from cairn.integrations.huggingface import CairnCallback
from transformers import Trainer

trainer = Trainer(
    ...,
    callbacks=[CairnCallback(project="ft", log_model="checkpoint")],
)
```

Evaluation metrics (``eval_<metric>`` in the Trainer) are tracked once, as
``eval.<metric>`` at ``step=global_step``, from ``on_evaluate``. The Trainer
also passes them to ``on_log``, which therefore skips them; training metrics
keep their Trainer names.

``log_model="end"`` logs the final model as ``model-<run id>`` when training
ends; ``log_model="checkpoint"`` does that too and also logs every checkpoint
directory the Trainer saves as a version of ``checkpoint-<run id>`` (all of
type ``model``), as wandb's ``WANDB_LOG_MODEL`` does.
"""

from __future__ import annotations

import copy
import inspect
import os
import tempfile
from typing import Any, Literal

try:
    from transformers.trainer_callback import (
        TrainerCallback,
        TrainerControl,
        TrainerState,
    )
    from transformers.trainer_utils import PREFIX_CHECKPOINT_DIR
    from transformers.training_args import TrainingArguments
except ImportError as exc:  # pragma: no cover - covered when the extra is absent
    raise ImportError(
        "cairn HuggingFace integration requires `pip install cairn-track[huggingface]`"
    ) from exc

from .. import Artifact, Run


class CairnCallback(TrainerCallback):
    """HuggingFace ``TrainerCallback`` that mirrors training output into a Cairn run.

    Creates the run lazily at ``on_train_begin`` (or uses an explicitly
    provided one) and calls ``finish`` at ``on_train_end`` if it created it.

    Args:
        run: An existing run to write into; it is left open. Default: a new
            run created from ``run_kwargs`` and finished when training ends.
        log_model: ``"end"``: log the final model (saved as
            ``Trainer.save_model`` does) as ``model-<run id>``, aliased ``best``
            too when ``load_best_model_at_end`` is set. ``"checkpoint"``: the
            same, and each checkpoint directory the Trainer saves as a version
            of ``checkpoint-<run id>``, aliased ``checkpoint-<step>``.
            ``False``: neither.
        **run_kwargs: Passed to ``cairn.Run`` for the new run (``project``
            defaults to the last component of ``TrainingArguments.output_dir``, else ``"hf"``).
    """

    def __init__(
        self,
        run: Run | None = None,
        *,
        log_model: Literal["end", "checkpoint", False] = False,
        **run_kwargs: Any,
    ):
        if log_model not in ("end", "checkpoint", False):
            raise ValueError(f"log_model must be 'end', 'checkpoint' or False, not {log_model!r}")
        self._run: Run | None = run
        self._run_kwargs = run_kwargs
        self._owns_run = run is None
        self._log_model = log_model

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

    def on_save(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> None:
        if self._log_model != "checkpoint" or self._run is None or not state.is_world_process_zero:
            return
        ckpt = f"{PREFIX_CHECKPOINT_DIR}-{state.global_step}"
        art = Artifact(f"checkpoint-{self._run.id}", type="model")
        art.add_dir(os.path.join(args.output_dir, ckpt))
        self._run.log_artifact(art, aliases=[ckpt], step=state.global_step)

    def on_train_end(
        self,
        args: TrainingArguments,
        state: TrainerState,
        control: TrainerControl,
        **kwargs: Any,
    ) -> None:
        if self._run is None:
            return
        if self._log_model in ("end", "checkpoint") and state.is_world_process_zero:
            self._log_final_model(args, state, kwargs.get("model"),
                                  kwargs.get("processing_class", kwargs.get("tokenizer")))
        if self._owns_run:
            self._run.finish("completed")

    def _log_final_model(
        self, args: TrainingArguments, state: TrainerState, model: Any, processing_class: Any,
    ) -> None:
        """Log the final model as ``model-<run id>``."""
        metadata: dict[str, Any] = {"global_step": state.global_step}
        if args.load_best_model_at_end:
            metadata.update(best_metric=state.best_metric,
                            metric_for_best_model=args.metric_for_best_model,
                            best_model_checkpoint=state.best_model_checkpoint)
        with tempfile.TemporaryDirectory() as tmp:
            _save_model(args, model, processing_class, tmp)
            art = Artifact(f"model-{self._run.id}", type="model", metadata=metadata)
            art.add_dir(tmp)
            # Files are read when the draft is logged: inside the block.
            self._run.log_artifact(art, aliases=["best"] if args.load_best_model_at_end else None,
                                   step=state.global_step)


def _save_model(args: TrainingArguments, model: Any, processing_class: Any, out_dir: str) -> None:
    """Save ``model`` (and its tokenizer/processor) as ``Trainer.save_model``
    does, through a throwaway Trainer, as the wandb callback does: the callback
    never sees the real one."""
    from transformers import Trainer

    fake_args = copy.deepcopy(args)
    fake_args.deepspeed = None
    if hasattr(fake_args, "deepspeed_plugin"):
        fake_args.deepspeed_plugin = None
    processing_kw = (
        "processing_class" if "processing_class" in inspect.signature(Trainer.__init__).parameters
        else "tokenizer"
    )
    trainer = Trainer(args=fake_args, model=model, eval_dataset=["fake"], **{processing_kw: processing_class})
    trainer.save_model(out_dir)
