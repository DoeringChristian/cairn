"""G2: the Plotly-style composable ``cairn.plot`` API.

``import cairn.plot as cp`` then compose capitalized objects —
:class:`Scalar`, :class:`Figure`, :class:`Table`, :class:`Image`,
:class:`Compare`, :class:`Grid` — into a recursive tree that renders
self-contained in any notebook (design spec §5–§7 / plan G2).

Each object is a :class:`Component`. A component knows how to lower itself to
ONE ``PlotNode`` dict (:meth:`Component.to_node`) — a leaf ``plot``, a ``grid``,
or a ``compare`` — and to contribute its baked binary blobs to a merged
content-addressed store (:meth:`Component._collect_store`). ``_build_element``
wraps that into a :class:`~cairn.sdk.elements.PlotElement`:

* a **leaf** component lowers to the FLAT ``PlotSpec`` form (``{renderer, props,
  data, mode}``) so a standalone ``cp.Image(...)`` / ``cp.scalar(...)`` renders
  through the exact legacy-flat path (and the emit tests) it always has;
* a **container** (``Grid``/``Compare`` split/blend/diff) lowers to the recursive
  ``PlotDescriptorSpec(root=…)`` tree the G1 ``<PlotGrid>`` compositor renders.

The heavy data-shaping (scalar sequence → ``Series``, plotly ``Figure`` → JSON,
DataFrame → table blob, image bytes → content-addressed store) is REUSED from
:mod:`cairn.plot`'s lowercase builders via a lazy import (``plot`` imports this
module, not vice-versa) — one shaper, two front doors.
"""

from __future__ import annotations

import base64 as _base64
import html as _html
import logging
from typing import Any, Sequence

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# DataRef seam (packaging spec §4 / P2-M1).
#
# The pure plot components must not import cairn's reader (``cairn.sdk.reader``
# pulls in run/wal/local/transport/server). A ``run[tag]`` handle is instead
# recognized through a small registry the cairn app-layer populates:
# ``cairn/plot.py`` calls :func:`register_data_ref_type(DataRef)` at import, so
# ``_is_data_ref(run[tag])`` is True in the normal ``import cairn.plot`` flow
# while a STANDALONE ``import cairn.sdk.plot_components`` (no cairn.plot) stays
# pure — standalone users pass raw data (numpy/PIL/bytes), never a DataRef.
# ---------------------------------------------------------------------------

_DATA_REF_TYPES: tuple[type, ...] = ()


def register_data_ref_type(cls: type) -> None:
    """Register a concrete ``run[tag]`` handle type (cairn's ``DataRef``) so the
    pure components recognize it via :func:`_is_data_ref` without importing
    ``cairn.sdk.reader``. Idempotent."""
    global _DATA_REF_TYPES
    if cls not in _DATA_REF_TYPES:
        _DATA_REF_TYPES = _DATA_REF_TYPES + (cls,)


def _is_data_ref(obj: Any) -> bool:
    """Whether ``obj`` is a registered ``run[tag]`` handle (a cairn ``DataRef``).
    Always ``False`` in a standalone (no-cairn.plot) import — raw data only."""
    return bool(_DATA_REF_TYPES) and isinstance(obj, _DATA_REF_TYPES)


# ---------------------------------------------------------------------------
# Resolver seam (packaging spec §4 / P2-M2).
#
# A handful of data paths need cairn's tracking handlers (raw table + 3D array
# serialization). ``cairn_plot`` imports NEITHER handlers nor the reader;
# ``cairn.plot`` registers those resolvers here at import, so ``cp.Table(df)`` /
# ``cp.PointCloud(arr)`` / a ``run[tag]`` handle keep working unchanged through
# the shim. A STANDALONE ``import cairn_plot`` leaves them unset and those
# specific paths raise a clear, actionable error — raw numeric / image / figure
# data still renders fully offline.
# ---------------------------------------------------------------------------

_RESOLVERS: dict[str, Any] = {}


def register_resolvers(**resolvers: Any) -> None:
    """Register cairn-side data resolvers (idempotent dict update)."""
    _RESOLVERS.update(resolvers)


def _resolver(name: str) -> Any:
    fn = _RESOLVERS.get(name)
    if fn is None:
        raise RuntimeError(
            f"cairn-plot: the {name!r} data path needs the full cairn-track "
            "install (its tracking handlers). Standalone cairn-plot renders "
            "raw numeric / image / figure data offline; for tracked run[tag] "
            "handles, raw tabular (DataFrame / dict / list-of-rows) and "
            "3D-array (pointcloud / mesh / volume / boxes) serialization, "
            "`pip install cairn-track`."
        )
    return fn


# The compare compositor's one-pane modes (mirrors `_COMPARE_MODES` in
# `cairn/plot.py`); `"side"` lowers to a 2-cell Grid, the rest to a compare node.
_COMPARE_NODE_MODES = ("split", "blend", "diff")


# ---------------------------------------------------------------------------
# Shared props helper.
# ---------------------------------------------------------------------------


class Shared:
    """A small typed helper for a grid's ``shared`` block (colormap/colorRange/
    colorbar/reference/sync). Equivalent to passing the same dict — validated
    against ``SharedPropsSpec`` when the grid builds. ``reference`` may be an
    image-like :class:`Component` (its DataSpec + store fragment are pulled in)."""

    def __init__(
        self,
        *,
        colormap: str | None = None,
        colorRange: Sequence[float] | None = None,
        colorbar: bool | None = None,
        reference: Any = None,
        sync: dict[str, Any] | None = None,
    ) -> None:
        self.colormap = colormap
        self.colorRange = colorRange
        self.colorbar = colorbar
        self.reference = reference
        self.sync = sync

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.colormap is not None:
            out["colormap"] = self.colormap
        if self.colorRange is not None:
            out["colorRange"] = list(self.colorRange)
        if self.colorbar is not None:
            out["colorbar"] = self.colorbar
        if self.reference is not None:
            out["reference"] = self.reference
        if self.sync is not None:
            out["sync"] = dict(self.sync)
        return out


def _normalize_shared(shared: Any) -> tuple[dict[str, Any] | None, dict[str, dict[str, str]]]:
    """A ``shared`` arg (dict / :class:`Shared` / ``None``) → ``(shared_dict,
    store_fragment)``. A ``reference`` that is an image-like Component is lowered
    to its DataSpec and its store blob is pulled into the fragment."""
    if shared is None:
        return None, {}
    if isinstance(shared, Shared):
        raw = shared.to_dict()
    elif isinstance(shared, dict):
        raw = dict(shared)
    else:
        raise TypeError(
            f"Grid(shared=...) must be a dict or cp.Shared, got {type(shared).__name__}"
        )
    store: dict[str, dict[str, str]] = {}
    ref = raw.get("reference")
    if isinstance(ref, Component):
        data = ref._leaf_dataspec()
        if data is None:
            raise TypeError(
                "Grid(shared={'reference': ...}) requires an image-like leaf "
                "(cp.Image); got a non-image component."
            )
        raw["reference"] = data
        store.update(ref._collect_store())
    return raw, store


# ---------------------------------------------------------------------------
# Component base.
# ---------------------------------------------------------------------------


