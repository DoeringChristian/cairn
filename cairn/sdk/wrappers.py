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


class PointCloud(_TypeWrapper):
    """3D point cloud from an ``(N, C)`` numpy/torch array.

    Accepts three channel layouts (``C`` inferred from the array):

    - ``(N, 3)`` — ``xyz`` positions only.
    - ``(N, 4)`` — ``xyz`` + an integer ``category`` id per point.
    - ``(N, 6)`` — ``xyz`` + ``rgb`` color. Color is auto-detected as either
      ``0-255`` or ``0-1`` and normalized to ``0-1`` at log time.

    Clouds larger than 300,000 points are uniformly downsampled (seeded) at
    log time; the original count is preserved in metadata.

    Usage::

        run.track(cairn.PointCloud(xyz), name="cloud", step=0)          # (N, 3)
        run.track(cairn.PointCloud(xyz_rgb), name="scan", step=0)        # (N, 6)
        run.track(cairn.PointCloud(xyz_cat), name="segments", step=0)    # (N, 4)
    """

    object_type = "pointcloud"


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
