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
    for name in ("Scalar", "Figure", "Table", "Image", "Grid", "Compare"):
        assert hasattr(cp, name), f"cp.{name} not exported"