class Component:
    """Base for composable ``cairn.plot`` objects (design spec §6 / plan G2.1).

    Subclasses implement :meth:`to_node` (lower to one ``PlotNode`` dict) and,
    when they bake binary data, :meth:`_collect_store`. Everything else — the
    ``PlotElement`` wrapping, the never-raising display hooks — lives here.
    """

    _data_mode: str = "local"
    _label: str = "plot"
    _height: int | None = None

    # ---- lowering ----

    def to_node(self) -> dict[str, Any]:  # pragma: no cover - abstract
        raise NotImplementedError

    def _collect_store(self) -> dict[str, dict[str, str]]:
        """Content-addressed store fragments (``{hash: {mime, b64}}``) merged
        from self + descendants. Default: none."""
        return {}

    def _leaf_dataspec(self) -> dict[str, Any] | None:
        """This component's image/url ``DataSpec`` dict if it is an image-like
        leaf, else ``None`` (used by :class:`Compare`/``shared.reference``)."""
        node = self.to_node()
        if node.get("kind") == "plot":
            data = node.get("data") or {}
            if data.get("kind") in ("image", "url"):
                return data
        return None

    # ---- element construction ----

    def _endpoint_server(self) -> str:
        from .shapers import _endpoint_server_of

        return _endpoint_server_of(getattr(self, "_source", None))

    def _build_element(self):
        """Wrap this component into a :class:`~cairn.sdk.elements.PlotElement`.

        A leaf lowers to the flat ``PlotSpec`` (legacy-flat render path);
        a container lowers to the recursive ``PlotDescriptorSpec`` tree."""
        from .elements import PlotElement
        from .spec import PlotDescriptorSpec, PlotSpec

        node = self.to_node()
        store = self._collect_store()

        if node.get("kind") == "plot":
            props = node.get("props") or {}
            data = node["data"]
            if self._data_mode == "endpoint":
                server = self._endpoint_server()
                spec = PlotSpec(
                    renderer=node["renderer"],
                    props=props,
                    data=data,
                    mode="endpoint",
                    endpoint=server,
                )
                return PlotElement(
                    spec, bundle="link", server=server, label=self._label, height=self._height
                )
            spec = PlotSpec(
                renderer=node["renderer"], props=props, data=data, mode="local"
            )
            return PlotElement(
                spec, store=store, bundle="inline", label=self._label, height=self._height
            )

        # Container (grid / compare): the recursive tree descriptor.
        spec = PlotDescriptorSpec(root=node, mode="local")
        return PlotElement(
            spec, store=store, bundle="inline", label=self._label, height=self._height
        )

    # ---- display protocol (never raises) ----

    def _repr_html_(self) -> str:
        try:
            return self._build_element()._repr_html_()
        except Exception as exc:  # noqa: BLE001 - display hooks must never raise
            log.debug("cairn plot component render failed: %s", exc)
            return (
                "<pre>cairn-plot: could not render this component "
                f"({_html.escape(type(exc).__name__)}: {_html.escape(str(exc))}).</pre>"
            )

    def _repr_mimebundle_(
        self, include: Any = None, exclude: Any = None
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        try:
            return self._build_element()._repr_mimebundle_(include, exclude)
        except Exception as exc:  # noqa: BLE001
            log.debug("cairn plot component mimebundle failed: %s", exc)
            return (
                {
                    "text/html": (
                        "<pre>cairn-plot: could not render this component "
                        f"({_html.escape(type(exc).__name__)}).</pre>"
                    ),
                    "text/plain": repr(self),
                },
                {},
            )

    def show(self):
        """Display in a notebook (via ``IPython.display``) if available, else
        return ``self`` (so a plain-Python REPL still gets the object back)."""
        try:
            from IPython.display import display
        except Exception:  # noqa: BLE001 - not in a notebook
            return self
        display(self)
        return None


# ---------------------------------------------------------------------------
# Leaves — cp.Scalar / Figure / Table / Image.
# ---------------------------------------------------------------------------


class Line(Component):
    """A line chart (mounts the pure ``ScalarPlot`` renderer, key ``scalar``).

    Raw data is the primary input (Plotly-style):

    * ``cp.Line(y)`` — a single 1-D sequence plotted against its integer index;
    * ``cp.Line(y, x)`` — an explicit shared x-axis;
    * ``cp.Line({"loss": ya, "val": yb})`` — one named series per dict entry;
    * ``cp.Line([[...], [...]])`` — a 2-D array, one series per row;
    * ``cp.Line(run["loss"])`` — convenience: a tracked scalar sequence.

    ``label`` names the single-series case. Raw data is always ``local``;
    a ``run[tag]`` handle honours ``data_mode`` (``"endpoint"`` links the
    renderer to the source server).
    """

    _label = "line"

    def __init__(
        self, y: Any, x: Any = None, *, label: str | None = None, data_mode: str = "local"
    ) -> None:
        from .shapers import (
            _check_data_mode,
            _line_series_list,
            _scalar_series_from_ref,
        )

        _check_data_mode(data_mode)
        if _is_data_ref(y):
            series = [_scalar_series_from_ref(y)]
            self._source: Any = y
            self._data_mode = data_mode
        else:
            series = _line_series_list(y, x=x, label=label)
            self._source = None
            self._data_mode = "local"
        self._inline = {"series": series}

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "scalar",
            "data": {"kind": "inline", "props": self._inline},
        }


# ``cp.Scalar`` is the deprecated pre-G2 name for a line chart — a scalar
# sequence IS a line plot. Kept as a thin alias (case-sensitive; distinct from
# the lowercase ``cp.scalar`` builder that returns a ``PlotElement``).
Scalar = Line


class Scatter(Component):
    """A scatter plot (renderer key ``scatter``).

    ``cp.Scatter(x, y, *, color=None, labels=None, x_label=None, y_label=None,
    color_label=None, x_log=False, y_log=False)``. ``color`` is a per-point
    numeric value mapped through the viridis colorbar. Raw-only (``local``)."""

    _label = "scatter"

    def __init__(
        self,
        x: Any,
        y: Any,
        *,
        color: Any = None,
        labels: Any = None,
        x_label: str | None = None,
        y_label: str | None = None,
        color_label: str | None = None,
        x_log: bool = False,
        y_log: bool = False,
    ) -> None:
        from .shapers import _scatter_points_from_raw

        points = _scatter_points_from_raw(x, y, color=color, labels=labels)
        self._inline = {"points": points}
        cfg: dict[str, Any] = {}
        if x_label is not None:
            cfg["xLabel"] = x_label
        if y_label is not None:
            cfg["yLabel"] = y_label
        if color_label is not None:
            cfg["colorLabel"] = color_label
        if x_log:
            cfg["xLog"] = True
        if y_log:
            cfg["yLog"] = True
        self._config = cfg

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "plot",
            "renderer": "scatter",
            "data": {"kind": "inline", "props": self._inline},
        }
        if self._config:
            node["props"] = self._config
        return node


class Bar(Component):
    """A bar chart (renderer key ``bar``).

    ``cp.Bar(values, *, labels=None, colors=None, value_label=None,
    log_x=False)``. Labels default to the bar index. Raw-only (``local``).
    Distinct from the lowercase ``cp.bar`` plotly-recipe (returns a
    ``go.Figure``); this capitalized native composable emits a ``PlotElement``."""

    _label = "bar"

    def __init__(
        self,
        values: Any,
        *,
        labels: Any = None,
        colors: Any = None,
        value_label: str | None = None,
        log_x: bool = False,
    ) -> None:
        from .shapers import _bar_data_from_raw

        self._inline = {"bars": _bar_data_from_raw(values, labels=labels, colors=colors)}
        cfg: dict[str, Any] = {}
        if value_label is not None:
            cfg["valueLabel"] = value_label
        if log_x:
            cfg["logX"] = True
        self._config = cfg

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "plot",
            "renderer": "bar",
            "data": {"kind": "inline", "props": self._inline},
        }
        if self._config:
            node["props"] = self._config
        return node


