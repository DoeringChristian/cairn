"""In-memory metric buffer with a background flush thread."""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from typing import Any, Callable

log = logging.getLogger(__name__)

Batch = list[dict[str, Any]]


class MetricBuffer:
    """Accumulate sequence points and flush in batches.

    ``track()`` calls in the training loop append here and return immediately.
    A daemon thread drains the deque every ``flush_interval`` seconds or when
    ``max_rows`` is reached, whichever comes first, sending at most
    ``max_batch`` rows per ``flush_fn`` call: a backlog goes out as several
    bounded requests, never as one that grows with it.

    With a ``spill_fn`` (the transport's WAL, sent from later) the buffer is
    bounded and never waits on the network:

    * when the sender falls ``max_pending`` rows behind (a slow or
      unreachable server), ``append`` hands the backlog to ``spill_fn``
      instead of letting memory grow;
    * ``stop`` sends until its timeout, then spills what is left.

    ``idle_fn`` runs after each flush cycle (the transport's ``catch_up``,
    which replays what was spilled).
    """

    def __init__(
        self,
        flush_fn: Callable[[Batch], Any],
        *,
        flush_interval: float = 0.5,
        max_rows: int = 1000,
        max_batch: int = 5000,
        max_pending: int = 100_000,
        spill_fn: Callable[[Batch], Any] | None = None,
        idle_fn: Callable[[], Any] | None = None,
    ):
        self._flush_fn = flush_fn
        self._spill_fn = spill_fn
        self._idle_fn = idle_fn
        self._flush_interval = flush_interval
        self._max_rows = max_rows
        self._max_batch = max(1, max_batch)
        self._max_pending = max_pending
        self._buf: deque[dict[str, Any]] = deque()
        self._lock = threading.Lock()
        self._event = threading.Event()
        self._stop = threading.Event()
        # time.monotonic() past which a spilling buffer stops sending.
        self._deadline: float | None = None
        self._thread = threading.Thread(
            target=self._run, name="cairn-metric-flush", daemon=True
        )
        self._thread.start()

    def append(self, point: dict[str, Any]) -> None:
        overflow = None
        with self._lock:
            self._buf.append(point)
            n = len(self._buf)
            if self._spill_fn is not None and n >= self._max_pending:
                overflow, self._buf = list(self._buf), deque()
        if overflow is not None:
            self._spill(overflow)
        elif n >= self._max_rows:
            self._event.set()

    def _spill(self, rows: Batch) -> None:
        assert self._spill_fn is not None
        for i in range(0, len(rows), self._max_batch):
            try:
                self._spill_fn(rows[i:i + self._max_batch])
            except Exception:  # noqa: BLE001
                log.exception("buffer spill raised")

    def _spill_all(self) -> None:
        with self._lock:
            rest, self._buf = list(self._buf), deque()
        if rest:
            self._spill(rest)

    def _take(self) -> Batch:
        """Up to ``max_batch`` rows from the front of the buffer."""
        with self._lock:
            n = min(len(self._buf), self._max_batch)
            return [self._buf.popleft() for _ in range(n)]

    def _past_deadline(self) -> bool:
        return (
            self._spill_fn is not None
            and self._deadline is not None
            and time.monotonic() > self._deadline
        )

    def _send_all(self) -> None:
        """Send everything buffered, one bounded batch at a time (past the
        stop deadline, spill it instead)."""
        while True:
            if self._past_deadline():
                self._spill_all()
                return
            batch = self._take()
            if not batch:
                return
            try:
                self._flush_fn(batch)
            except Exception:  # noqa: BLE001
                log.exception("buffer flush raised")

    def flush(self) -> None:
        """Synchronously flush the current buffer."""
        self._send_all()

    def _run(self) -> None:
        while not self._stop.is_set():
            self._event.wait(timeout=self._flush_interval)
            self._event.clear()
            if self._stop.is_set():
                break
            self._send_all()
            if self._idle_fn is not None:
                try:
                    self._idle_fn()
                except Exception:  # noqa: BLE001
                    log.exception("buffer idle hook raised")
        self._send_all()  # stopping: what is left, until the deadline

    def stop(self, timeout: float = 10.0) -> None:
        """Signal shutdown and drain. The flush thread keeps sending for up
        to ``timeout`` seconds; with a ``spill_fn`` what is left after that
        is spilled (without one it is sent here, however long that takes)."""
        self._deadline = time.monotonic() + timeout
        self._stop.set()
        self._event.set()
        self._thread.join(timeout=timeout + 1.0)
        if self._thread.is_alive() and self._spill_fn is not None:
            # Stuck in one send: spill the buffer rather than wait for it.
            self._spill_all()
            return
        self._send_all()  # anything appended after the thread exited

    @property
    def thread(self) -> threading.Thread:
        return self._thread
