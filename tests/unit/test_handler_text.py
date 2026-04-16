"""Text handler."""

from __future__ import annotations

from cairn.sdk.handlers.text import INLINE_MAX_BYTES, TextHandler


def test_short_text_inline():
    h = TextHandler()
    data, meta = h.serialize("hi")
    assert data == b"hi"
    assert meta["inline"] is True
    assert meta["length_chars"] == 2


def test_long_text_blob():
    h = TextHandler()
    big = "x" * (INLINE_MAX_BYTES + 100)
    data, meta = h.serialize(big)
    assert meta["inline"] is False
    assert len(data) == len(big)
    assert meta["preview"].endswith("…")


def test_only_matches_str():
    h = TextHandler()
    assert h.can_handle("x")
    assert not h.can_handle(1)
    assert not h.can_handle(["x"])
