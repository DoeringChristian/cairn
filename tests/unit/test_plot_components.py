"""G2: the composable ``cairn.plot`` Component API (``cp.Scalar``/``Image``/
``Figure``/``Table``/``Grid``/``Compare``).

Stage A (leaves) + Stage B (grid/compare + lowercase aliases). Each test drives
the real display path (``_repr_html_``) and round-trips the emitted descriptor
back through the pydantic ``PlotSpec``/``PlotDescriptorSpec`` — the same
anti-drift gate the flat emit tests use.
"""

from __future__ import annotations

import json
import re

import pytest

import cairn.plot as cp
from cairn.sdk.card_spec import PlotDescriptorSpec, PlotSpec

# A 1x1 opaque PNG.
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da6360000002000154a24f5f0000000049454e44ae426082"
)
# A different 1x1 PNG (distinct bytes → distinct content hash).
_PNG2 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753"
    "de0000000c4944415478da6364f8cf00000600030156d9a2df0000000049454e44ae426082"
)


def _unescape(s: str) -> str:
    return s.replace("\\u003c", "<").replace("\\u003e", ">").replace("\\u0026", "&")


def _descriptor_from_html(html: str) -> dict:
    m = re.search(
        r'application/cairn-plot\+json" id="[^"]+">(.*?)</script>', html, re.S
    )
    assert m, "no descriptor script in emitted HTML"
    return json.loads(_unescape(m.group(1)))


def _mount_divs(html: str) -> list[str]:
    return re.findall(r'class="cairn-plot-mount"', html)


# ---------------------------------------------------------------------------
# Stage A — leaves.
# ---------------------------------------------------------------------------


def test_scalar_leaf_emits_one_mount_and_flat_descriptor():
    html = cp.Scalar([0.9, 0.5, 0.3])._repr_html_()
    assert len(_mount_divs(html)) == 1
    desc = _descriptor_from_html(html)
    # A standalone leaf renders through the legacy-flat path.
    spec = PlotSpec.model_validate(desc)
    assert spec.renderer == "scalar"
    assert desc["data"]["props"]["series"][0]["points"][0] == {"x": 0, "y": 0.9}


def test_scalar_leaf_carries_no_plotly():
    html = cp.Scalar([1, 2, 3])._repr_html_()
    assert "window.__cairnPlotBundleLoaded" in html
    assert "window.__cairnPlotFigureLoaded" not in html
    assert "plotly" not in html.lower()


@pytest.mark.media
def test_figure_leaf_carries_both_bundle_guards():
    fig = cp.roc_curve([0, 1, 1, 0], [0.1, 0.9, 0.8, 0.2])
    html = cp.Figure(fig)._repr_html_()
    assert "window.__cairnPlotBundleLoaded" in html
    assert "window.__cairnPlotFigureLoaded" in html
    assert "plotly" in html.lower()
    desc = _descriptor_from_html(html)
    assert PlotSpec.model_validate(desc).renderer == "figure"


def test_table_leaf_round_trips():
    html = cp.Table([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}])._repr_html_()
    assert len(_mount_divs(html)) == 1
    desc = _descriptor_from_html(html)
    assert PlotSpec.model_validate(desc).renderer == "table"


def test_image_leaf_bakes_store_blob():
    img = cp.Image(_PNG)
    html = img._repr_html_()
    assert "application/cairn-plot-store+json" in html
    desc = _descriptor_from_html(html)
    assert desc["data"]["kind"] == "image"
    h = desc["data"]["hash"]
    assert h.startswith("sha256:")
    store = img._collect_store()
    assert h in store and store[h]["mime"] == "image/png"


def test_image_url_leaf_emits_url_dataspec():
    img = cp.Image("https://example.com/x.png")
    node = img.to_node()
    assert node["data"] == {"kind": "url", "src": "https://example.com/x.png"}
    assert img._collect_store() == {}


def test_leaf_repr_html_never_raises_on_bad_data():
    # A figure leaf built from a non-figure raises at build; the display hook
    # must degrade to a visible message rather than propagate.
    class _Bad(cp.Figure):
        def __init__(self):  # skip shaping
            self._inline = {"figure": {}}
            self._data_mode = "local"

        def to_node(self):
            raise RuntimeError("boom")

    html = _Bad()._repr_html_()
    assert "could not render" in html


# ---------------------------------------------------------------------------
# Stage B — Grid + Compare.
# ---------------------------------------------------------------------------


def test_grid_1d_defaults_cols_to_child_count():
    node = cp.Grid([cp.Scalar([1, 2]), cp.Image(_PNG), cp.Image(_PNG2)]).to_node()
    assert node["kind"] == "grid"
    assert node["cols"] == 3
    assert len(node["children"]) == 3


