"""The SDK ``Run`` class — the user-facing entry point.

Ties transport + buffer + handlers + capture modules together. One ``Run``
instance per experimental execution; lifecycle:

    with cairn.Run(project="...", task="...") as run:
        run["hparams"] = {"lr": 3e-4}
        for step, loss in ...:
            run.track(loss, name="loss", step=step)
"""

from __future__ import annotations

import atexit
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .. import config
from ..sdk import handlers as _handlers_pkg  # noqa: F401  - register built-ins
from ..sdk.capture import stdout as stdout_capture
from ..sdk.capture.env import capture_env as _capture_env
from ..sdk.capture.git import capture_git
from ..sdk.capture.source import build_source_archive, find_project_root
from ..sdk.capture.system import SystemMetricsCollector
from ..sdk.handlers.registry import HandlerRegistry, default_registry
from ..sdk.wrappers import _TypeWrapper
from .buffer import MetricBuffer
from .local import LocalTransport, _RepoServedByOtherError
from .transport import Transport
from .wal import WriteAheadLog
from ..server.storage.datadir import DataDir, RepoLockedError

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _context_key(context: Any) -> tuple:
    if context is None:
        return ()
    if isinstance(context, dict):
        return tuple(sorted((str(k), str(v)) for k, v in context.items()))
    return (str(context),)


def _url_from_holder(holder: dict[str, Any]) -> str | None:
    """Reconstruct an HTTP base URL from a lock-file holder dict, if it has
    both ``host`` and ``port``. Returns None otherwise.
    """
    host = holder.get("host")
    port = holder.get("port")
    if isinstance(host, str) and isinstance(port, int):
        return f"http://{host}:{port}"
    return None


def _verify_reachable(url: str, repo: Path) -> None:
    """Probe ``<url>/api/health`` so the SDK fails fast if the holder is hung.

    Raises :class:`RepoLockedError` with an actionable message if the
    holder's declared endpoint doesn't respond with 200.
    """
    import httpx

    try:
        resp = httpx.get(f"{url}/api/health", timeout=2.0)
        if resp.status_code != 200:
            raise RuntimeError(f"status {resp.status_code}")
    except Exception as exc:  # noqa: BLE001
        lock_path = DataDir(repo).lock_path
        raise RepoLockedError(
            repo,
            {
                "mode": "unreachable",
                "pid": "?",
                "hint": (
                    f"The repo lock at {lock_path} claims a server/UI is "
                    f"running at {url}, but {url}/api/health didn't "
                    f"respond ({exc}). Restart the UI or delete the lock "
                    f"file if the owning process is truly gone."
                ),
            },
        ) from exc


