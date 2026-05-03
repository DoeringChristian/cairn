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
    """Generic artifact — any file or bytes blob.

    Tracks arbitrary files (checkpoints, models, configs, etc.) with
    metadata. Accepts bytes, file paths, or file-like objects.

    Usage::

        run.track(cairn.Artifact(b"raw bytes"), name="config", step=0)
        run.track(cairn.Artifact("/path/to/model.pt"), name="checkpoint", step=100)
        run.track(cairn.Artifact(open("data.csv", "rb")), name="data", step=0)
    """
    object_type = "artifact"
