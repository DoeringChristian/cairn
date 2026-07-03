"""Figure handler — matplotlib + plotly."""

from __future__ import annotations

import json

import pytest

from cairn.sdk.handlers.figure import FigureHandler, _blank_png


@pytest.mark.media
def test_matplotlib_figure_produces_png_and_source():
    mpl = pytest.importorskip("matplotlib")
    mpl.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    ax.plot([1, 2, 3], [1, 4, 9])
    h = FigureHandler()
    data, meta = h.serialize(fig)
    # PNG magic
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    # Either the mpl_to_plotly conversion worked OR it fell back silently.
    # Both are valid. If it worked, source metadata should be present.
    assert "has_source" in meta
    if meta["has_source"]:
        assert meta["source_format"] == "plotly_json"
        # The carried blob is JSON.
        json.loads(meta["_source_blob"].decode("utf-8"))
    plt.close(fig)


@pytest.mark.media
def test_plotly_figure_serializes_to_json_source():
    go = pytest.importorskip("plotly.graph_objects")
    fig = go.Figure(data=[go.Scatter(x=[1, 2, 3], y=[1, 4, 9])])
    h = FigureHandler()
    data, meta = h.serialize(fig)
    # Plotly source must be present and parseable.
    assert meta["has_source"] is True
    assert meta["source_format"] == "plotly_json"
    parsed = json.loads(meta["_source_blob"].decode("utf-8"))
    assert "data" in parsed


def test_can_handle_requires_matplotlib_or_plotly():
    h = FigureHandler()
    # Plain numbers can't be figures.
    assert not h.can_handle(1)
    assert not h.can_handle("x")


def test_blank_png_is_content_unique_per_seed():
    # Regression: without a seed, the placeholder used to be a fixed
    # constant, so every kaleido-less figure content-addressed to the same
    # artifacts-table row and clobbered each other's source_hash metadata
    # via the store's ON CONFLICT (hash) DO UPDATE.
    p_no_seed = _blank_png()
    p_a1 = _blank_png(b"figure-a-source-json")
    p_a2 = _blank_png(b"figure-a-source-json")
    p_b = _blank_png(b"figure-b-source-json")

    assert p_a1 != p_no_seed
    assert p_a1 != p_b
    assert p_a1 == p_a2  # same source -> same bytes (still content-addressed)

    # Still a valid, decodable PNG.
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(p_a1))
    img.load()