def test_grid_2d_flattens_row_major_and_sets_cols():
    node = cp.Grid(
        [[cp.Scalar([1]), cp.Image(_PNG)], [cp.Image(_PNG2), cp.Scalar([2])]]
    ).to_node()
    assert node["cols"] == 2
    assert [c["renderer"] for c in node["children"]] == [
        "scalar",
        "image",
        "image",
        "scalar",
    ]


def test_grid_2d_ragged_rows_raise():
    with pytest.raises(ValueError, match="ragged"):
        cp.Grid([[cp.Scalar([1]), cp.Image(_PNG)], [cp.Scalar([2])]])


def test_grid_recursive_descriptor_round_trips_and_one_mount():
    grid = cp.Grid(
        [
            [cp.Scalar([0.1, 0.2]), cp.Image(_PNG)],
            [cp.Compare(cp.Image(_PNG), cp.Image(_PNG2), mode="split"), cp.Table([{"a": 1}])],
        ],
        col_widths=[0.6, 0.4],
        row_heights=[1, 1],
        gap=10,
        shared={"colorbar": True},
    )
    html = grid._repr_html_()
    assert len(_mount_divs(html)) == 1, "a grid emits exactly ONE mount div"
    desc = _descriptor_from_html(html)
    # The whole tree round-trips through the recursive pydantic mirror.
    spec = PlotDescriptorSpec.model_validate(desc)
    assert spec.model_dump(exclude_none=True, mode="json") == desc
    assert desc["root"]["kind"] == "grid"
    assert desc["root"]["colWidths"] == [0.6, 0.4]
    assert desc["root"]["shared"] == {"colorbar": True}
    # The nested compare node is present with baselineIndex.
    compare = desc["root"]["children"][2]
    assert compare["kind"] == "compare" and compare["baselineIndex"] == 0


def test_grid_merged_store_dedups_shared_reference_blob():
    # Two cells reference the SAME image bytes → one store entry (dedup by hash).
    grid = cp.Grid([cp.Image(_PNG), cp.Image(_PNG)])
    store = grid._collect_store()
    assert len(store) == 1
    # A distinct blob is kept separately.
    grid2 = cp.Grid([cp.Image(_PNG), cp.Image(_PNG2)])
    assert len(grid2._collect_store()) == 2


def test_compare_side_lowers_to_two_col_grid():
    node = cp.Compare(cp.Image(_PNG), cp.Image(_PNG2), mode="side").to_node()
    assert node["kind"] == "grid"
    assert node["cols"] == 2
    assert len(node["children"]) == 2


def test_compare_diff_emits_compare_node_with_baseline():
    node = cp.Compare(cp.Image(_PNG), cp.Image(_PNG2), mode="diff").to_node()
    assert node["kind"] == "compare"
    assert node["mode"] == "diff"
    assert node["baselineIndex"] == 0
    assert node["a"]["kind"] == "image" and node["b"]["kind"] == "image"


def test_compare_split_requires_image_like_leaves():
    with pytest.raises(TypeError, match="image-like"):
        cp.Compare(cp.Scalar([1, 2]), cp.Image(_PNG), mode="diff")


def test_compare_store_merges_up():
    store = cp.Compare(cp.Image(_PNG), cp.Image(_PNG2), mode="blend")._collect_store()
    assert len(store) == 2


# ---------------------------------------------------------------------------
# Lowercase aliases — return a PlotElement, render identically.
# ---------------------------------------------------------------------------


def test_lowercase_scalar_still_returns_plot_element():
    from cairn.sdk.elements import PlotElement

    el = cp.scalar([1, 2, 3])
    assert isinstance(el, PlotElement)
    desc = _descriptor_from_html(el._repr_html_())
    assert PlotSpec.model_validate(desc).renderer == "scalar"


def test_lowercase_image_still_returns_plot_element_with_store():
    from cairn.sdk.elements import PlotElement

    el = cp.image(_PNG)
    assert isinstance(el, PlotElement)
    assert "application/cairn-plot-store+json" in el._repr_html_()


def test_capitalized_names_exported():
    for name in (
        "Line",
        "Scatter",
        "Bar",
        "Histogram",
        "Heatmap",
        "ParallelCoordinates",
        "Scalar",
        "Figure",
        "Table",
        "Image",
        "Grid",
        "Compare",
    ):
        assert hasattr(cp, name), f"cp.{name} not exported"


