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

from .reader import DataRef

log = logging.getLogger(__name__)

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
        from ..plot import _endpoint_server_of

        return _endpoint_server_of(getattr(self, "_source", None))

    def _build_element(self):
        """Wrap this component into a :class:`~cairn.sdk.elements.PlotElement`.

        A leaf lowers to the flat ``PlotSpec`` (legacy-flat render path);
        a container lowers to the recursive ``PlotDescriptorSpec`` tree."""
        from .card_spec import PlotDescriptorSpec, PlotSpec
        from .elements import PlotElement

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


class Scalar(Component):
    """A single scalar-sequence plot (mounts the pure ``ScalarPlot`` renderer).

    ``data``: a ``run[tag]`` handle (a tracked scalar sequence) OR raw numeric
    values plotted against their index. Raw data is always ``local``."""

    _label = "scalar"

    def __init__(self, data: Any, *, data_mode: str = "local") -> None:
        from ..plot import (
            _check_data_mode,
            _scalar_series_from_raw,
            _scalar_series_from_ref,
        )

        _check_data_mode(data_mode)
        if isinstance(data, DataRef):
            series = _scalar_series_from_ref(data)
            self._source: Any = data
            self._data_mode = data_mode
        else:
            series = _scalar_series_from_raw(data)
            self._source = None
            self._data_mode = "local"
        self._inline = {"series": [series]}

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "scalar",
            "data": {"kind": "inline", "props": self._inline},
        }


class Figure(Component):
    """A ``figure`` (Plotly) plot. ``data``: a ``run[tag]`` figure artifact OR a
    plotly ``Figure``. Raw figures are always ``local``."""

    _label = "figure"

    def __init__(self, data: Any, *, data_mode: str = "local") -> None:
        from ..plot import (
            _check_data_mode,
            _figure_json_from_plotly,
            _figure_json_from_ref,
        )

        _check_data_mode(data_mode)
        if isinstance(data, DataRef):
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
        from ..plot import (
            _check_data_mode,
            _table_json_from_raw,
            _table_json_from_ref,
        )

        _check_data_mode(data_mode)
        if isinstance(data, DataRef):
            tbl = _table_json_from_ref(data)
            self._source: Any = data
            self._data_mode = data_mode
        else:
            tbl = _table_json_from_raw(data)
            self._source = None
            self._data_mode = "local"
        self._inline = {"table": tbl}

    def to_node(self) -> dict[str, Any]:
        return {
            "kind": "plot",
            "renderer": "table",
            "data": {"kind": "inline", "props": self._inline},
        }


class Image(Component):
    """A single-view ``image`` plot (mounts the pure ``ImagePane`` renderer).

    ``data`` accepts:

    * a ``run[tag]`` image artifact — LOCAL bakes the bytes into the
      content-addressed store; ENDPOINT emits an ``image`` DataSpec by reference;
    * a raw image (``PIL.Image`` / numpy array / PNG-JPEG ``bytes``) — baked
      LOCAL only (no server reference);
    * a raw URL ``str`` — emitted verbatim as a ``url`` DataSpec.
    """

    _label = "image"

    def __init__(self, data: Any, *, data_mode: str = "local") -> None:
        import json as _json

        from ..plot import (
            _artifact_info_of,
            _check_data_mode,
            _content_hash,
            _encode_image_raw,
        )

        _check_data_mode(data_mode)
        self._source: Any = None
        self._store: dict[str, dict[str, str]] = {}
        self._data_mode = data_mode

        if isinstance(data, DataRef):
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
        return {"kind": "plot", "renderer": "image", "data": self._data}

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
        f"(cp.Scalar/Image/Figure/Table/Compare/Grid), got {type(obj).__name__}"
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
            if row_heights is not None and len(list(row_heights)) != nrows:
                raise ValueError(
                    f"cp.Grid(row_heights=...) must have one entry per row "
                    f"({nrows}); got {len(list(row_heights))}."
                )
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

    def __init__(self, a: Any, b: Any, *, mode: str = "side", props: dict[str, Any] | None = None) -> None:
        self._mode = mode
        self._props = props
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
            "baselineIndex": 0,
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