class Histogram(Component):
    """A histogram (renderer key ``histogram``, ``view="bars"``).

    ``cp.Histogram(x, *, bins=30)`` computes ``counts``/``edges`` via
    ``numpy.histogram``; or pass precomputed ``cp.Histogram(counts=...,
    edges=...)`` (``len(edges) == len(counts) + 1``). Raw-only (``local``)."""

    _label = "histogram"

    def __init__(
        self,
        x: Any = None,
        *,
        bins: int = 30,
        counts: Any = None,
        edges: Any = None,
        log_y: bool = False,
    ) -> None:
        from .shapers import _histogram_check_precomputed, _histogram_from_samples

        if counts is not None or edges is not None:
            if x is not None:
                raise ValueError(
                    "cp.Histogram(...): pass samples `x` OR precomputed "
                    "`counts`/`edges`, not both"
                )
            if counts is None or edges is None:
                raise ValueError(
                    "cp.Histogram(counts=..., edges=...): both counts and edges "
                    "are required for the precomputed form"
                )
            c, e = _histogram_check_precomputed(counts, edges)
        else:
            if x is None:
                raise ValueError(
                    "cp.Histogram(...) requires either samples `x` or precomputed "
                    "`counts`/`edges`"
                )
            c, e = _histogram_from_samples(x, bins=bins)
        self._inline = {"counts": c, "edges": e}
        self._config: dict[str, Any] = {"view": "bars"}
        if log_y:
            self._config["logY"] = True

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "histogram",
            "props": self._config,
            "data": {"kind": "inline", "props": self._inline},
        }


class Heatmap(Component):
    """A heatmap (renderer key ``heatmap``).

    ``cp.Heatmap(z, *, colormap="viridis", zmin=None, zmax=None,
    log_color=False, origin_top=True, x_label=None, y_label=None,
    value_label=None)`` where ``z`` is a 2-D array (``matrix[y][x]``).
    Convenience: ``cp.Heatmap(run["confusion"])`` deserializes a 2-D artifact.
    ``colormap`` is one of ``viridis``/``red-green``/``red-blue``."""

    _label = "heatmap"

    def __init__(
        self,
        z: Any,
        *,
        colormap: str = "viridis",
        zmin: float | None = None,
        zmax: float | None = None,
        log_color: bool = False,
        origin_top: bool = True,
        x_label: str | None = None,
        y_label: str | None = None,
        value_label: str | None = None,
        data_mode: str = "local",
    ) -> None:
        from .shapers import _check_data_mode, _heatmap_matrix_from_raw

        _check_data_mode(data_mode)
        if _is_data_ref(z):
            arr = z.run.artifact(z.tag, step=z.step)
            matrix = _heatmap_matrix_from_raw(arr)
            self._source: Any = z
            self._data_mode = data_mode
        else:
            matrix = _heatmap_matrix_from_raw(z)
            self._source = None
            self._data_mode = "local"
        self._inline = {"matrix": matrix}
        cfg: dict[str, Any] = {"colormap": colormap}
        if zmin is not None:
            cfg["min"] = zmin
        if zmax is not None:
            cfg["max"] = zmax
        if log_color:
            cfg["logColor"] = True
        # The renderer defaults originTop=true; only emit when overridden false.
        if not origin_top:
            cfg["originTop"] = False
        if x_label is not None:
            cfg["xLabel"] = x_label
        if y_label is not None:
            cfg["yLabel"] = y_label
        if value_label is not None:
            cfg["valueLabel"] = value_label
        self._config = cfg

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "heatmap",
            "props": self._config,
            "data": {"kind": "inline", "props": self._inline},
        }


class ParallelCoordinates(Component):
    """A parallel-coordinates plot (renderer key ``parallel``).

    ``cp.ParallelCoordinates(dimensions)`` where ``dimensions`` is a list of
    ``{label, values}`` dicts (Plotly-style), a ``{label: values}`` dict, or a
    pandas ``DataFrame`` (duck-typed). Numeric columns keep their scale;
    non-numeric columns are treated categorically (first-seen index). The last
    column drives the line color. Raw-only (``local``)."""

    _label = "parallel"

    def __init__(self, dimensions: Any) -> None:
        from .shapers import _parallel_from_dimensions

        columns, rows, column_domains = _parallel_from_dimensions(dimensions)
        self._inline = {
            "columns": columns,
            "rows": rows,
            "columnDomains": column_domains,
        }

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "parallel",
            "data": {"kind": "inline", "props": self._inline},
        }


class Figure(Component):
    """A ``figure`` (Plotly) plot. ``data``: a ``run[tag]`` figure artifact OR a
    plotly ``Figure``. Raw figures are always ``local``."""

    _label = "figure"

    def __init__(self, data: Any, *, data_mode: str = "local") -> None:
        from .shapers import (
            _check_data_mode,
            _figure_json_from_plotly,
            _figure_json_from_ref,
        )

        _check_data_mode(data_mode)
        if _is_data_ref(data):
            fig_json = _figure_json_from_ref(data)
            self._source: Any = data
            self._data_mode = data_mode
        else:
            fig_json = _figure_json_from_plotly(data)
            self._source = None
            self._data_mode = "local"
        self._inline = {"figure": fig_json}

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "figure",
            "data": {"kind": "inline", "props": self._inline},
        }


class Table(Component):
    """A ``table`` plot. ``data``: a ``run[tag]`` table artifact OR raw tabular
    data (DataFrame / list-of-dicts / list-of-rows). Raw data is always
    ``local``."""

    _label = "table"
    _height = 200

    def __init__(self, data: Any, *, data_mode: str = "local") -> None:
        from .shapers import _check_data_mode, _table_json_from_ref

        _check_data_mode(data_mode)
        if _is_data_ref(data):
            tbl = _table_json_from_ref(data)
            self._source: Any = data
            self._data_mode = data_mode
        else:
            tbl = _resolver("table_raw")(data)
            self._source = None
            self._data_mode = "local"
        self._inline = {"table": tbl}

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "table",
            "data": {"kind": "inline", "props": self._inline},
        }


def _image_display_props(
    *,
    exposure: float | None = None,
    gamma: float | None = None,
    brightness: float | None = None,
    contrast: float | None = None,
    offset: float | None = None,
    flip_sign: bool | None = None,
    colormap: str | None = None,
    interpolation: str | None = None,
    show_axes: bool | None = None,
    pixel_value_notation: str | None = None,
) -> dict[str, Any]:
    """Build the non-data ``props`` an image / image-compare renderer honours:
    a full ``processing`` block (exposure EV, gamma, brightness, contrast,
    offset, sign-flip) when any is set, plus ``colormap`` / ``interpolation`` /
    ``showAxes``. Matches ``ImageProcessing`` + ``ImagePane`` props in the TS
    library. NOTE: with the current 8-bit image pipeline these are display
    adjustments applied to already-8-bit pixels (true float HDR is a separate,
    future path)."""
    props: dict[str, Any] = {}
    if any(v is not None for v in (exposure, gamma, brightness, contrast, offset, flip_sign)):
        props["processing"] = {
            "brightness": float(brightness) if brightness is not None else 0.0,
            "contrast": float(contrast) if contrast is not None else 0.0,
            "gamma": float(gamma) if gamma is not None else 1.0,
            "exposure": float(exposure) if exposure is not None else 0.0,
            "offset": float(offset) if offset is not None else 0.0,
            "flipSign": bool(flip_sign) if flip_sign is not None else False,
        }
    if colormap is not None:
        props["colormap"] = colormap
    if interpolation is not None:
        props["interpolation"] = interpolation
    if show_axes is not None:
        props["showAxes"] = bool(show_axes)
    if pixel_value_notation is not None:
        props["pixelValueNotation"] = _check_pixel_value_notation(pixel_value_notation)
    return props


