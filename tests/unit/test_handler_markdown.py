"""Markdown handler — GFM text blob + size cap."""

from __future__ import annotations

import pytest

from cairn.sdk.handlers.markdown import MAX_BYTES, MarkdownHandler


def test_roundtrip():
    h = MarkdownHandler()
    src = "# Notes\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"
    data, meta = h.serialize(src)
    assert data == src.encode("utf-8")
    assert h.deserialize(data) == src
    assert meta["length_bytes"] == len(src.encode("utf-8"))


def test_preview_truncated_at_160():
    h = MarkdownHandler()
    text = "x" * 300
    _, meta = h.serialize(text)
    assert len(meta["preview"]) == 161  # 160 chars + ellipsis
    assert meta["preview"].endswith("…")


def test_preview_strips_surrounding_whitespace():
    h = MarkdownHandler()
    _, meta = h.serialize("  \n# Title\n  ")
    assert meta["preview"] == "# Title"


def test_oversized_markdown_rejected():
    h = MarkdownHandler()
    big = "x" * (MAX_BYTES + 10)
    with pytest.raises(ValueError, match="too large"):
        h.serialize(big)


def test_can_handle_only_via_wrapper():
    h = MarkdownHandler()
    assert not h.can_handle("# hi")


def test_mime_and_object_type():
    h = MarkdownHandler()
    assert h.object_type == "markdown"
    assert h.mime_type == "text/markdown"
