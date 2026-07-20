"""cp.Report templating + the built-in `cairn` / `minimal` themes.

Covers the templating engine added on top of the pure `cp.Report` deliverable
(see `test_plot_report.py` for the block/store/bundle behavior): built-in
template selection, custom template dirs / jinja2 objects, the stable context
contract templates program against, the notebook-safe scoped `cairn` fragment,
and the `minimal` template's byte-similar reproduction of the legacy bare emit.
"""

from __future__ import annotations

import re

import pytest

import cairn.plot as cp
# NB: `cairn_plot.report` the ATTRIBUTE is the lowercase factory function (it
# shadows the submodule on the package), so import the resolver symbol directly.
from cairn_plot.report import _resolve_templates

# A tiny PNG-magic blob (see test_plot_report.py) — baked verbatim, no PIL.
_PNG = b"\x89PNG\r\n\x1a\n" + b"cairn-tmpl-blob" * 4

_MOUNT_DIV_RE = re.compile(r'class="cairn-plot-mount"')


# ---------------------------------------------------------------------------
# Built-in template selection
# ---------------------------------------------------------------------------


def test_default_template_is_cairn():
    rep = cp.Report(title="T")
    assert rep.template == "cairn"
    html = rep._repr_html_()
    # The cairn theme wraps everything in a `.cairn-report` root + theme CSS.
    assert "cairn-report" in html
    assert "--color-bg" in html  # theme tokens inlined


def test_named_minimal_template_selected():
    rep = cp.Report(title="T", template="minimal").md("body")
    html = rep._repr_html_()
    # minimal reproduces the bare emit — no theme wrapper / tokens / framing.
    assert "cairn-report" not in html
    assert "--color-bg" not in html
    assert "cairn-block" not in html


def test_unknown_template_name_raises_clear_error():
    with pytest.raises(ValueError) as exc:
        cp.Report(template="does-not-exist")
    msg = str(exc.value)
    assert "does-not-exist" in msg
    # The message names the built-ins so the caller knows the valid options.
    assert "cairn" in msg and "minimal" in msg


def test_bad_template_type_still_resolves_via_str_then_errors():
    # A non-name, non-dir string is an unknown template, not a crash.
    with pytest.raises(ValueError):
        cp.Report(template="/no/such/template/dir")


# ---------------------------------------------------------------------------
# Custom templates — a filesystem dir + jinja2 Environment/Template
# ---------------------------------------------------------------------------


def _write_template_dir(tmp_path):
    (tmp_path / "page.html.j2").write_text(
        "<!doctype html><html><body>PAGE::{{ title }}::"
        "{% for b in blocks %}[{{ b.kind }}]{% endfor %}</body></html>",
        encoding="utf-8",
    )
    (tmp_path / "fragment.html.j2").write_text(
        "FRAG::{{ title }}::{% for b in blocks %}[{{ b.kind }}]{{ b.html }}{% endfor %}",
        encoding="utf-8",
    )
    return tmp_path


def test_custom_template_dir(tmp_path):
    tdir = _write_template_dir(tmp_path)
    rep = cp.Report(title="Custom", template=str(tdir)).md("# hi").add(cp.Line([1, 2]))
    frag = rep._repr_html_()
    assert frag.startswith("FRAG::Custom::")
    # Block kinds flow through the context: md + component.
    assert "[md]" in frag and "[component]" in frag
    # The component's mount HTML is still emitted through the custom template.
    assert _MOUNT_DIV_RE.search(frag)
    # The custom page template drives .save() too.
    doc = rep._full_document()
    assert doc.startswith("<!doctype html><html><body>PAGE::Custom::")


def test_custom_template_dir_missing_files_raises(tmp_path):
    (tmp_path / "page.html.j2").write_text("x", encoding="utf-8")  # no fragment
    with pytest.raises(ValueError) as exc:
        cp.Report(template=str(tmp_path))
    assert "fragment.html.j2" in str(exc.value)


def test_custom_jinja2_environment(tmp_path):
    jinja2 = pytest.importorskip("jinja2")
    tdir = _write_template_dir(tmp_path)
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(tdir)), autoescape=False)
    rep = cp.Report(title="Env", template=env).md("body")
    assert rep._repr_html_().startswith("FRAG::Env::")


def test_custom_jinja2_template_used_for_both(tmp_path):
    jinja2 = pytest.importorskip("jinja2")
    tmpl = jinja2.Template("ONE::{{ title }}::{{ blocks | length }}")
    rep = cp.Report(title="Solo", template=tmpl).md("a").md("b")
    # A single Template is used for both fragment and page.
    assert rep._repr_html_() == "ONE::Solo::2"
    assert rep._full_document() == "ONE::Solo::2"


# ---------------------------------------------------------------------------
# The stable context contract
# ---------------------------------------------------------------------------