_PIXEL_VALUE_NOTATIONS = ("decimal", "int")


def _check_pixel_value_notation(value: str) -> str:
    """Validate the TEV pixel-value overlay notation kwarg. ``"decimal"`` prints
    floats where 1.0 = SDR white (HDR > 1.0 shown); ``"int"`` prints an integer
    scale where 255 = 1.0 = SDR white (HDR > 255 shown). The default is the
    renderer's own ``"decimal"`` — omit the kwarg to inherit it."""
    if value not in _PIXEL_VALUE_NOTATIONS:
        raise ValueError(
            f"pixel_value_notation must be one of {_PIXEL_VALUE_NOTATIONS!r}, "
            f"got {value!r}"
        )
    return value


_HDR_TONEMAP_OPERATORS = ("linear", "srgb", "reinhard", "aces")


def _image_hdr_props(
    *,
    tonemap: str | None = None,
    exposure: float | None = None,
    gamma: float | None = None,
    interpolation: str | None = None,
    show_axes: bool | None = None,
    pixel_value_notation: str | None = None,
) -> dict[str, Any]:
    """Build the ``imagehdr`` renderer props (real HDR tone-map, NOT the 8-bit
    CSS-filter ``processing`` block). ``tonemap`` defaults to ``"srgb"`` and
    ``exposure`` to ``0`` (always emitted). ``gamma`` is an OPTIONAL override —
    it is included ONLY when the caller explicitly passes it, so the renderer's
    correct sRGB output-encode (HDR-A M1) stays the default. ``showAxes`` /
    ``interpolation`` are the two extra ``HdrImagePane`` props honoured."""
    tm = tonemap if tonemap is not None else "srgb"
    if tm not in _HDR_TONEMAP_OPERATORS:
        raise ValueError(
            f"cp.Image(tonemap={tm!r}) must be one of {_HDR_TONEMAP_OPERATORS!r}."
        )
    props: dict[str, Any] = {
        "tonemap": tm,
        "exposure": float(exposure) if exposure is not None else 0.0,
    }
    if gamma is not None:
        props["gamma"] = float(gamma)
    if interpolation is not None:
        props["interpolation"] = interpolation
    if show_axes is not None:
        props["showAxes"] = bool(show_axes)
    if pixel_value_notation is not None:
        props["pixelValueNotation"] = _check_pixel_value_notation(pixel_value_notation)
    return props