# ---------------------------------------------------------------------------
# G2 revision — general plotting leaves (Line/Scatter/Bar/Histogram/Heatmap/
# ParallelCoordinates). Each raw-data constructor drives the real display path
# and round-trips through the flat PlotSpec (byte-compatible legacy render).
# ---------------------------------------------------------------------------


def _leaf_desc(component) -> dict:
    html = component._repr_html_()
    assert len(_mount_divs(html)) == 1
    desc = _descriptor_from_html(html)
    PlotSpec.model_validate(desc)  # schema-valid round-trip
    return desc


def test_scalar_is_deprecated_alias_of_line():
    assert cp.Scalar is cp.Line


def test_line_raw_single_series_matches_index():
    desc = _leaf_desc(cp.Line([0.9, 0.5, 0.3]))
    assert desc["renderer"] == "scalar"
    series = desc["data"]["props"]["series"]
    assert len(series) == 1
    assert series[0]["points"][0] == {"x": 0, "y": 0.9}


def test_line_multi_series_from_dict():
    desc = _leaf_desc(cp.Line({"loss": [0.9, 0.6], "val": [1.0, 0.7]}))
    series = desc["data"]["props"]["series"]
    assert [s["key"] for s in series] == ["loss", "val"]
    # Distinct colors per series (categorical palette).
    assert series[0]["color"] != series[1]["color"]


def test_line_explicit_x_axis():
    desc = _leaf_desc(cp.Line([2.0, 4.0], x=[10, 20]))
    pts = desc["data"]["props"]["series"][0]["points"]
    assert [p["x"] for p in pts] == [10.0, 20.0]


def test_line_2d_array_one_series_per_row():
    desc = _leaf_desc(cp.Line([[1, 2, 3], [4, 5, 6]]))
    series = desc["data"]["props"]["series"]
    assert [s["key"] for s in series] == ["series_0", "series_1"]


def test_scatter_raw_shapes_points_and_config():
    desc = _leaf_desc(
        cp.Scatter([1, 2, 3], [4, 5, 6], color=[0, 1, 2], x_label="lr", y_log=True)
    )
    assert desc["renderer"] == "scatter"
    assert desc["props"] == {"xLabel": "lr", "yLog": True}
    pt = desc["data"]["props"]["points"][0]
    assert pt == {"id": "0", "x": 1.0, "y": 4.0, "color": 0.0}


def test_scatter_length_mismatch_raises():
    with pytest.raises(ValueError, match="same length"):
        cp.Scatter([1, 2, 3], [4, 5])


def test_bar_raw_shapes_bardatum():
    desc = _leaf_desc(cp.Bar([3, 7, 5], labels=["a", "b", "c"], value_label="score"))
    assert desc["renderer"] == "bar"
    assert desc["props"] == {"valueLabel": "score"}
    assert desc["data"]["props"]["bars"][0] == {"id": "0", "label": "a", "value": 3.0}


def test_bar_labels_default_to_index():
    desc = _leaf_desc(cp.Bar([1, 2]))
    labels = [b["label"] for b in desc["data"]["props"]["bars"]]
    assert labels == ["0", "1"]


def test_histogram_from_samples_edges_is_counts_plus_one():
    desc = _leaf_desc(cp.Histogram([1, 1, 2, 3, 3, 3, 4, 5, 5], bins=6))
    assert desc["renderer"] == "histogram"
    assert desc["props"]["view"] == "bars"
    counts = desc["data"]["props"]["counts"]
    edges = desc["data"]["props"]["edges"]
    assert len(edges) == len(counts) + 1
    assert sum(counts) == 9


def test_histogram_precomputed_counts_edges():
    desc = _leaf_desc(cp.Histogram(counts=[1, 2, 3], edges=[0, 1, 2, 3]))
    assert desc["data"]["props"]["counts"] == [1.0, 2.0, 3.0]


def test_histogram_precomputed_bad_edges_raises():
    with pytest.raises(ValueError, match="len\\(counts\\)\\+1"):
        cp.Histogram(counts=[1, 2, 3], edges=[0, 1, 2])


def test_heatmap_raw_matrix_and_colormap():
    desc = _leaf_desc(cp.Heatmap([[1, 2, 3], [4, 5, 6]], colormap="red-blue", zmin=0))
    assert desc["renderer"] == "heatmap"
    assert desc["props"]["colormap"] == "red-blue"
    assert desc["props"]["min"] == 0
    assert desc["data"]["props"]["matrix"] == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]


def test_heatmap_non_2d_raises():
    with pytest.raises(ValueError, match="2-D"):
        cp.Heatmap([1, 2, 3])


