"""Unit tests for the in-memory metric buffer."""

from __future__ import annotations

import threading
import time

from cairn.sdk.buffer import MetricBuffer


def test_flush_after_interval():
    received: list[list[dict]] = []
    buf = MetricBuffer(
        lambda b: received.append(b) or True, flush_interval=0.05, max_rows=100
    )
    try:
        for i in range(10):
            buf.append({"step": i})
        time.sleep(0.15)
        assert sum(len(b) for b in received) == 10
    finally:
        buf.stop()


def test_immediate_flush_when_max_rows_reached():
    received: list[list[dict]] = []
    buf = MetricBuffer(
        lambda b: received.append(b) or True, flush_interval=5.0, max_rows=10
    )
    try:
        for i in range(10):
            buf.append({"step": i})
        # The event should trigger an immediate flush without waiting 5s.
        time.sleep(0.2)
        assert sum(len(b) for b in received) == 10
    finally:
        buf.stop()


def test_stop_drains_remaining():
    received: list[list[dict]] = []
    buf = MetricBuffer(
        lambda b: received.append(b) or True, flush_interval=10.0, max_rows=1000
    )
    for i in range(3):
        buf.append({"step": i})
    buf.stop()
    assert sum(len(b) for b in received) == 3


def test_thread_is_daemon():
    buf = MetricBuffer(lambda b: True, flush_interval=10.0)
    try:
        assert buf.thread.daemon is True
    finally:
        buf.stop()


def test_flush_fn_exception_does_not_kill_thread():
    calls = {"n": 0}

    def flush(batch):
        calls["n"] += 1
        raise RuntimeError("boom")

    buf = MetricBuffer(flush, flush_interval=0.05, max_rows=2)
    try:
        buf.append({"a": 1})
        buf.append({"a": 2})
        time.sleep(0.2)
        # Thread should still be alive despite the raise.
        assert buf.thread.is_alive()
        # And it should have been called at least once.
        assert calls["n"] >= 1
    finally:
        buf.stop()


def test_append_is_thread_safe():
    received: list[list[dict]] = []
    buf = MetricBuffer(
        lambda b: received.append(b) or True, flush_interval=0.05, max_rows=10_000
    )
    try:
        def worker():
            for i in range(200):
                buf.append({"x": i})

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        time.sleep(0.2)
        total = sum(len(b) for b in received)
        # Some may still be buffered; stop() will drain.
        buf.stop()
        total = sum(len(b) for b in received)
        assert total == 10 * 200
    finally:
        if buf.thread.is_alive():
            buf.stop()