class Image(Component):
    """A single-view image plot.

    Two pipelines share one leaf, routed by the data:

    * **8-bit** (``image`` renderer, the default) — mounts the pure ``ImagePane``.
      ``data`` accepts a ``run[tag]`` image artifact (LOCAL bakes the bytes into
      the content-addressed store; ENDPOINT emits an ``image`` DataSpec by
      reference), a raw image (``PIL.Image`` / numpy array / PNG-JPEG ``bytes``,
      baked LOCAL only), or a raw URL ``str`` (a ``url`` DataSpec). ``exposure``/
      ``gamma``/``brightness``/``contrast``/``offset``/``flip_sign``/``colormap``
      map to the display-space ``processing`` CSS-filter block.
    * **float-HDR** (``imagehdr`` renderer) — a genuine float array is baked to a
      float ``.npy`` (``imghdr`` DataSpec) and tone-mapped client-side. Entered
      when ``data`` is a **float** numpy array AND (``hdr=True`` OR (``hdr`` unset
      AND the array has values outside ``[0,1]``)). ``hdr=False`` forces the
      8-bit clamp path; a uint8 array or a float array in ``[0,1]`` (``hdr``
      unset) stays 8-bit. HDR props route to the real tone-map: ``tonemap`` ∈
      ``{linear,srgb,reinhard,aces}`` (default ``srgb``), ``exposure`` (EV
      stops), and an OPTIONAL ``gamma`` override; ``showAxes``/``interpolation``
      are honoured; ``colormap``/``brightness``/``contrast``/``offset``/
      ``flip_sign`` are 8-bit-only and ignored (with a note) on the HDR path.

    NOTE: a ``run[tag]`` handle always takes the 8-bit path — the tracking
    ingest clamps images to 8-bit, so no float artifact exists yet. Real HDR is
    from raw float arrays only, for now.
    """

    _label = "image"

    def __init__(
        self,
        data: Any = None,
        *,
        url: str | None = None,
        data_mode: str = "local",
        hdr: bool | None = None,
        tonemap: str | None = None,
        exposure: float | None = None,
        gamma: float | None = None,
        brightness: float | None = None,
        contrast: float | None = None,
        offset: float | None = None,
        flip_sign: bool | None = None,
        colormap: str | None = None,
        interpolation: str | None = None,
        show_axes: bool | None = None,
        pixel_value_notation: str | None = None,
    ) -> None:
        import json as _json

        import numpy as np

        from .shapers import (
            _artifact_info_of,
            _check_data_mode,
            _content_hash,
            _encode_image_raw,
        )

        _check_data_mode(data_mode)
        self._source: Any = None
        self._store: dict[str, dict[str, str]] = {}
        self._data_mode = data_mode
        self._renderer = "image"

        # ── URL source (client fetch + sniff + decode) ───────────────────
        # `cp.Image(url=...)` references the blob BY URL instead of embedding it:
        # the emitted descriptor keeps the URL verbatim, and the client fetches
        # + decodes it (handles exr/npy/… a browser can't <img>-decode). The
        # renderer is chosen here (fixed at emit time): explicit `hdr=` wins,
        # else the URL extension (.exr/.npy/.npz → the float-HDR renderer, which
        # consumes the `hdr` prop the url decode yields; otherwise the 8-bit
        # `image` renderer, which consumes the `imageUrl` data URL).
        if url is not None:
            if data is not None:
                raise ValueError("cp.Image: pass EITHER data or url, not both.")
            if not isinstance(url, str):
                raise ValueError("cp.Image(url=...) must be a string URL.")
            stem = url.split("?", 1)[0].split("#", 1)[0]
            ext = stem.rsplit(".", 1)[-1].lower() if "." in stem else ""
            use_hdr = hdr if hdr is not None else ext in ("exr", "npy", "npz")
            if tonemap is not None and not use_hdr:
                raise ValueError(
                    "cp.Image(url=..., tonemap=...) is HDR-only: pass hdr=True or a "
                    "float/exr URL (.exr/.npy/.npz)."
                )
            if use_hdr:
                self._props = _image_hdr_props(
                    tonemap=tonemap, exposure=exposure, gamma=gamma,
                    interpolation=interpolation, show_axes=show_axes,
                    pixel_value_notation=pixel_value_notation,
                )
                self._renderer = "imagehdr"
            else:
                self._props = _image_display_props(
                    exposure=exposure, gamma=gamma, brightness=brightness,
                    contrast=contrast, offset=offset, flip_sign=flip_sign,
                    colormap=colormap, interpolation=interpolation,
                    show_axes=show_axes, pixel_value_notation=pixel_value_notation,
                )
                self._renderer = "image"
            self._data: dict[str, Any] = {"kind": "image", "hash": None, "url": url}
            self._data_mode = data_mode
            return

        if data is None:
            raise ValueError("cp.Image requires `data` (or `url=`).")

        # ── HDR routing ──────────────────────────────────────────────────
        # HDR applies only to a raw float ndarray (never a DataRef/URL/bytes/
        # PIL). `hdr=True` forces it for any float array; `hdr is None`
        # auto-detects genuine HDR range (values outside [0,1]); `hdr=False`
        # forces the 8-bit clamp path.
        is_float_ndarray = isinstance(data, np.ndarray) and data.dtype.kind == "f"
        if hdr is True and not is_float_ndarray:
            raise ValueError(
                "cp.Image(hdr=True) requires a float numpy array (dtype kind "
                f"'f'); got {type(data).__name__}"
                + (f" of dtype {data.dtype}" if isinstance(data, np.ndarray) else "")
                + "."
            )
        want_hdr = False
        if is_float_ndarray and hdr is not False:
            if hdr is True:
                want_hdr = True
            elif data.size and (float(data.min()) < 0.0 or float(data.max()) > 1.0):
                want_hdr = True  # auto-detect: genuine HDR range
        if tonemap is not None and not want_hdr:
            raise ValueError(
                "cp.Image(tonemap=...) is HDR-only: pass a float numpy array "
                "with values outside [0,1], or hdr=True to force the HDR path."
            )

        if want_hdr:
            if data_mode == "endpoint":
                raise ValueError(
                    "cp.Image(float_hdr, data_mode='endpoint') is unsupported: "
                    "a baked float array has no server reference. Use "
                    "data_mode='local' (bakes the .npy self-contained)."
                )
            ignored = [
                n for n, v in (
                    ("colormap", colormap), ("brightness", brightness),
                    ("contrast", contrast), ("offset", offset),
                    ("flip_sign", flip_sign),
                ) if v is not None
            ]
            if ignored:
                log.warning(
                    "cp.Image HDR path ignores 8-bit-only args %s "
                    "(the imagehdr renderer honours tonemap/exposure/gamma/"
                    "showAxes/interpolation).",
                    ignored,
                )
            self._props = _image_hdr_props(
                tonemap=tonemap, exposure=exposure, gamma=gamma,
                interpolation=interpolation, show_axes=show_axes,
                pixel_value_notation=pixel_value_notation,
            )
            # M2: guarantee C-contiguous float32 (halves size vs float64; the
            # renderer's parseNpy reads C-order, ROW-MAJOR bytes).
            arr = np.ascontiguousarray(data, dtype=np.float32)
            if arr.ndim == 2:
                channels = 1
            elif arr.ndim == 3 and arr.shape[2] in (1, 3, 4):
                channels = int(arr.shape[2])
            else:
                raise ValueError(
                    "cp.Image(float_hdr): array must be (H,W) or (H,W,C) with "
                    f"C in {{1,3,4}}; got shape {tuple(int(s) for s in arr.shape)}."
                )
            meta = {
                "shape": [int(s) for s in arr.shape],
                "dtype": "float32",
                "channels": channels,
                "vmin": float(arr.min()),
                "vmax": float(arr.max()),
            }
            import io as _io

            buf = _io.BytesIO()
            np.save(buf, arr)
            raw = buf.getvalue()
            hash_ = _content_hash(raw)
            self._store = {
                hash_: {
                    "mime": "application/octet-stream",
                    "b64": _base64.b64encode(raw).decode("ascii"),
                }
            }
            self._data: dict[str, Any] = {"kind": "imghdr", "hash": hash_, "meta": meta}
            self._renderer = "imagehdr"
            self._data_mode = "local"
            return

        # ── 8-bit path (unchanged) ───────────────────────────────────────
        self._props = _image_display_props(
            exposure=exposure, gamma=gamma, brightness=brightness,
            contrast=contrast, offset=offset, flip_sign=flip_sign,
            colormap=colormap, interpolation=interpolation, show_axes=show_axes,
            pixel_value_notation=pixel_value_notation,
        )

        if _is_data_ref(data):
            ai = _artifact_info_of(data)
            hash_ = ai.hash
            mime = ai.mime_type or "image/png"
            meta_str = (
                ai.metadata
                if isinstance(ai.metadata, str)
                else (_json.dumps(ai.metadata) if ai.metadata else None)
            )
            self._data: dict[str, Any] = {"kind": "image", "hash": hash_}
            if meta_str is not None:
                self._data["metadata"] = meta_str
            if data_mode == "endpoint":
                self._source = data
            else:
                raw = data.run.artifact_bytes(data.tag, step=data.step)
                self._store = {
                    hash_: {"mime": mime, "b64": _base64.b64encode(raw).decode("ascii")}
                }
            return

        if isinstance(data, str):
            # A raw URL passthrough (no bytes to bake).
            self._data = {"kind": "url", "src": data}
            self._data_mode = "local"
            return

        # Raw image (PIL / ndarray / bytes) — LOCAL only.
        if data_mode == "endpoint":
            raise ValueError(
                "cp.Image(raw, data_mode='endpoint') is unsupported: raw images "
                "have no server reference. Use data_mode='local' (bakes the "
                "bytes self-contained)."
            )
        raw, mime = _encode_image_raw(data)
        hash_ = _content_hash(raw)
        self._store = {hash_: {"mime": mime, "b64": _base64.b64encode(raw).decode("ascii")}}
        self._data = {"kind": "image", "hash": hash_}
        self._data_mode = "local"

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "plot", "renderer": self._renderer, "data": self._data
        }
        if self._props:
            node["props"] = dict(self._props)
        return node

    def _collect_store(self) -> dict[str, dict[str, str]]:
        return dict(self._store)


