"""Tee-based stdout/stderr capture.

The user's terminal keeps showing output; the captured lines are forwarded
through a callback (typically the SDK's log-batch uploader). ANSI escape
sequences are preserved in the ``raw`` payload (so on-server log files look
right when ``cat``-ed) and stripped in the ``content`` payload (so the UI
gets clean text).
"""

from __future__ import annotations

import atexit
import re
import sys
import threading
from datetime import datetime, timezone
from typing import Callable, TextIO

_ANSI_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


def strip_ansi(s: str) -> str:
    return _ANSI_RE.sub("", s)


#: Reserved global to enforce the "no nested runs" rule (spec §"Nested runs").
_active_run_id: str | None = None
_active_lock = threading.Lock()


def set_active_run(run_id: str) -> None:
    global _active_run_id
    with _active_lock:
        if _active_run_id is not None and _active_run_id != run_id:
            raise RuntimeError(
                f"Nested cairn.Run() is not supported "
                f"(already active: {_active_run_id})"
            )
        _active_run_id = run_id


def clear_active_run(run_id: str) -> None:
    global _active_run_id
    with _active_lock:
        if _active_run_id == run_id:
            _active_run_id = None


class _TeeStream:
    """Writable stream that forwards to the original AND records line events.

    The line buffer handles carriage returns the way tqdm expects: when a
    ``\\n`` arrives, we only record the segment AFTER the last ``\\r`` in
    the accumulated buffer (the rest were intermediate overwrites).
    """

    def __init__(
        self,
        original: TextIO,
        stream_name: str,
        on_line: Callable[[dict], None],
    ):
        self._original = original
        self._stream = stream_name
        self._on_line = on_line
        self._buf = ""
        self._lock = threading.Lock()

    def write(self, s: str) -> int:  # mirror TextIO API
        # Pass-through first so terminal shows output in real time.
        n = self._original.write(s)
        try:
            self._original.flush()
        except Exception:  # noqa: BLE001
            pass
        with self._lock:
            self._buf += s
            # Pull off complete lines.
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                self._emit(line)
        return n

    def _emit(self, line: str) -> None:
        # tqdm emits "\rprogress" repeatedly; keep only the segment after
        # the last \r so we don't flood with intermediate states.
        if "\r" in line:
            line = line.split("\r")[-1]
        raw = line
        content = strip_ansi(line)
        self._on_line(
            {
                "stream": self._stream,
                "wall_time": datetime.now(timezone.utc).isoformat(),
                "line_no": 0,  # filled in by callback
                "content": content,
                "content_raw": raw,
            }
        )

    def flush(self) -> None:
        try:
            self._original.flush()
        except Exception:  # noqa: BLE001
            pass

    def isatty(self) -> bool:
        return getattr(self._original, "isatty", lambda: False)()

    def fileno(self) -> int:
        # Some libraries (tqdm, logging.StreamHandler) probe fileno; delegate.
        return self._original.fileno()

    def writable(self) -> bool:
        return True

    # --- manual flush of a trailing partial line ---------------------------

    def drain(self) -> None:
        with self._lock:
            if self._buf:
                leftover = self._buf
                self._buf = ""
                self._emit(leftover)


class StdoutCapture:
    """Swap sys.stdout/stderr for tees; restore on ``stop()`` / atexit."""

    def __init__(self, on_line: Callable[[dict], None]):
        self._on_line = on_line
        self._old_stdout: TextIO | None = None
        self._old_stderr: TextIO | None = None
        self._tee_stdout: _TeeStream | None = None
        self._tee_stderr: _TeeStream | None = None
        self._active = False
        self._atexit_registered = False

    def start(self) -> None:
        if self._active:
            return
        self._old_stdout = sys.stdout
        self._old_stderr = sys.stderr
        self._tee_stdout = _TeeStream(sys.stdout, "stdout", self._on_line)
        self._tee_stderr = _TeeStream(sys.stderr, "stderr", self._on_line)
        sys.stdout = self._tee_stdout  # type: ignore[assignment]
        sys.stderr = self._tee_stderr  # type: ignore[assignment]
        if not self._atexit_registered:
            atexit.register(self.stop)
            self._atexit_registered = True
        self._active = True

    def stop(self) -> None:
        if not self._active:
            return
        try:
            if self._tee_stdout:
                self._tee_stdout.drain()
            if self._tee_stderr:
                self._tee_stderr.drain()
        finally:
            if self._old_stdout is not None:
                sys.stdout = self._old_stdout
            if self._old_stderr is not None:
                sys.stderr = self._old_stderr
            self._active = False
