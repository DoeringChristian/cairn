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


class Table(_TypeWrapper):
    """Tabular data (columns + rows), stored as a compact JSON blob.

    Construct either from explicit ``columns`` + ``data``::

        run.track(
            cairn.Table(
                columns=["epoch", "loss", "correct"],
                data=[[0, 1.2, False], [1, 0.7, True]],
            ),
            name="predictions",
            step=0,
        )

    or from a pandas ``DataFrame``::

        run.track(cairn.Table(dataframe=df), name="predictions", step=0)

    Column types (``number``/``string``/``bool``/``other``) are inferred at log
    time. Rows are capped at 10,000 — larger tables are truncated (the original
    row count is recorded in metadata). Values that are not JSON-native are
    stringified. See ``handlers/table.py``.
    """

    object_type = "table"

    def __init__(
        self,
        columns: Any = None,
        data: Any = None,
        dataframe: Any = None,
        **kwargs: Any,
    ):
        # Unlike the positional-``obj`` wrappers, Table takes named tabular
        # inputs; the handler normalises them from this dict.
        self.obj = {"columns": columns, "data": data, "dataframe": dataframe}
        self.kwargs = kwargs


class Html(_TypeWrapper):
    """Sandboxed HTML report string.

    Rendered only inside a ``sandbox="allow-scripts"`` ``srcdoc`` iframe by
    the UI — never inline in the host document.

    Usage::

        run.track(cairn.Html("<h1>Report</h1><p>...</p>"), name="report", step=0)
    """
    object_type = "html"


class Markdown(_TypeWrapper):
    """Markdown text, rendered with GitHub-flavored-markdown support.

    Usage::

        run.track(cairn.Markdown("# Notes\\n\\n- [x] done\\n- [ ] todo"), name="notes", step=0)
    """
    object_type = "markdown"


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


class Volume(_TypeWrapper):
    """Dense scalar 3D volume from a ``(D, H, W)`` numpy/torch array.

    Rendered in the UI via WebGL2 raymarching (maximum-intensity-projection
    or isosurface modes, with a colormap transfer function and per-axis box
    clipping for slicing). Optional ``spacing``/``origin`` (each length-3,
    matching the ``[D, H, W]`` axis order) place the grid in physical space;
    both default to ``[1, 1, 1]`` / ``[0, 0, 0]`` (a unit-per-voxel grid at
    the origin) when omitted.

    Capped at 128MB pre-compression (as float32) — larger volumes raise
    ``ValueError`` at log time rather than being silently truncated.

    Usage::

        run.track(cairn.Volume(density), name="blob", step=0)
        run.track(cairn.Volume(density, spacing=[2.0, 1.0, 1.0]), name="scan", step=0)
    """

    object_type = "volume"


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