def test_context_contract_fields_present():
    rep = cp.Report(title="Ctx").md("# h").html("<b>raw</b>").add(cp.Line([1, 2])).grid(
        [cp.Line([1]), cp.Line([2])], cols=2
    )
    ctx = rep._context()
    assert set(ctx) == {"title", "blocks", "bundle_html", "store_html", "meta"}
    assert ctx["title"] == "Ctx"
    assert set(ctx["meta"]) == {"generated_at", "cairn_plot_version"}
    assert ctx["meta"]["cairn_plot_version"]  # non-empty
    assert "UTC" in ctx["meta"]["generated_at"]

    kinds = [b["kind"] for b in ctx["blocks"]]
    assert kinds == ["md", "html", "component", "grid"]
    # index is monotonic and each block carries rendered inner html.
    assert [b["index"] for b in ctx["blocks"]] == [0, 1, 2, 3]
    md_block = ctx["blocks"][0]
    assert "<h1>h</h1>" in md_block["html"]
    assert ctx["blocks"][1]["html"] == "<b>raw</b>"


def test_context_bundle_and_store_populated_for_components():
    ctx = cp.Report().add(cp.Image(_PNG))._context()
    assert "__cairnPlotBundleLoaded" in ctx["bundle_html"]
    assert "application/cairn-plot-store+json" in ctx["store_html"]


def test_context_empty_report_has_no_bundle_or_store():
    ctx = cp.Report().md("just prose")._context()
    assert ctx["bundle_html"] == ""
    assert ctx["store_html"] == ""
    assert [b["kind"] for b in ctx["blocks"]] == ["md"]


# ---------------------------------------------------------------------------
# The cairn fragment is notebook-safe (scoped, no document shell)
# ---------------------------------------------------------------------------


def test_cairn_fragment_has_no_document_shell_and_scopes_css():
    # Pure-markdown report → no renderer bundle (whose minified JS could carry
    # incidental "<body"-like substrings), so the shell assertion is exact.
    frag = cp.Report(title="Nb").md("# section\n\nprose").md("- a\n- b")._repr_html_()
    assert "<html" not in frag
    assert "<body" not in frag
    # The theme CSS + root element are scoped under `.cairn-report`.
    assert ".cairn-report" in frag  # scoped selectors
    assert 'class="cairn-report' in frag  # the scoping root element
    # Theme tokens (light + dark) are inlined.
    assert "--color-bg: #ffffff" in frag
    assert "prefers-color-scheme: dark" in frag
    assert '[data-theme="dark"]' in frag


def test_cairn_page_is_full_document_and_scoped():
    doc = cp.Report(title="Doc").md("body")._full_document()
    assert doc.startswith("<!doctype html>")
    assert "<title>Doc</title>" in doc
    assert "</body></html>" in doc.strip()
    # The report root still carries the scoping class in the full document.
    assert 'class="cairn-report cairn-plot-doc"' in doc


def test_cairn_title_block_carries_meta_line():
    frag = cp.Report(title="Report X").md("x")._repr_html_()
    assert "<h1>Report X</h1>" in frag
    assert "cairn-meta" in frag
    assert "cairn-plot" in frag  # version tag in the meta line


# ---------------------------------------------------------------------------
# minimal ≈ legacy structure
# ---------------------------------------------------------------------------


def test_minimal_fragment_matches_legacy_structure():
    rep = cp.Report(title="Legacy", template="minimal").md("# H").html("<i>raw</i>").add(
        cp.Line([1, 2, 3])
    )
    frag = rep._repr_html_()
    # Legacy bare emit: bundle first, title <h1>, then blocks verbatim — no
    # theme CSS, no `.cairn-report` wrapper, no per-block <section> framing.
    assert "__cairnPlotBundleLoaded" in frag
    assert "<h1>Legacy</h1>" in frag
    assert "<h1>H</h1>" in frag  # rendered markdown heading
    assert "<i>raw</i>" in frag  # raw html verbatim
    assert _MOUNT_DIV_RE.search(frag)
    assert "cairn-report" not in frag
    assert "cairn-block" not in frag


def test_minimal_page_is_bare_full_document():
    doc = cp.Report(title="Bare", template="minimal").md("hi")._full_document()
    assert doc.startswith("<!doctype html>")
    assert 'class="cairn-plot-doc"' in doc  # renderer-token opt-in kept
    assert "<title>Bare</title>" in doc
    assert "cairn-report" not in doc  # but NO report theme


def test_minimal_empty_placeholder():
    assert "empty cairn.plot report" in cp.Report(template="minimal")._repr_html_()


# ---------------------------------------------------------------------------
# resolver unit checks
# ---------------------------------------------------------------------------


def test_resolve_templates_builtin_pair():
    page, frag = _resolve_templates("cairn")
    assert page.name == "cairn/page.html.j2"
    assert frag.name == "cairn/fragment.html.j2"
