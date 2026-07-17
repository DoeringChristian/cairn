"""cp.Report (Q21) — a composable, self-contained cairn-plot HTML report.

Distinct from `cairn.Report` (the notebook-inline, server-backed card
container in `test_report.py`): `cp.Report` reuses the PURE `cairn-plot`
`PlotElement` bundle+store+mount emit, so markdown + raw HTML + composable
`cp.*` components render into ONE offline HTML doc — inlined renderer bundle
(once), merged content-addressed store (deduped by hash), interleaved blocks.
"""

from __future__ import annotations

import re

import pytest

import cairn.plot as cp

# A tiny PNG-magic byte blob. `cp.Image(bytes)` sniffs the header and bakes the
# bytes verbatim into the content-addressed store (no PIL needed for `bytes`).
_PNG_A = b"\x89PNG\r\n\x1a\n" + b"cairn-report-blob-A" * 4
_PNG_B = b"\x89PNG\r\n\x1a\n" + b"cairn-report-blob-B" * 4

_STORE_SCRIPT_RE = re.compile(
    r'<script type="application/cairn-plot-store\+json"[^>]*>(.*?)</script>', re.S
)
_MOUNT_DIV_RE = re.compile(r'class="cairn-plot-mount"')


def _store_blob(html: str) -> str:
    m = _STORE_SCRIPT_RE.search(html)
    assert m, "no merged store script found in report HTML"
    return m.group(1)


# ---------------------------------------------------------------------------
# Core deliverable: one self-contained doc with md + raw html + components.
# ---------------------------------------------------------------------------


def test_report_md_html_and_two_components_one_selfcontained_doc():
    rep = (
        cp.Report(title="My Report")
        .md("# Section\n\nSome **bold** prose.")
        .html('<div id="raw-marker">raw</div>')
        .add(cp.Line([1.0, 2.0, 3.0]))
        .add(cp.Image(_PNG_A))
    )
    html = rep._repr_html_()

    # Rendered markdown (heading + inline bold) is present.
    assert "<h1>My Report</h1>" in html  # title
    assert "<h1>Section</h1>" in html
    assert "<strong>bold</strong>" in html
    # Raw HTML injected verbatim.
    assert '<div id="raw-marker">raw</div>' in html
    # One mount div per component.
    assert len(_MOUNT_DIV_RE.findall(html)) == 2
    # The renderer bundle is inlined EXACTLY once (guarded include-once).
    assert html.count("if(!window.__cairnPlotBundleLoaded){(function()") == 1
    # It is self-contained — no external script/stylesheet loads (the inline
    # bundle injects its CSS via a <style> element, never a <link>/remote src).
    assert 'src="http' not in html
    assert "<link " not in html


def test_report_repr_html_nonempty_and_ordered():
    rep = cp.Report().md("intro").add(cp.Line([1, 2])).md("outro")
    html = rep._repr_html_()
    assert html.strip()
    # Blocks appear in insertion order.
    assert html.index("intro") < html.index("cairn-plot-mount")
    assert html.index("cairn-plot-mount") < html.index("outro")


def test_report_merged_store_dedups_shared_blob():
    # Two images built from the SAME bytes => same content hash => the merged
    # store carries the blob EXACTLY once.
    rep = cp.Report().add(cp.Image(_PNG_A)).add(cp.Image(_PNG_A))
    assert len(rep._merged_store()) == 1
    (hash_,) = rep._merged_store().keys()

    html = rep._repr_html_()
    # The hash appears once inside the single merged store script...
    assert _store_blob(html).count(hash_) == 1
    # ...even though both mounts still reference it (2 more occurrences).
    assert html.count(hash_) == 3


def test_report_distinct_blobs_both_in_store():
    rep = cp.Report().add(cp.Image(_PNG_A)).add(cp.Image(_PNG_B))
    assert len(rep._merged_store()) == 2


# ---------------------------------------------------------------------------
# Addon gating — only pull the addons the components actually need.
# ---------------------------------------------------------------------------


def test_report_line_only_pulls_no_image_or_three_or_figure_addon():
    html = cp.Report().add(cp.Line([1, 2, 3]))._repr_html_()
    assert "__cairnPlotGpuImageLoaded" not in html
    assert "__cairnPlotThreeLoaded" not in html
    assert "__cairnPlotFigureLoaded" not in html


