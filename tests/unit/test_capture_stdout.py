"""Stdout capture — tee, ANSI, tqdm-style \\r handling, nested-run guard."""

from __future__ import annotations

import pytest

from cairn.sdk.capture.stdout import (
    StdoutCapture,
    clear_active_run,
    set_active_run,
    strip_ansi,
)


def test_strip_ansi_helper():
    assert strip_ansi("\x1b[31mhi\x1b[0m") == "hi"
    assert strip_ansi("plain") == "plain"


def test_capture_simple_lines():
    events = []
    cap = StdoutCapture(on_line=events.append)
    try:
        cap.start()
        import sys

        print("hello", file=sys.stdout)
        print("world", file=sys.stderr)
    finally:
        cap.stop()
    contents = [e["content"] for e in events]
    streams = [e["stream"] for e in events]
    assert "hello" in contents
    assert "world" in contents
    assert "stdout" in streams
    assert "stderr" in streams


def test_ansi_stripped_in_content_preserved_in_raw():
    events = []
    cap = StdoutCapture(on_line=events.append)
    try:
        cap.start()
        import sys

        sys.stdout.write("\x1b[31mred\x1b[0m\n")
    finally:
        cap.stop()
    msg = next(e for e in events if "red" in e["content"])
    assert msg["content"] == "red"
    assert "\x1b[" in msg["content_raw"]


def test_tqdm_style_carriage_returns_collapsed():
    events = []
    cap = StdoutCapture(on_line=events.append)
    try:
        cap.start()
        import sys

        sys.stdout.write("\rloss: 0.9")
        sys.stdout.write("\rloss: 0.5")
        sys.stdout.write("\rloss: 0.1\n")
    finally:
        cap.stop()
    # Only the final state should have been emitted.
    contents = [e["content"] for e in events]
    assert "loss: 0.1" in contents
    assert "loss: 0.9" not in contents
    assert "loss: 0.5" not in contents


def test_drain_emits_trailing_partial_line():
    events = []
    cap = StdoutCapture(on_line=events.append)
    try:
        cap.start()
        import sys

        sys.stdout.write("no-newline")
    finally:
        cap.stop()
    # stop() drains the partial line.
    contents = [e["content"] for e in events]
    assert "no-newline" in contents


def test_set_and_clear_active_run():
    set_active_run("r1")
    try:
        with pytest.raises(RuntimeError, match="Nested"):
            set_active_run("r2")
    finally:
        clear_active_run("r1")


def test_clear_same_id_allows_new_run():
    set_active_run("r1")
    clear_active_run("r1")
    set_active_run("r2")
    clear_active_run("r2")


def test_start_is_idempotent():
    cap = StdoutCapture(on_line=lambda _e: None)
    try:
        cap.start()
        cap.start()  # no-op
    finally:
        cap.stop()