class PointCloud(Component):
    """A 3D point-cloud plot (mounts the pure point-cloud viewer, key
    ``pointcloud`` — carried by the three.js addon).

    Raw data is the primary input:

    * ``cp.PointCloud(xyz)`` — an ``(N, 3)``, ``(N, 4)`` or ``(N, 6)`` array
      (xyz, optionally + intensity, or xyz + rgb); baked self-contained (LOCAL);
    * ``cp.PointCloud(run[tag])`` — a tracked ``pointcloud`` artifact; LOCAL
      bakes the ``.npy``/``.npz`` bytes, ENDPOINT emits by reference.

    ``values`` attaches named per-point scalar properties (raw input only).
    Optional view overrides: ``point_size``, ``point_size_mode``
    (``"screen"``/``"world"``), ``color_mode`` (``"auto"``/…), ``background``
    (``"dark"``/``"light"``), ``show_axes``.

    ``point_size_mode`` controls how ``point_size`` is interpreted and how
    points scale with camera distance: ``"screen"`` (default) keeps a constant
    IMAGE-space size (``point_size`` in PIXELS — points stay the same on-screen
    size as you orbit/zoom); ``"world"`` gives perspective attenuation
    (``point_size`` in WORLD units — points shrink with distance).
    """

    _label = "pointcloud"
    _height = 400

    def __init__(
        self,
        data: Any,
        *,
        values: Any = None,
        data_mode: str = "local",
        point_size: float | None = None,
        point_size_mode: str | None = None,
        color_mode: str | None = None,
        background: str | None = None,
        show_axes: bool | None = None,
        show_planes: bool | None = None,
        camera_mode: str | None = None,
    ) -> None:
        from .shapers import (
            _artifact_info_of,
            _check_data_mode,
            _content_hash,
            _parse_meta,
        )

        _check_data_mode(data_mode)
        self._source: Any = None
        self._store: dict[str, dict[str, str]] = {}
        self._data_mode = data_mode

        self._props: dict[str, Any] = {}
        if point_size is not None:
            self._props["pointSize"] = float(point_size)
        if point_size_mode is not None:
            self._props["pointSizeMode"] = point_size_mode
        if color_mode is not None:
            self._props["colorMode"] = color_mode
        if background is not None:
            self._props["background"] = background
        if show_axes is not None:
            self._props["showAxes"] = bool(show_axes)
        if show_planes is not None:
            self._props["showPlanes"] = bool(show_planes)
        if camera_mode is not None:
            self._props["cameraMode"] = camera_mode

        if _is_data_ref(data):
            ai = _artifact_info_of(data)
            hash_ = ai.hash
            meta = _parse_meta(ai.metadata)
            self._data: dict[str, Any] = {
                "kind": "npz",
                "hash": hash_,
                "objectType": "pointcloud",
                "meta": meta,
            }
            if data_mode == "endpoint":
                self._source = data
            else:
                raw = data.run.artifact_bytes(data.tag, step=data.step)
                self._store = {
                    hash_: {
                        "mime": "application/octet-stream",
                        "b64": _base64.b64encode(raw).decode("ascii"),
                    }
                }
            return

        # Raw arrays — LOCAL only (no server reference). The tracking handler's
        # serialize() gives the exact `.npy`/`.npz` bytes + meta the viewer's
        # parseNpy/parseNpz already consume, so parse-correctness is free.
        if data_mode == "endpoint":
            raise ValueError(
                "cp.PointCloud(raw, data_mode='endpoint') is unsupported: raw "
                "arrays have no server reference. Use data_mode='local'."
            )
        raw, meta = _resolver("serialize_pointcloud")(data, values)
        hash_ = _content_hash(raw)
        self._store = {
            hash_: {
                "mime": "application/octet-stream",
                "b64": _base64.b64encode(raw).decode("ascii"),
            }
        }
        self._data = {
            "kind": "npz",
            "hash": hash_,
            "objectType": "pointcloud",
            "meta": meta,
        }
        self._data_mode = "local"

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "plot",
            "renderer": "pointcloud",
            "data": self._data,
        }
        if self._props:
            node["props"] = dict(self._props)
        return node

    def _collect_store(self) -> dict[str, dict[str, str]]:
        return dict(self._store)


class Mesh(Component):
    """A 3D triangle-mesh plot (mounts the pure mesh viewer, key ``mesh`` —
    carried by the three.js addon).

    Raw data is the primary input:

    * ``cp.Mesh(vertices, faces)`` — ``vertices`` an ``(N, 3)`` array,
      ``faces`` an ``(M, 3)`` index array; baked self-contained (LOCAL);
    * ``cp.Mesh(run[tag])`` — a tracked ``mesh`` artifact; LOCAL bakes the
      ``.npz`` bytes, ENDPOINT emits by reference.

    ``values`` attaches per-vertex scalar properties (a single array or a
    ``{name: array}`` dict), ``colors`` an ``(N, 3)`` vertex-color array,
    ``face_colors`` an ``(M, 3)`` or ``(M, 4)`` per-FACE (per-triangle) color
    array (``M == n_faces``; each triangle renders one flat color),
    ``normals`` an ``(N, 3)`` normal array (raw input only). Optional view
    overrides: ``color_mode``
    (``"solid"``/``"vertex-colors"``/``"face-colors"``/``"values"``),
    ``shading`` (``"smooth"``/``"flat"``), ``wireframe``, ``double_sided``,
    ``background`` (``"dark"``/``"light"``), ``show_axes``.

    Color precedence when ``color_mode`` is left unset: ``face_colors`` >
    ``colors`` (per-vertex) > uniform solid. Passing ``face_colors`` therefore
    defaults ``color_mode`` to ``"face-colors"`` (explicitly setting
    ``color_mode`` always wins).
    """

    _label = "mesh"
    _height = 400

    def __init__(
        self,
        vertices: Any,
        faces: Any = None,
        *,
        values: Any = None,
        colors: Any = None,
        face_colors: Any = None,
        normals: Any = None,
        data_mode: str = "local",
        color_mode: str | None = None,
        shading: str | None = None,
        wireframe: bool | None = None,
        double_sided: bool | None = None,
        background: str | None = None,
        show_axes: bool | None = None,
        show_planes: bool | None = None,
        camera_mode: str | None = None,
    ) -> None:
        from .shapers import (
            _artifact_info_of,
            _check_data_mode,
            _content_hash,
            _parse_meta,
        )

        _check_data_mode(data_mode)
        self._source: Any = None
        self._store: dict[str, dict[str, str]] = {}
        self._data_mode = data_mode

        self._props: dict[str, Any] = {}
        if color_mode is not None:
            self._props["colorMode"] = color_mode
        elif face_colors is not None:
            # Precedence default: face_colors > vertex colors > solid. An
            # explicit color_mode (handled above) always wins.
            self._props["colorMode"] = "face-colors"
        if shading is not None:
            self._props["shading"] = shading
        if wireframe is not None:
            self._props["wireframe"] = bool(wireframe)
        if double_sided is not None:
            self._props["doubleSided"] = bool(double_sided)
        if background is not None:
            self._props["background"] = background
        if show_axes is not None:
            self._props["showAxes"] = bool(show_axes)
        if show_planes is not None:
            self._props["showPlanes"] = bool(show_planes)
        if camera_mode is not None:
            self._props["cameraMode"] = camera_mode

        if _is_data_ref(vertices):
            ai = _artifact_info_of(vertices)
            hash_ = ai.hash
            meta = _parse_meta(ai.metadata)
            self._data: dict[str, Any] = {
                "kind": "npz",
                "hash": hash_,
                "objectType": "mesh",
                "meta": meta,
            }
            if data_mode == "endpoint":
                self._source = vertices
            else:
                raw = vertices.run.artifact_bytes(vertices.tag, step=vertices.step)
                self._store = {
                    hash_: {
                        "mime": "application/octet-stream",
                        "b64": _base64.b64encode(raw).decode("ascii"),
                    }
                }
            return

        # Raw arrays — LOCAL only. `MeshHandler().serialize` gives the exact
        # `.npz` bytes + meta the viewer's parseNpz already consumes.
        if data_mode == "endpoint":
            raise ValueError(
                "cp.Mesh(raw, data_mode='endpoint') is unsupported: raw arrays "
                "have no server reference. Use data_mode='local'."
            )
        raw, meta = _resolver("serialize_mesh")(
            {
                "vertices": vertices,
                "faces": faces,
                "values": values,
                "colors": colors,
                "face_colors": face_colors,
                "normals": normals,
            }
        )
        hash_ = _content_hash(raw)
        self._store = {
            hash_: {
                "mime": "application/octet-stream",
                "b64": _base64.b64encode(raw).decode("ascii"),
            }
        }
        self._data = {
            "kind": "npz",
            "hash": hash_,
            "objectType": "mesh",
            "meta": meta,
        }
        self._data_mode = "local"

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "plot",
            "renderer": "mesh",
            "data": self._data,
        }
        if self._props:
            node["props"] = dict(self._props)
        return node

    def _collect_store(self) -> dict[str, dict[str, str]]:
        return dict(self._store)