def test_report_with_image_pulls_gpu_image_addon():
    html = cp.Report().add(cp.Image(_PNG_A))._repr_html_()
    assert "__cairnPlotGpuImageLoaded" in html


def test_report_with_figure_pulls_figure_addon():
    pytest.importorskip("plotly")
    import plotly.graph_objects as go

    fig = go.Figure(data=go.Bar(x=["a", "b"], y=[1, 2]))
    html = cp.Report().add(cp.Figure(fig))._repr_html_()
    assert "__cairnPlotFigureLoaded" in html


# ---------------------------------------------------------------------------
# Builders — grid sugar, aliases, error handling.
# ---------------------------------------------------------------------------


def test_report_grid_sugar_adds_a_grid_component():
    rep = cp.Report().grid([cp.Line([1, 2, 3]), cp.Line([3, 2, 1])], cols=2)
    html = rep._repr_html_()
    assert len(_MOUNT_DIV_RE.findall(html)) == 1  # one grid = one mount
    # The grid descriptor lowered to a recursive `grid` tree.
    assert '"kind":"grid"' in html.replace(" ", "")


def test_report_markdown_alias_matches_md():
    a = cp.Report().markdown("# Hi")._repr_html_()
    b = cp.Report().md("# Hi")._repr_html_()
    # Same rendered heading (mount uuids differ, but there are no components).
    assert "<h1>Hi</h1>" in a and "<h1>Hi</h1>" in b


def test_report_add_rejects_non_component():
    with pytest.raises(TypeError):
        cp.Report().add("not a component")


def test_report_chainable_returns_self():
    rep = cp.Report()
    assert rep.md("x") is rep
    assert rep.html("<b>y</b>") is rep
    assert rep.add(cp.Line([1, 2])) is rep


def test_report_accepts_prebuilt_plotelement():
    el = cp.line([1, 2, 3])  # lowercase builder returns a PlotElement
    html = cp.Report().add(el)._repr_html_()
    assert len(_MOUNT_DIV_RE.findall(html)) == 1


# ---------------------------------------------------------------------------
# Markdown: the newly-added fenced code + links (plus the inherited spans).
# ---------------------------------------------------------------------------


def test_report_markdown_fenced_code_block():
    html = cp.Report().md("```\nx = 1\ny = 2\n```")._repr_html_()
    assert "<pre><code>" in html
    assert "x = 1\ny = 2" in html


def test_report_markdown_link():
    html = cp.Report().md("see [docs](https://example.com/x)")._repr_html_()
    assert '<a href="https://example.com/x">docs</a>' in html


def test_report_markdown_inline_spans_and_lists():
    html = cp.Report().md("- *a*\n- `b`")._repr_html_()
    assert "<ul>" in html
    assert "<em>a</em>" in html
    assert "<code>b</code>" in html


# ---------------------------------------------------------------------------
# Emit protocol — mimebundle, save, empty, repr.
# ---------------------------------------------------------------------------


def test_report_repr_mimebundle_matches_repr_html():
    rep = cp.Report().md("hi").add(cp.Line([1, 2, 3]))
    bundle, meta = rep._repr_mimebundle_()
    # The two calls mint fresh mount uuids, so compare structure, not identity:
    # both carry the same rendered markdown + one mount div.
    assert "hi" in bundle["text/html"]
    assert bundle["text/plain"] == repr(rep)
    assert meta == {}


def test_report_save_writes_full_selfcontained_document(tmp_path):
    out = tmp_path / "report.html"
    rep = cp.Report(title="Saved").md("body").add(cp.Image(_PNG_A))
    returned = rep.save(out)
    assert returned == out
    doc = out.read_text(encoding="utf-8")
    assert doc.startswith("<!doctype html>")
    assert "<title>Saved</title>" in doc
    assert "cairn-plot-mount" in doc
    assert "</body></html>" in doc.strip()


def test_report_empty_is_a_visible_placeholder():
    html = cp.Report()._repr_html_()
    assert "empty cairn.plot report" in html


def test_report_lowercase_factory_builds_plotreport():
    from cairn.sdk.report import PlotReport

    rep = cp.report("t")
    assert isinstance(rep, PlotReport)
    assert cp.Report is PlotReport


def test_report_repr_is_informative():
    rep = cp.Report(title="R").md("x")
    assert "cairn.plot.Report" in repr(rep)
    assert "blocks=1" in repr(rep)
