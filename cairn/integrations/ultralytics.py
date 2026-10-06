"""Ultralytics (YOLOv8 and later) integration.

Usage:

```python
from ultralytics import YOLO
from cairn.integrations.ultralytics import add_cairn_callbacks

model = YOLO("yolov8n.pt")
add_cairn_callbacks(model, project="detect")
model.train(data="coco8.yaml", epochs=10)
```

Each ``train()`` is one run: the trainer arguments as config, the epoch losses,
learning rates and validation metrics under their Ultralytics names at
``step=epoch``, and at the end the validation prediction images, the result
plots and ``best.pt`` / ``last.pt`` as versions of the artifact
``model-<run id>``. Training processes other than rank 0 log nothing.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    from ultralytics.utils import RANK
except ImportError as exc:  # pragma: no cover - covered when the extra is absent
    raise ImportError(
        "cairn Ultralytics integration requires `pip install cairn-track[ultralytics]`"
    ) from exc

from .. import Artifact, Image, Run


class CairnCallbacks:
    """The callbacks ``add_cairn_callbacks`` registers; ``run`` is the run of
    the current (or last) ``train()``, None before the first."""

    def __init__(self, project: str = "ultralytics", **run_kwargs: Any):
        self._run_kwargs = dict(run_kwargs, project=project)
        self.run: Run | None = None

    def events(self) -> dict[str, Any]:
        """Ultralytics event name -> callback."""
        return {
            "on_pretrain_routine_start": self.on_pretrain_routine_start,
            "on_train_epoch_end": self.on_train_epoch_end,
            "on_fit_epoch_end": self.on_fit_epoch_end,
            "on_train_end": self.on_train_end,
        }

    def on_pretrain_routine_start(self, trainer: Any) -> None:
        """Create the run; record the trainer arguments as its config."""
        if RANK not in {-1, 0}:
            return
        kw = dict(self._run_kwargs)
        kw.setdefault("name", str(trainer.args.name))
        self.run = Run(**kw)
        self.run.config({k: _jsonable(v) for k, v in vars(trainer.args).items()})

    def on_train_epoch_end(self, trainer: Any) -> None:
        """Training losses (``train/box_loss``, ...) and learning rates
        (``lr/pg0``, ...) at ``step=epoch``."""
        if self.run is None or RANK not in {-1, 0}:
            return
        self._track(trainer.label_loss_items(trainer.tloss, prefix="train"), trainer.epoch)
        self._track(trainer.lr, trainer.epoch)

    def on_fit_epoch_end(self, trainer: Any) -> None:
        """Validation metrics (``metrics/mAP50(B)``, ``val/box_loss``, ...) at
        ``step=epoch``; the final validation of ``best.pt`` lands at
        ``epoch + 1``, as the trainer reports it."""
        if self.run is None or RANK not in {-1, 0}:
            return
        self._track(trainer.metrics, trainer.epoch)

    def on_train_end(self, trainer: Any) -> None:
        """Log the prediction images, the plots and the weights; finish the run."""
        if self.run is None or RANK not in {-1, 0}:
            return
        run, step = self.run, trainer.epoch
        save_dir = Path(trainer.save_dir)
        preds = sorted(save_dir.glob("val_batch*_pred.jpg"))
        if preds:
            run.track([Image(_load(p)) for p in preds], name="val/predictions", step=step)
        plots = [save_dir / "results.png", *sorted(save_dir.glob("confusion_matrix*.png")),
                 *sorted(save_dir.glob("*_curve.png"))]
        for p in plots:
            if p.is_file():
                run.track(Image(_load(p)), name=f"plots/{p.stem}", step=step)
        # best first, so "latest" ends on last.pt.
        for path, aliases in ((Path(trainer.best), ["best"]), (Path(trainer.last), None)):
            if path.is_file():
                art = Artifact(f"model-{run.id}", type="model",
                               metadata={"original_filename": path.name})
                art.add_file(path)
                run.log_artifact(art, aliases=aliases, step=step)
        run.finish("completed")

    def _track(self, values: Any, step: int) -> None:
        assert self.run is not None
        for k, v in (values or {}).items():
            try:
                self.run.track(float(v), name=k, step=step)
            except (TypeError, ValueError):
                continue


def add_cairn_callbacks(model: Any, project: str = "ultralytics", **run_kwargs: Any) -> CairnCallbacks:
    """Log every ``model.train()`` of an Ultralytics ``YOLO`` model to Cairn.

    Args:
        model: The ``ultralytics`` model (``YOLO(...)``, or any model with
            ``add_callback``).
        project: The Cairn project of the runs.
        **run_kwargs: Passed to ``cairn.Run`` (``name`` defaults to the
            trainer's ``name`` argument, e.g. ``train2``).

    Returns:
        The registered callbacks; ``.run`` is the run of the latest training.
    """
    callbacks = CairnCallbacks(project=project, **run_kwargs)
    for event, fn in callbacks.events().items():
        model.add_callback(event, fn)
    return callbacks


def _load(path: Path) -> Any:
    from PIL import Image as PILImage

    with PILImage.open(path) as im:
        return im.convert("RGB")


def _jsonable(v: Any) -> Any:
    """Trainer arguments hold paths and the odd object; keep JSON values,
    stringify the rest."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return str(v)
