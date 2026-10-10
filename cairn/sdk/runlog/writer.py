"""A process's writer into its run directory: every SDK write is a record.

``RunWriter`` speaks the op vocabulary of 0.5's run logs (``create_run``,
``batch``, ``params``, ``summary``, ``logs``, ``artifact_meta``, ``source``,
``finish``, ...) with the same payloads, so the server applies them with the
same ingest code. Points and console lines are accumulated in memory and
land as one ``batch`` / ``logs`` record per group commit (or before any
other record, so the order of what a process logged is kept).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

from .blobs import write_blob
from .log import LogWriter
from .rundir import RunDir

log = logging.getLogger(__name__)

#: Points per ``batch`` record, lines per ``logs`` record.
MAX_POINTS = 5000
MAX_LINES = 500


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def finish_timeout() -> float:
    """``CAIRN_FINISH_TIMEOUT`` (seconds ``finish`` waits for the upload)."""
    try:
        return max(0.0, float(os.environ.get("CAIRN_FINISH_TIMEOUT", "30")))
    except ValueError:
        return 30.0


class RunWriter:
    """Writes one log of a run directory (``log_key``: None for the
    primary's ``log/``, the label for ``procs/<label>/``; ``log_name``: its
    name on the server when not the default), plus its blobs.

    Raises:
        LogLocked: Another live process writes this log.
    """

    def __init__(
        self, run_dir: RunDir, run_id: str, log_key: str | None = None, *,
        log_name: str | None = None,
    ) -> None:
        self.run_dir = run_dir
        self.run_id = run_id
        self.ref = run_dir.log(log_key)
        self._points: deque[dict[str, Any]] = deque()
        self._lines: deque[dict[str, Any]] = deque()
        self._acc_lock = threading.Lock()
        self.log = LogWriter(self.ref.log_dir, before_commit=self._drain)
        if log_name is not None:
            # Named under the log's lock, before its first record.
            self.ref.set_name(log_name)
        self._closed = False

    # ---- plumbing ------------------------------------------------------------

    def _drain(self) -> None:
        """Turn accumulated points / lines into records (under the log's lock)."""
        with self._acc_lock:
            points, self._points = list(self._points), deque()
            lines, self._lines = list(self._lines), deque()
        for i in range(0, len(points), MAX_POINTS):
            self.log.append_from_hook("batch", {"run_id": self.run_id, "points": points[i:i + MAX_POINTS]})
        for i in range(0, len(lines), MAX_LINES):
            self.log.append_from_hook("logs", {"run_id": self.run_id, "lines": lines[i:i + MAX_LINES]})

    def record(self, op: str, fields: dict[str, Any]) -> int:
        """Append one record; returns its seq."""
        return self.log.append(op, fields)

    def _run_record(self, op: str, **fields: Any) -> int:
        return self.record(op, {"run_id": self.run_id, **fields})

    def flush(self) -> int:
        """Make everything written so far durable now; returns the last seq."""
        return self.log.flush()

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self.log.close()

    @property
    def last_seq(self) -> int:
        return self.log.last_seq

    # ---- the run's lifecycle ---------------------------------------------------

    def create_run(self, fields: dict[str, Any]) -> None:
        self.record("create_run", fields)

    def fork_run(self, fields: dict[str, Any]) -> None:
        self.record("fork_run", fields)

    def resume_run(self) -> None:
        self._run_record("resume_run")

    def rewind_run(self, step: int) -> None:
        self._run_record("rewind_run", step=step)

    def join(self, label: str | None) -> None:
        self._run_record("join", label=label)

    def finish(self, status: str, exit_code: int | None) -> None:
        self._run_record("finish", status=status, exit_code=exit_code, ended_at=_now_iso())
        self.flush()
        self.run_dir.mark_finished(None, status, exit_code)

    def detach(self, label: str) -> None:
        self._run_record("detach")
        self.flush()
        self.run_dir.mark_finished(label, "detached", None)

    def heartbeat(self) -> None:
        self._run_record("heartbeat", wall_time=_now_iso())

    # ---- data ------------------------------------------------------------------

    def add_point(self, point: dict[str, Any]) -> None:
        with self._acc_lock:
            self._points.append(point)

    def add_line(self, line: dict[str, Any]) -> None:
        with self._acc_lock:
            self._lines.append(line)

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        self._run_record("params", params=params)

    def post_summary(self, run_id: str, summary: dict[str, Any]) -> None:
        self._run_record("summary", summary=summary)

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        self._run_record("set_tags", tags=tags)

    def set_notes(self, run_id: str, notes: str) -> None:
        self._run_record("set_notes", notes=notes)

    def rename_run(self, run_id: str, name: str) -> None:
        self._run_record("rename_run", name=name)

    def delete_keys(self, run_id: str, table: str, keys: list[str]) -> None:
        self._run_record("delete_keys", table=table, keys=keys)

    def alert(self, run_id: str, alert: dict[str, Any]) -> None:
        self._run_record("alert", **alert)

    def set_metric_rule(self, run_id: str, name: str, x: str | None, summary: str | None) -> None:
        self._run_record("set_metric_rule", name=name, x=x, summary=summary)

    def set_total_steps(self, run_id: str, total_steps: int | None) -> None:
        self._run_record("total_steps", total_steps=total_steps)

    def post_progress(self, run_id: str, body: dict[str, Any]) -> None:
        self._run_record("progress", **body)

    def upload_artifact(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None = None,
        object_type: str | None = None,
    ) -> str:
        """Store a blob (durably, first) and record its metadata; returns its hash."""
        digest = write_blob(self.run_dir.blobs_dir, data)
        self.record("artifact_meta", {
            "hash": digest, "mime_type": mime_type, "size_bytes": len(data),
            "metadata": metadata or {}, "object_type": object_type,
        })
        return digest

    def upload_source(self, run_id: str, archive: bytes, manifest: dict[str, Any]) -> None:
        digest = write_blob(self.run_dir.blobs_dir, archive)
        self._run_record("source", hash=digest, manifest=manifest)

    def create_artifact_version(self, project_id: str, body: dict[str, Any]) -> None:
        """Log a new version (``body``: the ``POST
        /api/projects/{id}/artifact-versions`` shape with a client-generated
        ``version_id``). The server numbers it when it applies the record,
        so this returns None (``ArtifactVersion.wait`` blocks until then).

        Raises:
            ValueError: A bad name, alias or tag (checked here; a family's
                type is checked by the server, which drops a mismatch).
        """
        from ...server import artifact_registry_ops as rules

        rules.validate_name(body["name"])
        for alias in body.get("aliases") or []:
            rules.validate_user_alias(alias)
        rules.validate_tags(body.get("tags"))
        self.record("create_artifact_version", {"project_id": project_id, **body})

    def record_artifact_input(self, run_id: str, artifact_version_id: str, role: str) -> None:
        self._run_record("record_artifact_input", artifact_version_id=artifact_version_id, role=role)

    def record_run_use(self, run_id: str, used_run_id: str, role: str | None) -> None:
        self._run_record("record_run_use", used_run_id=used_run_id, role=role)

    # ---- upload ------------------------------------------------------------------

    def wait_uploaded(self, timeout: float, *, agent_base: Any = None) -> int:
        """Wait up to ``timeout`` s for the server to confirm this log to its
        last record; returns how many records are still unconfirmed.

        Gives up early when no uploader runs, or when the uploader reported a
        failed attempt after this call started (an unreachable server)."""
        from ...uploader import daemon as agent

        target = self.log.durable_seq
        start = time.time()
        deadline = time.monotonic() + timeout
        no_daemon_since: float | None = None
        while True:
            pending = target - self.ref.acked()
            if pending <= 0 or time.monotonic() >= deadline:
                return max(0, pending)
            if not agent.is_running(agent_base):
                no_daemon_since = no_daemon_since or time.monotonic()
                if time.monotonic() - no_daemon_since > 2.0:
                    return pending
            else:
                no_daemon_since = None
            status = agent.read_status(self.run_dir.path, agent_base)
            if status and status.get("error") and status.get("time", 0) > start + 0.5:
                return pending
            time.sleep(0.05)
