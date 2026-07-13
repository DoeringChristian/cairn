"""Smoke test: the standalone `cairn.plot` gallery example renders every type.

Drives ``examples/demo_cairn_plot.py`` headlessly (no browser, no server) so CI
catches any regression in the standalone self-contained emit across ALL plot
types at once — Line/Scatter/Bar/Histogram/Heatmap/ParallelCoordinates/Image/
Table/Figure/PointCloud + Grid + Compare.
"""

from __future__ import annotations

import importlib.util
import pathlib

import pytest

_EXAMPLE = (
    pathlib.Path(__file__).resolve().parents[2] / "examples" / "demo_cairn_plot.py"
)


def _load_example():
    spec = importlib.util.spec_from_file_location("demo_cairn_plot", _EXAMPLE)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_example_file_exists():
    assert _EXAMPLE.is_file(), f"missing example at {_EXAMPLE}"


def test_gallery_renders_every_type_self_contained():
    pytest.importorskip("plotly")  # the Figure section needs plotly (media extra)
    mod = _load_example()

    items = mod.build_gallery()
    titles = [t for t, _ in items]
    # All 2D + media + 3D + composition types present (11 core + Figure = 12).
    for expected in ("Line", "Scatter", "Bar", "Histogram", "Heatmap",
                     "ParallelCoordinates", "Image", "Table", "Figure",
                     "PointCloud", "Grid", "Compare"):
        assert any(t.startswith(expected) for t in titles), f"missing {expected}"
    # The HDR section (true-float, real tone-mapping) is present.
    assert any("HDR image" in t for t in titles), "missing HDR section"

    # render_html self-checks each component (raises SystemExit on a bad emit).
    html = mod.render_html(items)

    # Self-contained + each renderer bundle inlined.
    assert "cairn-plot-" in html
    assert "could not render" not in html
    # the imagehdr renderer is in CORE (no new addon) — it appears in the page.
    assert "imagehdr" in html
    assert "__cairnPlotBundleLoaded" in html          # core bundle inlined
    assert "__cairnPlotThreeLoaded" in html           # three addon (PointCloud)
    assert "__cairnPlotFigureLoaded" in html          # figure addon (Figure)

    # No EXTERNAL resource *tags* — the page carries its own JS/CSS/data. (We
    # match tags, not substrings: Plotly's inlined bundle contains dormant map
    # font/icon URL *string literals* that are never fetched for normal charts.)
    import re

    external_tags = re.findall(
        r"<(?:script|link|img)\b[^>]*\b(?:src|href)\s*=\s*[\"']https?://",
        html,
    )
    assert not external_tags, f"unexpected external resource tags: {external_tags[:3]}"


def test_gallery_without_plotly_skips_figure(monkeypatch):
    # cairn core needs neither plotly nor the Figure type; the gallery must still
    # render the rest if plotly is absent.
    mod = _load_example()
    import builtins

    real_import = builtins.__import__

    def _no_plotly(name, *args, **kwargs):
        if name.startswith("plotly"):
            raise ImportError("plotly disabled for this test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _no_plotly)
    items = mod.build_gallery()
    titles = [t for t, _ in items]
    assert not any(t.startswith("Figure") for t in titles)
    assert any(t.startswith("PointCloud") for t in titles)
    # still self-contained + valid
    mod.render_html(items)
