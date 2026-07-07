"""WS-PYAPI deliverable 4: `cairn.Report` — an inline-only notebook
container (no server push; see cairn/sdk/report.py's module docstring for
why `.publish()` was dropped in favor of "the notebook IS the report").

`Report._repr_html_()` must concatenate every `.md()`/`.add()`ed block, in
order: markdown rendered to HTML, and each element's own `_repr_html_`
(iframe for server-backed `CardElement`s, self-contained HTML for
`HtmlElement`s / bare plotly `Figure`s).
"""

from __future__ import annotations

import pytest

import cairn
from cairn.sdk.elements import CardElement, HtmlElement


def test_report_is_empty_by_default():
    r = cairn.Report()
    html = r._repr_html_()
    assert "empty cairn.Report" in html


def test_report_with_name_and_no_blocks_shows_heading_only():
    r = cairn.Report(name="Empty", project="p")
    html = r._repr_html_()
    assert "<h1>Empty</h1>" in html


def test_report_md_renders_markdown_to_html():
    r = cairn.Report()
    r.md("# Title\n\nSome **bold** and *italic* and `code`.")
    html = r._repr_html_()
    assert "<h1>Title</h1>" in html
    assert "<strong>bold</strong>" in html
    assert "<em>italic</em>" in html
    assert "<code>code</code>" in html


def test_report_md_renders_bullet_list():
    r = cairn.Report()
    r.md("- one\n- two\n- three")
    html = r._repr_html_()
    assert "<ul>" in html
    assert "<li>one</li>" in html
    assert "<li>three</li>" in html


def test_report_add_appends_element_html_no_server(monkeypatch):
    import cairn.sdk.elements as elements_mod

    monkeypatch.setattr(
        elements_mod._config, "resolve_server", lambda explicit=None: "http://127.0.0.1:1"
    )
    # Also neutralize the health probe outright: `_resolve_server` now falls
    # through to fixed-port fallbacks (incl. `cairn ui`'s :4301 default), so
    # a stray dev server on that port would otherwise satisfy discovery and
    # defeat this "no server" assertion. Mocking `_probe` keeps the test
    # deterministic regardless of what's running locally.
    monkeypatch.setattr(
        elements_mod.CardElement, "_probe", staticmethod(lambda url: False)
    )
    r = cairn.Report()
    el = CardElement({"type": "scalar", "series": []})
    r.add(el)
    html = r._repr_html_()
    assert "no reachable cairn server" in html


def test_report_add_appends_htmlelement_self_contained():
    r = cairn.Report()
    el = HtmlElement("<div class='self-contained'>hi</div>", label="thing")
    r.add(el)
    html = r._repr_html_()
    assert "<div class='self-contained'>hi</div>" in html


def test_report_add_accepts_bare_plotly_figure():
    pytest.importorskip("plotly")
    import plotly.graph_objects as go

    r = cairn.Report()
    fig = go.Figure(data=go.Bar(x=["a", "b"], y=[1, 2]))
    r.add(fig)
    html = r._repr_html_()
    assert "plotly" in html.lower()


def test_report_blocks_preserve_order_and_kind():
    r = cairn.Report()
    el = HtmlElement("<p>x</p>")
    r.md("first").add(el).md("second")
    kinds = [k for k, _ in r.blocks]
    assert kinds == ["md", "element", "md"]


def test_report_repr_html_concatenates_blocks_in_order():
    r = cairn.Report(name="Ablation study")
    r.md("## Results")
    r.add(HtmlElement("<p>card-one</p>"))
    r.md("more text")
    html = r._repr_html_()
    assert html.index("Ablation study") < html.index("Results")
    assert html.index("Results") < html.index("card-one")
    assert html.index("card-one") < html.index("more text")


def test_report_repr_mimebundle_matches_repr_html():
    r = cairn.Report()
    r.md("hi")
    bundle, meta = r._repr_mimebundle_()
    assert bundle["text/html"] == r._repr_html_()
    assert meta == {}