class Run:
    """A single experiment execution."""

    def __init__(
        self,
        project: str,
        task: str,
        *,
        name: str | None = None,
        tags: list[str] | None = None,
        notes: str | None = None,
        server: str | None = None,
        repo: str | Path | None = None,
        capture_source: bool = True,
        capture_stdout: bool = True,
        capture_env: bool = True,
        capture_system_metrics: bool = True,
        system_metrics_interval: float = 10.0,
        system_metrics_include_per_core: bool = False,
        source_root: str | Path | None = None,
        source_include: list[str] | None = None,
        source_exclude: list[str] | None = None,
        source_max_file_size_mb: float = 1.0,
        timeout: float = 10.0,
        registry: HandlerRegistry | None = None,
        transport: Transport | LocalTransport | None = None,
    ):
        self._registry = registry or default_registry
        self._wal: WriteAheadLog | None = None
        if transport is not None:
            self._transport = transport
            self._owns_transport = False
            self._server = getattr(transport, "server_url", "")
        else:
            target = config.resolve_target(repo=repo, server=server)
            if target.is_local:
                try:
                    self._transport = LocalTransport(target.location)
                    self._server = self._transport.server_url
                except _RepoServedByOtherError as exc:
                    url = _url_from_holder(exc.holder)
                    if url is None:
                        raise
                    _verify_reachable(url, Path(target.location))
                    # HTTP mode against a running server — use WAL for resilience.
                    # WAL run_id isn't known yet; created after create_run below.
                    self._transport = Transport(url, timeout=timeout)
                    self._server = url
            else:
                # Pure HTTP mode — use WAL for resilience.
                self._transport = Transport(target.location, timeout=timeout)
                self._server = target.location
            self._owns_transport = True
        self._project = project
        self._task = task
        self._name = name
        self._timeout = timeout

        # Bookkeeping
        self._finished = False
        self._step_counters: dict[tuple, int] = {}
        self._step_lock = threading.Lock()
        self._line_counter = 0
        self._line_lock = threading.Lock()

        # Env + git captured synchronously so we can send them on create.
        env_snapshot: dict[str, Any] | None = _capture_env() if capture_env else None
        git_info = capture_git(Path.cwd()) if capture_source or capture_env else None

        create_body: dict[str, Any] = {
            "project": project,
            "task": task,
            "name": name,
            "tags": tags,
            "notes": notes,
            "env": env_snapshot,
            "git": (
                {
                    "sha": git_info["sha"],
                    "branch": git_info["branch"],
                    "dirty": git_info["dirty"],
                }
                if git_info
                else None
            ),
            "cli_args": env_snapshot["cli_args"] if env_snapshot else None,
            "hostname": env_snapshot["hostname"] if env_snapshot else None,
            "user": env_snapshot["user"] if env_snapshot else None,
        }
        resp = self._transport.create_run(create_body)
        self._run_id: str = resp["run_id"]
        self._url_path: str = resp.get("url", f"/p/{resp['project_id']}/r/{self._run_id}")

        # Attach WAL for HTTP transports (not local — DuckDB is its own WAL).
        if isinstance(self._transport, Transport):
            try:
                self._wal = WriteAheadLog(self._run_id)
                self._transport._wal = self._wal
            except OSError:
                log.warning("failed to create WAL for run %s", self._run_id, exc_info=True)

        # Guard against nested runs.
        stdout_capture.set_active_run(self._run_id)

        # Metric + log buffers.
        self._metric_buffer = MetricBuffer(
            flush_fn=lambda batch: self._transport.post_batch(self._run_id, batch),
            flush_interval=0.5,
            max_rows=1000,
        )
        self._log_buffer = MetricBuffer(
            flush_fn=self._flush_logs,
            flush_interval=0.5,
            max_rows=500,
        )

        # Stdout capture — tee sends lines into the log buffer.
        self._stdout_capture: stdout_capture.StdoutCapture | None = None
        if capture_stdout:
            self._stdout_capture = stdout_capture.StdoutCapture(
                on_line=self._on_captured_line
            )
            self._stdout_capture.start()

        # System metrics collector.
        self._sys_collector: SystemMetricsCollector | None = None
        if capture_system_metrics:
            self._sys_collector = SystemMetricsCollector(
                track=lambda n, v: self.track(v, name=n),
                interval=system_metrics_interval,
                include_per_core=system_metrics_include_per_core,
            )
            self._sys_collector.start()

        # Source archive upload — do in a background thread so __init__ is fast.
        if capture_source:
            self._source_thread = threading.Thread(
                target=self._capture_source,
                kwargs={
                    "root_override": source_root,
                    "include": tuple(source_include) if source_include else None,
                    "exclude": tuple(source_exclude) if source_exclude else None,
                    "max_file_size_mb": source_max_file_size_mb,
                },
                daemon=True,
                name="cairn-source-upload",
            )
            self._source_thread.start()
        else:
            self._source_thread = None

        # Register an atexit hook so users don't have to call ``finish()``
        # explicitly — matches Aim's ergonomics. If ``finish()`` is called
        # explicitly (directly or via the context-manager __exit__), it
        # unregisters the hook so a second Run in the same process doesn't
        # double-clean.
        atexit.register(self._atexit_finish)

    # ---- properties -------------------------------------------------------

    @property
    def id(self) -> str:
        return self._run_id

    @property
    def url(self) -> str:
        return f"{self._server.rstrip('/')}{self._url_path}"

    # ---- tracking ---------------------------------------------------------

    def track(
        self,
        value: Any,
        name: str,
        step: int | None = None,
        context: Any | None = None,
        **kwargs: Any,
    ) -> None:
        """Record a point in the named sequence.

        ``step`` auto-increments per ``(name, context)`` if omitted.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")

        # Unwrap explicit type wrappers.
        wrapper_kwargs: dict[str, Any] = {}
        if isinstance(value, _TypeWrapper):
            wrapper_kwargs = value.kwargs
            payload = value.obj
            object_type = value.object_type
            handler = self._registry.find_by_type(object_type)
        else:
            payload = value
            handler = self._registry.find_handler(value)
            object_type = handler.object_type if handler else None

        if handler is None:
            raise TypeError(
                f"No handler for value of type {type(value).__name__}; "
                "wrap with cairn.Image/Figure/Tensor/... to force a handler."
            )

        effective_step = self._next_step(name, context, step)
        merged_kwargs = {**wrapper_kwargs, **kwargs}

        point: dict[str, Any] = {
            "name": name,
            "step": effective_step,
            "wall_time": _now_iso(),
            "context": context,
            "object_type": object_type,
        }

        if object_type == "scalar":
            # Fast path — scalar handler has a cheap to_scalar method.
            point["scalar_value"] = handler.to_scalar(payload)  # type: ignore[attr-defined]
        else:
            blob, meta = handler.serialize(payload, **merged_kwargs)
            # Figure handler dual-storage: upload source as a second artifact.
            source_blob = meta.pop("_source_blob", None)
            source_mime = meta.pop("_source_mime", None)
            if source_blob is not None and source_mime is not None:
                src_hash = self._transport.upload_artifact(source_blob, source_mime, {})
                meta["source_hash"] = src_hash
            digest = self._transport.upload_artifact(blob, handler.mime_type, meta)
            point["artifact_hash"] = digest

        self._metric_buffer.append(point)

    def log_artifact(self, value: Any, name: str, step: int | None = None) -> str:
        """Log a one-off artifact attached to the run (not a sequence point)."""
        if self._finished:
            raise RuntimeError("Run has already been finished")
        handler: Any = None
        if isinstance(value, _TypeWrapper):
            handler = self._registry.find_by_type(value.object_type)
            payload = value.obj
            kw = value.kwargs
        else:
            handler = self._registry.find_handler(value)
            payload = value
            kw = {}
        if handler is None:
            raise TypeError(f"No handler for artifact of type {type(value).__name__}")
        blob, meta = handler.serialize(payload, **kw)
        meta.pop("_source_blob", None)
        meta.pop("_source_mime", None)
        digest = self._transport.upload_artifact(blob, handler.mime_type, meta)
        self._transport.attach_artifact(self._run_id, name, digest, step=step)
        return digest

    # ---- params / metadata ------------------------------------------------

    def __setitem__(self, key: str, value: Any) -> None:
        if self._finished:
            raise RuntimeError("Run has already been finished")
        if isinstance(value, dict):
            # nested dict → dotted paths
            self._transport.post_params(self._run_id, {key: value})
        else:
            self._transport.post_params(self._run_id, {key: value})

    def set_tag(self, tag: str) -> None:
        self._transport.set_tags(self._run_id, [tag])

    def set_tags(self, tags: list[str]) -> None:
        self._transport.set_tags(self._run_id, list(tags))

    def add_note(self, text: str) -> None:
        self._transport.set_notes(self._run_id, text)

    # ---- finish -----------------------------------------------------------

    def finish(self, status: str = "completed", exit_code: int | None = None) -> None:
        if self._finished:
            return
        try:
            if self._sys_collector is not None:
                self._sys_collector.stop()
                self._sys_collector.join(timeout=5)
            if self._stdout_capture is not None:
                self._stdout_capture.stop()
            # Drain both buffers before posting finish.
            self._metric_buffer.stop(timeout=self._timeout)
            self._log_buffer.stop(timeout=self._timeout)
            # Wait for source upload thread, short timeout to avoid hanging.
            if self._source_thread is not None and self._source_thread.is_alive():
                self._source_thread.join(timeout=5)
            try:
                self._transport.drain_spill(self._run_id)
            except Exception:  # noqa: BLE001
                log.warning("drain_spill failed during finish", exc_info=True)
            self._transport.finish_run(self._run_id, status, exit_code)
            # Clean up WAL after successful finish
            if self._wal is not None:
                try:
                    if not self._wal.has_pending:
                        self._wal.cleanup()
                    else:
                        log.warning("WAL has %d pending entries after finish", self._wal._seq - self._wal.read_checkpoint())
                        self._wal.close()
                except Exception:  # noqa: BLE001
                    log.warning("WAL cleanup failed", exc_info=True)
        finally:
            self._finished = True
            stdout_capture.clear_active_run(self._run_id)
            if self._owns_transport:
                self._transport.close()
            # Don't fire the atexit hook now that we've finished explicitly.
            try:
                atexit.unregister(self._atexit_finish)
            except Exception:  # noqa: BLE001 - defensive; unregister is cheap
                pass

    def _atexit_finish(self) -> None:
        """Fallback cleanup if ``finish()`` was never called explicitly.

        Registered in ``__init__``; removed in ``finish()``. Swallows errors
        because the interpreter is shutting down and reraising would just
        produce noise in an unrecoverable state.
        """
        if self._finished:
            return
        try:
            self.finish(status="completed")
        except Exception:  # noqa: BLE001
            log.warning("atexit finish failed", exc_info=True)

    # ---- context manager --------------------------------------------------

    def __enter__(self) -> Run:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            self.finish("completed")
        else:
            self.finish("failed", exit_code=1)

    # ---- internals --------------------------------------------------------

    def _next_step(self, name: str, context: Any, explicit: int | None) -> int:
        key = (name, _context_key(context))
        with self._step_lock:
            if explicit is not None:
                self._step_counters[key] = explicit + 1
                return explicit
            cur = self._step_counters.get(key, 0)
            self._step_counters[key] = cur + 1
            return cur

    def _on_captured_line(self, event: dict[str, Any]) -> None:
        with self._line_lock:
            self._line_counter += 1
            event["line_no"] = self._line_counter
        self._log_buffer.append(event)

    def _flush_logs(self, batch: list[dict[str, Any]]) -> bool:
        return self._transport.post_logs(self._run_id, batch)

    def _capture_source(
        self,
        *,
        root_override: str | Path | None,
        include: tuple[str, ...] | None,
        exclude: tuple[str, ...] | None,
        max_file_size_mb: float,
    ) -> None:
        try:
            if root_override is not None:
                root = Path(root_override).resolve()
                marker = None
            else:
                root, marker = find_project_root(Path.cwd())
            from .capture.source import DEFAULT_EXCLUDE, DEFAULT_INCLUDE

            archive, manifest = build_source_archive(
                root,
                include=include or DEFAULT_INCLUDE,
                exclude=exclude or DEFAULT_EXCLUDE,
                max_file_size_mb=max_file_size_mb,
                marker=marker,
            )
            self._transport.upload_source(self._run_id, archive, manifest)
        except Exception:  # noqa: BLE001
            log.warning("source capture failed", exc_info=True)


def configure(**kwargs: Any) -> None:
    """Module-level configuration forwarder."""
    config.configure(**kwargs)
