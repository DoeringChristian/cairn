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