class Volume(Component):
    """A 3D scalar-volume plot (mounts the pure raymarch viewer, key
    ``volume`` — carried by the three.js addon).

    Raw data is the primary input:

    * ``cp.Volume(grid)`` — a ``(D, H, W)`` scalar array; baked self-contained
      (LOCAL);
    * ``cp.Volume(run[tag])`` — a tracked ``volume`` artifact; LOCAL bakes the
      ``.npz`` bytes, ENDPOINT emits by reference.

    ``spacing`` / ``origin`` are optional 3-element voxel spacing / world
    origin (raw input only). Optional view overrides: ``render_mode``
    (``"mip"``/…), ``isovalue``, ``colormap``, ``steps``, ``background``,
    ``show_axes``.
    """

    _label = "volume"
    _height = 400

    def __init__(
        self,
        grid: Any,
        *,
        spacing: Any = None,
        origin: Any = None,
        data_mode: str = "local",
        render_mode: str | None = None,
        isovalue: float | None = None,
        colormap: str | None = None,
        steps: int | None = None,
        background: str | None = None,
        show_axes: bool | None = None,
        show_planes: bool | None = None,
        camera_mode: str | None = None,
    ) -> None:
        from .shapers import (
            _artifact_info_of,
            _check_data_mode,
            _content_hash,
            _parse_meta,
        )

        _check_data_mode(data_mode)
        self._source: Any = None
        self._store: dict[str, dict[str, str]] = {}
        self._data_mode = data_mode

        self._props: dict[str, Any] = {}
        if render_mode is not None:
            self._props["mode"] = render_mode
        if isovalue is not None:
            self._props["isovalue"] = float(isovalue)
        if colormap is not None:
            self._props["colormap"] = colormap
        if steps is not None:
            self._props["steps"] = int(steps)
        if background is not None:
            self._props["background"] = background
        if show_axes is not None:
            self._props["showAxes"] = bool(show_axes)
        if show_planes is not None:
            self._props["showPlanes"] = bool(show_planes)
        if camera_mode is not None:
            self._props["cameraMode"] = camera_mode

        if _is_data_ref(grid):
            ai = _artifact_info_of(grid)
            hash_ = ai.hash
            meta = _parse_meta(ai.metadata)
            self._data: dict[str, Any] = {
                "kind": "npz",
                "hash": hash_,
                "objectType": "volume",
                "meta": meta,
            }
            if data_mode == "endpoint":
                self._source = grid
            else:
                raw = grid.run.artifact_bytes(grid.tag, step=grid.step)
                self._store = {
                    hash_: {
                        "mime": "application/octet-stream",
                        "b64": _base64.b64encode(raw).decode("ascii"),
                    }
                }
            return

        # Raw grid — LOCAL only. `VolumeHandler().serialize` gives the exact
        # `.npz` bytes + meta the viewer's parseNpz already consumes.
        if data_mode == "endpoint":
            raise ValueError(
                "cp.Volume(raw, data_mode='endpoint') is unsupported: raw arrays "
                "have no server reference. Use data_mode='local'."
            )
        raw, meta = _resolver("serialize_volume")(grid, spacing, origin)
        hash_ = _content_hash(raw)
        self._store = {
            hash_: {
                "mime": "application/octet-stream",
                "b64": _base64.b64encode(raw).decode("ascii"),
            }
        }
        self._data = {
            "kind": "npz",
            "hash": hash_,
            "objectType": "volume",
            "meta": meta,
        }
        self._data_mode = "local"

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "plot",
            "renderer": "volume",
            "data": self._data,
        }
        if self._props:
            node["props"] = dict(self._props)
        return node

    def _collect_store(self) -> dict[str, dict[str, str]]:
        return dict(self._store)


class Boxes(Component):
    """A 3D axis-aligned-boxes plot (mounts the pure boxes viewer, key
    ``boxes3d`` — carried by the three.js addon).

    Raw data is the primary input:

    * ``cp.Boxes(mins, maxs)`` — two ``(N, 3)`` corner arrays; baked
      self-contained (LOCAL);
    * ``cp.Boxes(run[tag])`` — a tracked ``boxes3d`` artifact; LOCAL bakes the
      ``.npz`` bytes, ENDPOINT emits by reference.

    ``depth`` attaches a per-box integer depth (octree/BVH level), ``values``
    per-box scalar properties (raw input only). ``kind`` labels the structure
    (``"boxes"``/``"octree"``/``"bvh"``). Optional view overrides: ``color_mode``
    (``"depth"``/``"value"``), ``background`` (``"dark"``/``"light"``),
    ``show_axes``.
    """

    _label = "boxes"
    _height = 400

    def __init__(
        self,
        mins: Any,
        maxs: Any = None,
        *,
        depth: Any = None,
        values: Any = None,
        kind: str = "boxes",
        data_mode: str = "local",
        color_mode: str | None = None,
        background: str | None = None,
        show_axes: bool | None = None,
        show_planes: bool | None = None,
        camera_mode: str | None = None,
    ) -> None:
        from .shapers import (
            _artifact_info_of,
            _check_data_mode,
            _content_hash,
            _parse_meta,
        )

        _check_data_mode(data_mode)
        self._source: Any = None
        self._store: dict[str, dict[str, str]] = {}
        self._data_mode = data_mode

        self._props: dict[str, Any] = {}
        if color_mode is not None:
            self._props["colorMode"] = color_mode
        if background is not None:
            self._props["background"] = background
        if show_axes is not None:
            self._props["showAxes"] = bool(show_axes)
        if show_planes is not None:
            self._props["showPlanes"] = bool(show_planes)
        if camera_mode is not None:
            self._props["cameraMode"] = camera_mode

        if _is_data_ref(mins):
            ai = _artifact_info_of(mins)
            hash_ = ai.hash
            meta = _parse_meta(ai.metadata)
            self._data: dict[str, Any] = {
                "kind": "npz",
                "hash": hash_,
                "objectType": "boxes3d",
                "meta": meta,
            }
            if data_mode == "endpoint":
                self._source = mins
            else:
                raw = mins.run.artifact_bytes(mins.tag, step=mins.step)
                self._store = {
                    hash_: {
                        "mime": "application/octet-stream",
                        "b64": _base64.b64encode(raw).decode("ascii"),
                    }
                }
            return

        # Raw arrays — LOCAL only. `Boxes3DHandler().serialize` gives the exact
        # `.npz` bytes + meta the viewer's parseNpz already consumes.
        if data_mode == "endpoint":
            raise ValueError(
                "cp.Boxes(raw, data_mode='endpoint') is unsupported: raw arrays "
                "have no server reference. Use data_mode='local'."
            )
        raw, meta = _resolver("serialize_boxes3d")(
            {"mins": mins, "maxs": maxs, "depth": depth, "values": values},
            kind,
        )
        hash_ = _content_hash(raw)
        self._store = {
            hash_: {
                "mime": "application/octet-stream",
                "b64": _base64.b64encode(raw).decode("ascii"),
            }
        }
        self._data = {
            "kind": "npz",
            "hash": hash_,
            "objectType": "boxes3d",
            "meta": meta,
        }
        self._data_mode = "local"

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "plot",
            "renderer": "boxes3d",
            "data": self._data,
        }
        if self._props:
            node["props"] = dict(self._props)
        return node

    def _collect_store(self) -> dict[str, dict[str, str]]:
        return dict(self._store)


# ---------------------------------------------------------------------------
# Containers — cp.Grid / cp.Compare. (Stage B)
# ---------------------------------------------------------------------------


