"""Explicit type wrappers that force a specific handler (Aim-style).

Useful for disambiguating polymorphic inputs — e.g. a matplotlib ``Figure``
could reasonably be tracked as an ``image`` (flat PNG) or a ``figure``
(interactive Plotly). Wrappers let the user make the choice at the call site.
"""

from __future__ import annotations

from typing import Any


class _TypeWrapper:
    """Base class for explicit type wrappers.

    Subclasses set ``object_type`` as a class attribute. The ``obj`` and
    ``kwargs`` instance attributes are consumed by the handler dispatcher.
    """

    object_type: str = ""

    def __init__(self, obj: Any, **kwargs: Any):
        self.obj = obj
        self.kwargs = kwargs


class Image(_TypeWrapper):
    """Image, optionally with bounding-box and/or segmentation-mask overlays.

    Overlays are stored inline in the artifact metadata (no second blob).

    Usage::

        run.track(cairn.Image(
            img,
            boxes=[{
                "position": {"minX": 0.1, "minY": 0.2, "maxX": 0.5, "maxY": 0.6},
                "domain": "fraction",   # or "pixel"
                "class_id": 1,
                "label": "cat",
                "score": 0.92,
            }],
            masks={"seg": class_id_array_2d},   # uint8 class ids, 0 = background
            class_labels={0: "background", 1: "cat", 2: "dog"},
        ), name="detections", step=step)
    """

    object_type = "image"


class Figure(_TypeWrapper):
    object_type = "figure"


class Audio(_TypeWrapper):
    object_type = "audio"


class Video(_TypeWrapper):
    object_type = "video"


class Histogram(_TypeWrapper):
    object_type = "histogram"


class Tensor(_TypeWrapper):
    object_type = "tensor"


class Text(_TypeWrapper):
    object_type = "text"


class Artifact(_TypeWrapper):
    """Pickle-serialized Python object.

    Wraps any Python object and stores it as a pickle blob. Useful for
    tracking checkpoints, configs, custom dataclasses, model state dicts,
    or any other Python object that doesn't fit into the typed wrappers.

    Download via the UI yields a ``.pkl`` file that can be loaded with
    ``pickle.load(open("file.pkl", "rb"))``.

    Usage::

        run.track(cairn.Artifact({"lr": 1e-3, "model": "cnn"}), name="config", step=0)
        run.track(cairn.Artifact(model.state_dict()), name="checkpoint", step=100)
        run.log_artifact(cairn.Artifact(my_dataclass), name="final_state")
    """
    object_type = "artifact"
