"""WS-PLOT Phase C gate: the `PlotElement` self-contained emit (design spec
§5–§7 + acceptance criteria M1/M2).

Headless display smoke — builds a PlotElement for each supported renderer
(scalar-from-arrays, figure, table, image-from-bytes) and asserts the emitted
HTML carries: the mount div, a schema-valid `application/cairn-plot+json`
descriptor, the store blob (image), the include-once guard, per-div multi-mount
queueing, and NO `</script>`-breakout / NO CDN link. Round-trips every emitted
descriptor back through the pydantic `PlotSpec`.
"""

from __future__ import annotations

import json
import re

import pytest

import cairn.plot as cplot
from cairn.sdk import _plot_bundle as pb
from cairn.sdk.card_spec import PlotSpec
from cairn.sdk.elements import PlotElement

# A 1x1 opaque PNG.
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da6360000002000154a24f5f0000000049454e44ae426082"
)


def _unescape_script_json(s: str) -> str:
    return s.replace("\\u003c", "<").replace("\\u003e", ">").replace("\\u0026", "&")


def _descriptor(el: PlotElement) -> dict:
    m = re.search(
        r'application/cairn-plot\+json" id="[^"]+">(.*?)</script>',
        el._repr_html_(),
        re.S,
    )
    assert m
    return json.loads(_unescape_script_json(m.group(1)))


@pytest.fixture
def figure_obj():
    go = pytest.importorskip("plotly.graph_objects")
    return go.Figure(go.Scatter(x=[1, 2, 3], y=[1, 4, 9]))


def _supported_elements(figure_obj) -> dict[str, PlotElement]:
    return {
        "scalar": cplot.scalar([0.9, 0.5, 0.3, 0.2]),
        "figure": cplot.figure(figure_obj),
        "table": cplot.table([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]),
        "image": cplot.image(_PNG),
    }


def test_each_renderer_emits_mount_div_and_schema_valid_descriptor(figure_obj):
    for name, el in _supported_elements(figure_obj).items():
        html = el._repr_html_()
        assert 'id="cairn-plot-' in html, f"{name}: no mount div"
        desc = _descriptor(el)
        spec = PlotSpec.model_validate(desc)  # round-trip through pydantic
        assert spec.renderer == name
        assert spec.mode == "local"


def test_include_once_guard_present(figure_obj):
    for el in _supported_elements(figure_obj).values():
        assert "window.__cairnPlotBundleLoaded" in el._repr_html_()


def test_image_emits_store_blob(figure_obj):
    html = cplot.image(_PNG)._repr_html_()
    assert 'application/cairn-plot-store+json' in html
    assert "window.__cairnPlotStore" in html
    assert "Object.assign" in html


def test_mount_queues_per_div(figure_obj):
    # Each element pushes its own (divId, descId) onto the shared queue, so N
    # plots mount independently on one page.
    html = cplot.scalar([1, 2, 3])._repr_html_()
    assert "__cairnPlotQueue" in html
    m = re.search(r'push\(\["(cairn-plot-[^"]+)","(cairn-plot-desc-[^"]+)"\]\)', html)
    assert m, "no per-div queue push"
    div_id, desc_id = m.group(1), m.group(2)
    assert f'id="{div_id}"' in html
    assert f'id="{desc_id}"' in html


def test_two_elements_have_distinct_div_ids(figure_obj):
    a = cplot.scalar([1, 2, 3])._repr_html_()
    b = cplot.image(_PNG)._repr_html_()
    ids_a = set(re.findall(r'id="(cairn-plot-[0-9a-f]+)"', a))
    ids_b = set(re.findall(r'id="(cairn-plot-[0-9a-f]+)"', b))
    assert ids_a and ids_b and ids_a.isdisjoint(ids_b)


# ---- M1: no <script> breakout on hostile payloads --------------------------


def test_m1_xss_payload_does_not_break_out_of_script():
    payload = '</script><script>window.__pwned=1</script>'
    el = cplot.table([{"col": payload}])
    html = el._repr_html_()
    # The raw breakout sequence must NOT appear literally in the emitted HTML.
    assert "</script><script>window.__pwned" not in html
    # …but it round-trips intact through the escaped descriptor.
    desc = _descriptor(el)
    assert desc["data"]["props"]["table"]["data"][0][0] == payload


def test_m1_json_script_safe_escapes_all_breakout_sequences():
    out = pb.json_script_safe({"x": "</script><!--&"})
    assert "</" not in out and "<!--" not in out and "&" not in out
    assert json.loads(_unescape_script_json(out))["x"] == "</script><!--&"


# ---- M2: no external CDN in the self-contained emit ------------------------


def test_m2_no_external_cdn_or_network(figure_obj):
    # M2 is about the EMIT WRAPPER: the offline HTML Python generates must not
    # pull a CDN (the plot.html shell's font-awesome `<link>` must NOT appear)
    # nor add any external src/href/@import. Strip the inlined bundle JS + CSS
    # first — the bundled plotly legitimately carries W3C XML namespace URIs
    # and map-tile attribution string literals that are never fetched for the
    # renderers we ship.
    bundle_js = pb.inline_bundle_js()
    bundle_css = pb.json_script_safe(pb.inline_bundle_css())
    cdn_hosts = ("cdnjs", "cloudflare", "unpkg", "jsdelivr", "googleapis", "font-awesome")
    ext_ref = re.compile(r'(?:src|href)\s*=\s*["\']https?://|@import\s+url\(\s*["\']?https?://')
    for name, el in _supported_elements(figure_obj).items():
        wrapper = el._repr_html_().replace(bundle_js, "").replace(bundle_css, "")
        low = wrapper.lower()
        for host in cdn_hosts:
            assert host not in low, f"{name}: emit wrapper references CDN {host!r}"
        assert not ext_ref.search(wrapper), f"{name}: emit wrapper has external fetch"
    # And the design-token CSS itself imports nothing external.
    assert "@import" not in pb.inline_bundle_css() or "url(http" not in pb.inline_bundle_css()


def test_inline_bundle_and_css_present_and_offline():
    html = cplot.scalar([1, 2, 3])._repr_html_()
    # The renderer bundle + design-token CSS are inlined (offline).
    assert "__cairnPlotBootstrap" in pb.inline_bundle_js()
    assert "document.createElement('style')" in html


def test_bad_data_mode_rejected():
    with pytest.raises(ValueError, match="data_mode"):
        cplot.scalar([1, 2, 3], data_mode="bogus")
