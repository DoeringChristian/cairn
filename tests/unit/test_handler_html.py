"""HTML handler — sandboxed blob + size cap."""

from __future__ import annotations

import pytest

from cairn.sdk.handlers.html import MAX_BYTES, HtmlHandler


def test_roundtrip():
    h = HtmlHandler()
    src = "<h1>Report</h1><p>hello <b>world</b></p>"
    data, meta = h.serialize(src)
    assert data == src.encode("utf-8")
    assert h.deserialize(data) == src
    assert meta["length_bytes"] == len(src.encode("utf-8"))


def test_preview_strips_tags():
    h = HtmlHandler()
    _, meta = h.serialize("<div><p>Hello <b>World</b></p></div>")
    assert meta["preview"] == "Hello World"
    assert "<" not in meta["preview"]


def test_preview_drops_style_and_script_bodies():
    h = HtmlHandler()
    src = "<html><head><style>body{color:red}</style></head><body><p>Hello</p><script>alert(1)</script></body></html>"
    _, meta = h.serialize(src)
    assert meta["preview"] == "Hello"


def test_preview_truncated_at_160():
    h = HtmlHandler()
    text = "x" * 300
    _, meta = h.serialize(f"<p>{text}</p>")
    assert len(meta["preview"]) == 161  # 160 chars + ellipsis
    assert meta["preview"].endswith("…")


def test_oversized_html_rejected():
    h = HtmlHandler()
    big = "<p>" + ("x" * (MAX_BYTES + 10)) + "</p>"
    with pytest.raises(ValueError, match="too large"):
        h.serialize(big)


def test_can_handle_only_via_wrapper():
    h = HtmlHandler()
    assert not h.can_handle("<p>hi</p>")


def test_mime_and_object_type():
    h = HtmlHandler()
    assert h.object_type == "html"
    assert h.mime_type == "text/html"