def _as_component(obj: Any) -> Component:
    if isinstance(obj, Component):
        return obj
    raise TypeError(
        f"cp.Grid/Compare children must be cairn.plot Components "
        f"(cp.Line/Scatter/Bar/Histogram/Heatmap/ParallelCoordinates/Image/"
        f"PointCloud/Mesh/Volume/Boxes/Figure/Table/Compare/Grid), got "
        f"{type(obj).__name__}"
    )


class Grid(Component):
    """Subplots in a CSS grid (plan G2.3).

    ``children`` is either a 1-D list ``[a, b, c]`` (auto-flow into one row of
    ``cols`` columns, default ``len(children)``) OR a 2-D nested list
    ``[[a, b], [c, d]]`` (flattened row-major; ``cols = len(row0)``; ragged rows
    raise). ``col_widths``/``row_heights`` entries: number → ``Nfr``, string →
    verbatim CSS. ``shared`` is a dict or :class:`Shared`."""

    _label = "grid"

    def __init__(
        self,
        children: Sequence[Any],
        *,
        cols: int | None = None,
        col_widths: Sequence[float | str] | None = None,
        row_heights: Sequence[float | str] | None = None,
        gap: float | str | None = None,
        shared: Any = None,
    ) -> None:
        children = list(children)
        if not children:
            raise ValueError("cp.Grid(...) requires at least one child")

        is_2d = all(isinstance(row, (list, tuple)) for row in children)
        if is_2d:
            nrows = len(children)
            ncols = len(children[0])
            if ncols == 0:
                raise ValueError("cp.Grid(...) 2-D rows must be non-empty")
            for i, row in enumerate(children):
                if len(row) != ncols:
                    raise ValueError(
                        "cp.Grid(...) ragged rows: row 0 has "
                        f"{ncols} cells but row {i} has {len(row)}. Every row "
                        "in a 2-D grid must have the same number of columns."
                    )
            flat = [_as_component(c) for row in children for c in row]
            derived_cols = ncols
        else:
            if any(isinstance(row, (list, tuple)) for row in children):
                raise TypeError(
                    "cp.Grid(...) children must be either all 1-D (a flat list "
                    "of components) or all 2-D (a list of row-lists) — not mixed."
                )
            flat = [_as_component(c) for c in children]
            derived_cols = len(flat)

        self._children = flat
        self._cols = cols if cols is not None else derived_cols
        # m1: validate col_widths/row_heights against the EFFECTIVE grid shape
        # (works for both 1-D auto-flow and 2-D grids). Effective columns is the
        # resolved `cols`; effective rows is how many rows the children fill.
        eff_cols = self._cols
        eff_rows = -(-len(flat) // eff_cols) if eff_cols else 0  # ceil-div
        if col_widths is not None and len(list(col_widths)) != eff_cols:
            raise ValueError(
                f"cp.Grid(col_widths=...) must have one entry per column "
                f"({eff_cols}); got {len(list(col_widths))}."
            )
        if row_heights is not None and len(list(row_heights)) != eff_rows:
            raise ValueError(
                f"cp.Grid(row_heights=...) must have one entry per row "
                f"({eff_rows}); got {len(list(row_heights))}."
            )
        self._col_widths = list(col_widths) if col_widths is not None else None
        self._row_heights = list(row_heights) if row_heights is not None else None
        self._gap = gap
        self._shared, self._shared_store = _normalize_shared(shared)

    def to_node(self) -> dict[str, Any]:
        node: dict[str, Any] = {
            "kind": "grid",
            "children": [c.to_node() for c in self._children],
        }
        if self._cols is not None:
            node["cols"] = self._cols
        if self._col_widths is not None:
            node["colWidths"] = self._col_widths
        if self._row_heights is not None:
            node["rowHeights"] = self._row_heights
        if self._gap is not None:
            node["gap"] = self._gap
        if self._shared is not None:
            node["shared"] = self._shared
        return node

    def _collect_store(self) -> dict[str, dict[str, str]]:
        store: dict[str, dict[str, str]] = {}
        for child in self._children:
            store.update(child._collect_store())
        store.update(self._shared_store)
        return store


class Compare(Component):
    """Compare two image-like leaves (plan G2.4).

    ``mode="side"`` lowers to a 2-cell ``cp.Grid([a, b], cols=2)``. ``mode`` in
    ``{split, blend, diff}`` emits a ``compare`` node compositing ``a`` (the
    reference, ``baselineIndex=0``) and ``b`` into one pane. Split/blend/diff
    require ``a``/``b`` be image-like (``cp.Image`` / an image ``run[tag]``)."""

    _label = "compare"

    def __init__(
        self,
        a: Any,
        b: Any,
        *,
        mode: str = "side",
        baseline: int = 0,
        split_position: float | None = None,
        blend_alpha: float | None = None,
        diff_submode: str | None = None,
        colormap: str | None = None,
        exposure: float | None = None,
        gamma: float | None = None,
        brightness: float | None = None,
        contrast: float | None = None,
        offset: float | None = None,
        flip_sign: bool | None = None,
        interpolation: str | None = None,
        show_axes: bool | None = None,
        pixel_value_notation: str | None = None,
        props: dict[str, Any] | None = None,
    ) -> None:
        self._mode = mode
        if baseline not in (0, 1):
            raise ValueError(f"cp.Compare(baseline=...) must be 0 or 1, got {baseline!r}")
        self._baseline = baseline
        # Typed kwargs → the compare node's `props` (interpolation/colormap/diff
        # submode/split/blend/processing…); a hand-passed `props` dict merges on
        # top (escape hatch).
        built = _image_display_props(
            exposure=exposure, gamma=gamma, brightness=brightness,
            contrast=contrast, offset=offset, flip_sign=flip_sign,
            colormap=colormap, interpolation=interpolation, show_axes=show_axes,
            pixel_value_notation=pixel_value_notation,
        )
        if split_position is not None:
            built["splitPosition"] = float(split_position)
        if blend_alpha is not None:
            built["blendAlpha"] = float(blend_alpha)
        if diff_submode is not None:
            built["diffSubmode"] = diff_submode
        if props:
            built.update(props)
        self._props = built or None

        if mode == "side":
            self._delegate: Grid | None = Grid([_as_component(a), _as_component(b)], cols=2)
            self._a = self._b = None
            return
        if mode not in _COMPARE_NODE_MODES:
            raise ValueError(
                f"cp.Compare(mode=...) must be one of ('side',) + "
                f"{_COMPARE_NODE_MODES!r}, got {mode!r}"
            )
        self._delegate = None
        self._a = _as_component(a)
        self._b = _as_component(b)
        if self._a._leaf_dataspec() is None or self._b._leaf_dataspec() is None:
            raise TypeError(
                f"cp.Compare(a, b, mode={mode!r}) requires image-like leaves "
                "(cp.Image or an image run[tag]); at least one argument is not "
                "an image. Use mode='side' to place arbitrary cells side by side."
            )

    def to_node(self) -> dict[str, Any]:
        if self._delegate is not None:
            return self._delegate.to_node()
        node: dict[str, Any] = {
            "kind": "compare",
            "mode": self._mode,
            "a": self._a._leaf_dataspec(),
            "b": self._b._leaf_dataspec(),
            "baselineIndex": self._baseline,
        }
        if self._props:
            node["props"] = self._props
        return node

    def _collect_store(self) -> dict[str, dict[str, str]]:
        if self._delegate is not None:
            return self._delegate._collect_store()
        store: dict[str, dict[str, str]] = {}
        store.update(self._a._collect_store())
        store.update(self._b._collect_store())
        return store