def test_parallel_numeric_and_categorical_columns():
    desc = _leaf_desc(
        cp.ParallelCoordinates(
            [
                {"label": "lr", "values": [0.1, 0.2, 0.3]},
                {"label": "opt", "values": ["sgd", "adam", "sgd"]},
                {"label": "acc", "values": [0.8, 0.9, 0.85]},
            ]
        )
    )
    assert desc["renderer"] == "parallel"
    props = desc["data"]["props"]
    assert [c["key"] for c in props["columns"]] == ["lr", "opt", "acc"]
    domains = props["columnDomains"]
    assert domains[0]["isNumeric"] is True
    # Categorical column: not numeric, mapped to first-seen indices 0..n-1.
    assert domains[1]["isNumeric"] is False
    row0 = props["rows"][0]
    assert row0["values"] == [0.1, 0.0, 0.8]
    assert row0["raw"][1] == "sgd"


def test_parallel_from_dict():
    desc = _leaf_desc(cp.ParallelCoordinates({"a": [1, 2], "b": [3, 4]}))
    assert [c["key"] for c in desc["data"]["props"]["columns"]] == ["a", "b"]


def test_parallel_ragged_dimensions_raise():
    with pytest.raises(ValueError, match="same number of rows"):
        cp.ParallelCoordinates({"a": [1, 2, 3], "b": [4, 5]})


@pytest.mark.parametrize(
    "leaf",
    [
        cp.Line({"loss": [0.9, 0.6], "val": [1.0, 0.7]}),
        cp.Scatter([1, 2, 3], [3, 1, 2], color=[0, 1, 2]),
        cp.Bar([3, 7, 5], labels=["a", "b", "c"]),
        cp.Histogram([1, 1, 2, 3, 3, 4], bins=4),
        cp.Heatmap([[1, 2], [3, 4]]),
        cp.ParallelCoordinates({"lr": [0.1, 0.2], "acc": [0.8, 0.9]}),
    ],
)
def test_new_leaf_renders_inside_a_grid(leaf):
    grid = cp.Grid([leaf, cp.Image(_PNG)], cols=2)
    html = grid._repr_html_()
    assert len(_mount_divs(html)) == 1
    desc = _descriptor_from_html(html)
    spec = PlotDescriptorSpec.model_validate(desc)
    assert spec.model_dump(exclude_none=True, mode="json") == desc
    assert desc["root"]["kind"] == "grid"
    assert desc["root"]["children"][0]["kind"] == "plot"


# ---------------------------------------------------------------------------
# m1 — Grid col_widths / row_heights validation (1-D and 2-D).
# ---------------------------------------------------------------------------


def test_grid_col_widths_length_validated():
    with pytest.raises(ValueError, match="one entry per column"):
        cp.Grid([cp.Line([1]), cp.Line([2])], col_widths=[0.5, 0.3, 0.2])


def test_grid_row_heights_length_validated_1d():
    # 4 children over cols=2 → 2 effective rows; 3 row_heights is wrong.
    with pytest.raises(ValueError, match="one entry per row"):
        cp.Grid(
            [cp.Line([1]), cp.Line([2]), cp.Line([3]), cp.Line([4])],
            cols=2,
            row_heights=[1, 1, 1],
        )


def test_grid_valid_widths_and_heights_accepted():
    grid = cp.Grid(
        [[cp.Line([1]), cp.Image(_PNG)], [cp.Image(_PNG2), cp.Line([2])]],
        col_widths=[0.5, 0.5],
        row_heights=[1, 1],
    )
    assert grid.to_node()["colWidths"] == [0.5, 0.5]


# ---------------------------------------------------------------------------
# m2 — a Grid CONTAINING a Figure emits the Plotly figure addon; a pure-2D
# grid does NOT (the _descriptor_has_figure tree walk).
# ---------------------------------------------------------------------------


@pytest.mark.media
def test_grid_with_nested_figure_emits_figure_addon():
    fig = cp.roc_curve([0, 1, 1, 0], [0.1, 0.9, 0.8, 0.2])
    grid = cp.Grid([cp.Figure(fig), cp.Line([1, 2, 3])], cols=2)
    html = grid._repr_html_()
    assert "window.__cairnPlotFigureLoaded" in html
    assert "plotly" in html.lower()


def test_pure_2d_grid_carries_no_figure_addon():
    grid = cp.Grid([cp.Line([1, 2, 3]), cp.Bar([1, 2, 3])], cols=2)
    html = grid._repr_html_()
    assert "window.__cairnPlotFigureLoaded" not in html
    assert "plotly" not in html.lower()
