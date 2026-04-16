"""In-memory metric buffer with a background flush thread."""

from __future__ import annotations

import logging
import threading
from collections import deque
from typing import Any, Callable

log = logging.getLogger(__name__)


class MetricBuffer:
    """Accumulate sequence points and flush in batches.

    ``track()`` calls in the training loop append here and return immediately.
    A daemon thread drains the deque every ``flush_interval`` seconds or when
    ``max_rows`` is reached, whichever comes first.
    """

    def __init__(
        self,
        flush_fn: Callable[[list[dict[str, Any]]], bool],
        *,
        flush_interval: float = 0.5,
        max_rows: int = 1000,
    ):
        self._flush_fn = flush_fn
        self._flush_interval = flush_interval
        self._max_rows = max_rows
        self._buf: deque[dict[str, Any]] = deque()
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run, name="cairn-metric-flush", daemon=True
        )
        self._thread.start()

    def append(self, point: dict[str, Any]) -> None:
        with self._lock:
            self._buf.append(point)
            should_flush = len(self._buf) >= self._max_rows
        if should_flush:
            self._event.set()

    def _drain(self) -> list[dict[str, Any]]:
        with self._lock:
            batch = list(self._buf)
            self._buf.clear()
        return batch

    def flush(self) -> None:
        """Synchronously flush the current buffer."""
        batch = self._drain()
        if batch:
            try:
                self._flush_fn(batch)
            except Exception:  # noqa: BLE001
                log.exception("buffer flush raised")

    def _run(self) -> None:
        while not self._stop.is_set():
            triggered = self._event.wait(timeout=self._flush_interval)
            self._event.clear()
            if self._stop.is_set():
                break
            batch = self._drain()
            if not batch:
                continue
            try:
                self._flush_fn(batch)
            except Exception:  # noqa: BLE001
                log.exception("buffer flush raised")
            _ = triggered  # silence lint

    def stop(self, timeout: float = 10.0) -> None:
        """Signal shutdown, final-flush, join the thread."""
        self._stop.set()
        self._event.set()
        self._thread.join(timeout=timeout)
        # One last drain in case the thread exited before processing a batch.
        self.flush()

    @property
    def thread(self) -> threading.Thread:
        return self._thread
