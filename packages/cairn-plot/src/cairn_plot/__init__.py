"""cairn-plot — the standalone, Plotly-shaped plotting library.

``import cairn_plot as cp`` then compose capitalized objects — :class:`Line`,
:class:`Scatter`, :class:`Bar`, :class:`Histogram`, :class:`Heatmap`,
:class:`ParallelCoordinates`, :class:`Image`, :class:`PointCloud`,
:class:`Mesh`, :class:`Volume`, :class:`Boxes`, :class:`Table`, :class:`Figure`,
:class:`Compare`, :class:`Grid` — into a recursive tree that renders
self-contained (no server, no CDN) in any notebook or as ONE offline HTML file
via :class:`Report`.

The lowercase builders (:func:`scalar` / :func:`line` / :func:`image` /
:func:`figure` / :func:`table` / :func:`mesh` / :func:`pointcloud` /
:func:`volume` / :func:`boxes`) return a ready :class:`PlotElement`. The
pure-numpy Plotly recipe helpers (:func:`confusion_matrix` / :func:`roc_curve` /
:func:`pr_curve` / :func:`bar` / :func:`line_series`) return a
``plotly.graph_objects.Figure``. These coexist case-sensitively
(``cp.Bar`` != ``cp.bar``, ``cp.Line`` != ``cp.line`` != ``cp.line_series``).

The full experiment-tracker (``cairn-track``, ``import cairn``) layers run
integration on top of this exact surface via ``import cairn.plot as cp`` — the
tracked ``run[tag]`` handles, the raw-tabular / 3D-array serialization, and the
server-backed ``*_compare`` helpers live there.
"""

from __future__ import annotations

from typing import Any

from .components import (
    Bar,
    Boxes,
    Compare,
    Component,
    Figure,
    Grid,
    Heatmap,
    Histogram,
    Image,
    Line,
    Mesh,
    ParallelCoordinates,
    PointCloud,
    Scalar,
    Scatter,
    Shared,
    Table,
    Volume,
)
from .elements import Element, HtmlElement, PlotElement
from .recipes import bar, confusion_matrix, line_series, pr_curve, roc_curve
from .report import PlotReport
from .report import PlotReport as Report

__version__ = "0.1.0"


# ---------------------------------------------------------------------------
# Lowercase builders — each returns a ready ``PlotElement`` (design spec §11).
# They are thin fronts over the capitalized composables, kept for parity with
# the ``cairn.plot`` surface (``cp.image``/``cp.scalar``/…).
# ---------------------------------------------------------------------------


def scalar(data: Any, *, data_mode: str = "local") -> PlotElement:
    """A single scalar-sequence plot (mounts the pure ``ScalarPlot`` renderer).
    ``data``: raw numeric values (any array-like) or a ``run[tag]`` handle."""
    return Scalar(data, data_mode=data_mode)._build_element()


def line(
    y: Any, x: Any = None, *, label: str | None = None, data_mode: str = "local"
) -> PlotElement:
    """A line chart — lowercase builder for :class:`Line` (returns a
    ``PlotElement``). Raw-primary: ``line(y)`` / ``line(y, x)`` /
    ``line({"a": ya, "b": yb})``. DISTINCT from :func:`line_series` (a plotly
    ``go.Figure`` recipe)."""
    return Line(y, x=x, label=label, data_mode=data_mode)._build_element()


def figure(data: Any, *, data_mode: str = "local") -> PlotElement:
    """A ``figure`` (Plotly) plot — mounts the pure ``Figure`` renderer.
    ``data``: a plotly ``Figure`` (e.g. from :func:`roc_curve`) or a ``run[tag]``
    figure artifact."""
    return Figure(data, data_mode=data_mode)._build_element()


def table(data: Any, *, data_mode: str = "local") -> PlotElement:
    """A ``table`` plot — mounts the pure ``Table`` renderer. ``data``: raw
    tabular data (DataFrame / list-of-dicts / list-of-rows) or a ``run[tag]``
    table artifact."""
    return Table(data, data_mode=data_mode)._build_element()


def image(data: Any = None, *, url: str | None = None, data_mode: str = "local") -> PlotElement:
    """A single-view ``image`` plot — mounts the pure image renderer. ``data``:
    a raw image (``PIL.Image`` / numpy array / PNG-JPEG ``bytes``) or a
    ``run[tag]`` image artifact. ``url``: a direct URL to the image blob
    (mutually exclusive with ``data``) — the descriptor keeps the URL verbatim
    and the client fetches + sniffs + decodes it, handling formats a browser
    can't ``<img>``-decode (``.exr``/``.npy``/…); those default to the
    float-HDR renderer."""
    return Image(data, url=url, data_mode=data_mode)._build_element()


def mesh(data: Any, faces: Any = None, **kwargs: Any) -> PlotElement:
    """A single-view mesh plot (self-contained). Lowercase alias for
    :class:`Mesh`; accepts raw ``vertices``/``faces`` arrays or a ``run[tag]``
    handle."""
    return Mesh(data, faces, **kwargs)._build_element()


def pointcloud(data: Any, **kwargs: Any) -> PlotElement:
    """A single-view point-cloud plot (self-contained). Lowercase alias for
    :class:`PointCloud`; accepts a raw ``(N,3|4|6)`` array or a ``run[tag]``
    handle."""
    return PointCloud(data, **kwargs)._build_element()


def volume(data: Any, **kwargs: Any) -> PlotElement:
    """A single-view volume plot (self-contained). Lowercase alias for
    :class:`Volume`; accepts a raw ``(D,H,W)`` array or a ``run[tag]``
    handle."""
    return Volume(data, **kwargs)._build_element()


def boxes(data: Any, maxs: Any = None, **kwargs: Any) -> PlotElement:
    """A single-view boxes plot (self-contained). Lowercase alias for
    :class:`Boxes`; accepts raw ``mins``/``maxs`` arrays or a ``run[tag]``
    handle."""
    return Boxes(data, maxs, **kwargs)._build_element()


def report(title: str | None = None) -> Report:
    """A composable, self-contained ``cairn-plot`` report — the lowercase
    factory for :class:`Report` (== :class:`PlotReport`). Chain
    ``.md(...)`` / ``.html(...)`` / ``.add(component)`` / ``.grid(...)``; emit
    via ``_repr_html_`` / ``.show()`` / ``.save(path)``."""
    return Report(title=title)


__all__ = [
    # G2 composable leaves + containers.
    "Line",
    "Scatter",
    "Bar",
    "Histogram",
    "Heatmap",
    "ParallelCoordinates",
    "Image",
    "PointCloud",
    "Mesh",
    "Volume",
    "Boxes",
    "Table",
    "Figure",
    "Compare",
    "Grid",
    "Shared",
    "Component",
    "Report",  # == PlotReport
    "PlotReport",
    "PlotElement",
    "Element",
    "HtmlElement",
    "Scalar",  # deprecated alias == Line
    # Lowercase builders (return a PlotElement).
    "scalar",
    "line",
    "image",
    "figure",
    "table",
    "mesh",
    "pointcloud",
    "volume",
    "boxes",
    "report",
    # Pure-numpy plotly-recipe helpers (return a go.Figure).
    "confusion_matrix",
    "roc_curve",
    "pr_curve",
    "bar",
    "line_series",
    "__version__",
]
